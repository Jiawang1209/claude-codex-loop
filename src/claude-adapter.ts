/**
 * Claude Code MCP Server — Dual-Mode Message Transport
 *
 * Supports two delivery modes:
 *   - Push mode (OAuth): real-time via notifications/claude/channel
 *   - Pull mode (API key): message queue + get_messages tool
 *
 * Mode defaults to push in auto mode, or set explicitly via AGENTBRIDGE_MODE env var.
 *
 * Emits:
 *   - "ready"   ()                   — MCP connected, mode resolved
 *   - "reply"   (msg: BridgeMessage) — Claude used the reply tool
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { type BridgeMessage, MESSAGE_INTENTS, isMessageIntent } from "./types";
import { parseMarker } from "./message-filter";

export type ReplySender = (msg: BridgeMessage, requireReply?: boolean) => Promise<{ success: boolean; error?: string }>;
export type DeliveryMode = "push" | "pull" | "auto";
interface WaitForMessagesOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export const CLAUDE_INSTRUCTIONS = [
  "Codex is an AI coding agent (OpenAI) running in a separate session on the same machine.",
  "",
  "## Message delivery",
  "Messages from Codex may arrive in two ways depending on the connection mode:",
  "- As <channel source=\"claude-codex-loop\" chat_id=\"...\" user=\"Codex\" ...> tags (push mode)",
  "- Via the get_messages tool (pull mode)",
  "",
  "## Collaboration roles",
  "Default roles in this setup:",
  "- Claude: Reviewer, Planner, Hypothesis Challenger",
  "- Codex: Implementer, Executor, Reproducer/Verifier",
  "- Expect Codex to provide independent technical judgment and evidence, not passive agreement.",
  "",
  "## Thinking patterns (task-driven)",
  "- Analytical/review tasks: Independent Analysis & Convergence",
  "- Implementation tasks: Architect -> Builder -> Critic",
  "- Debugging tasks: Hypothesis -> Experiment -> Interpretation",
  "",
  "## Collaboration language",
  "- Use explicit phrases such as \"My independent view is:\", \"I agree on:\", \"I disagree on:\", and \"Current consensus:\".",
  "",
  "## How to interact",
  "- Use the reply tool to send messages back to Codex — pass chat_id back.",
  "- Prefer reply_and_wait for iterative coding loops when you want to send work to Codex and wait in one step.",
  "- When useful, set intent/in_reply_to/require_reply on replies so the collaboration stays structured.",
  "- Use the get_messages tool to check for pending messages from Codex.",
  "- For turn-by-turn collaboration, after sending a reply call wait_for_codex to wait for the next Codex message in this same session.",
  "- Use get_messages when you want an immediate non-blocking mailbox check.",
  "- When the user asks about Codex status or progress, call get_messages.",
  "",
  "## Turn coordination",
  "- When you see '⏳ Codex is working', do NOT call the reply tool — wait for '✅ Codex finished'.",
  "- After Codex finishes a turn, you have an attention window to review and respond before new messages arrive.",
  "- If the reply tool returns a busy error, Codex is still executing — wait and try again later.",
].join("\n");

const LOG_FILE = "/tmp/claude-codex-loop.log";
const MAX_REPLY_CHAIN_DEPTH = 4;
const RECENT_MESSAGE_CACHE_LIMIT = 200;
const DEFAULT_WAIT_TIMEOUT_MS = 15_000;
const DEFAULT_WAIT_POLL_INTERVAL_MS = 500;

export class ClaudeAdapter extends EventEmitter {
  private server: Server;
  private notificationSeq = 0;
  private sessionId: string;
  private readonly notificationIdPrefix: string;
  private replySender: ReplySender | null = null;

  // Dual-mode transport
  private readonly configuredMode: DeliveryMode;
  private resolvedMode: "push" | "pull" | null = null;
  private pendingMessages: BridgeMessage[] = [];
  private readonly maxBufferedMessages: number;
  private droppedMessageCount = 0;
  private recentMessages = new Map<string, BridgeMessage>();

  constructor() {
    super();
    this.sessionId = `codex_${Date.now()}`;
    this.notificationIdPrefix = randomUUID().replace(/-/g, "").slice(0, 12);

    const envMode = process.env.AGENTBRIDGE_MODE as DeliveryMode | undefined;
    this.configuredMode = envMode && ["push", "pull", "auto"].includes(envMode) ? envMode : "auto";
    this.maxBufferedMessages = parseInt(process.env.AGENTBRIDGE_MAX_BUFFERED_MESSAGES ?? "100", 10);

    this.server = new Server(
      { name: "claude-codex-loop", version: "0.1.0" },
      {
        capabilities: {
          experimental: { "claude/channel": {} },
          tools: {},
        },
        instructions: CLAUDE_INSTRUCTIONS,
      },
    );

    this.setupHandlers();
  }

  // ── Lifecycle ──────────────────────────────────────────────

  async start() {
    const transport = new StdioServerTransport();
    this.resolveMode();
    await this.server.connect(transport);
    this.log(`MCP server connected (mode: ${this.resolvedMode})`);
    this.emit("ready");
  }

  /** Register the async sender that bridge provides for reply delivery. */
  setReplySender(sender: ReplySender) {
    this.replySender = sender;
  }

  /** Returns the resolved delivery mode. */
  getDeliveryMode(): "push" | "pull" {
    return this.resolvedMode ?? "pull";
  }

  /** Returns the number of messages waiting in the pull queue. */
  getPendingMessageCount(): number {
    return this.pendingMessages.length;
  }

  // ── Mode Detection ─────────────────────────────────────────

  private resolveMode(): void {
    if (this.resolvedMode) return;

    if (this.configuredMode === "push" || this.configuredMode === "pull") {
      this.resolvedMode = this.configuredMode;
      this.log(`Delivery mode set by AGENTBRIDGE_MODE: ${this.resolvedMode}`);
    } else {
      // Default to push — Claude Code doesn't declare channel support in
      // client capabilities, so we can't detect it. Push is the better default
      // because it's real-time; if channels aren't available, notifications
      // are silently ignored (no error), and users can set AGENTBRIDGE_MODE=pull
      // explicitly for API key setups.
      this.resolvedMode = "push";
      this.log("Delivery mode defaulting to push (set AGENTBRIDGE_MODE=pull for API key mode)");
    }
  }

  // ── Message Delivery ───────────────────────────────────────

  async pushNotification(message: BridgeMessage) {
    const normalizedMessage = this.normalizeIncomingMessage(message);

    // Always retain inbound Codex messages in the local queue so pull-mode
    // remains a reliable fallback even when channel delivery is unavailable.
    this.queueForPull(normalizedMessage);

    if (this.resolvedMode === "push") {
      await this.pushViaChannel(normalizedMessage);
    }
  }

  private async pushViaChannel(message: BridgeMessage) {
    const msgId = `codex_msg_${this.notificationIdPrefix}_${++this.notificationSeq}`;
    const ts = new Date(message.timestamp).toISOString();

    try {
      await this.server.notification({
        method: "notifications/claude/channel",
        params: {
          content: this.formatMessageForDisplay(message),
          meta: {
            chat_id: this.sessionId,
            message_id: msgId,
            user: "Codex",
            user_id: "codex",
            ts,
            source_type: "codex",
          },
        },
      });
      this.log(`Pushed notification: ${msgId}`);
    } catch (e: any) {
      this.log(`Push notification failed: ${e.message}`);
      // Do NOT fall back to queue — the notification may have been partially
      // delivered, and queuing would risk duplicate messages when Claude polls.
    }
  }

  private queueForPull(message: BridgeMessage) {
    this.rememberMessage(message);
    if (this.pendingMessages.length >= this.maxBufferedMessages) {
      this.pendingMessages.shift();
      this.droppedMessageCount++;
      this.log(`Message queue full, dropped oldest message (total dropped: ${this.droppedMessageCount})`);
    }
    this.pendingMessages.push(message);
    this.log(`Queued message for pull (${this.pendingMessages.length} pending)`);
  }

  // ── get_messages ───────────────────────────────────────────

  private drainMessages(): { content: Array<{ type: "text"; text: string }> } {
    if (this.pendingMessages.length === 0 && this.droppedMessageCount === 0) {
      return {
        content: [{ type: "text" as const, text: "No new messages from Codex." }],
      };
    }

    // Snapshot and clear atomically to avoid issues with concurrent writes
    const messages = this.pendingMessages;
    this.pendingMessages = [];
    const dropped = this.droppedMessageCount;
    this.droppedMessageCount = 0;

    const count = messages.length;
    let header = `[${count} new message${count > 1 ? "s" : ""} from Codex]`;
    if (dropped > 0) {
      header += ` (${dropped} older message${dropped > 1 ? "s" : ""} were dropped due to queue overflow)`;
    }
    header += `\nchat_id: ${this.sessionId}`;

    const formatted = messages
      .map((msg, i) => {
        const ts = new Date(msg.timestamp).toISOString();
        return `---\n[${i + 1}] ${ts}\nCodex: ${this.formatMessageForDisplay(msg)}`;
      })
      .join("\n\n");

    return {
      content: [
        {
          type: "text" as const,
          text: `${header}\n\n${formatted}`,
        },
      ],
    };
  }

  async waitForMessages(
    options: WaitForMessagesOptions = {},
  ): Promise<{ content: Array<{ type: "text"; text: string }> }> {
    if (this.pendingMessages.length > 0 || this.droppedMessageCount > 0) {
      return this.drainMessages();
    }

    const timeoutMs = Math.max(0, options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS);
    const pollIntervalMs = Math.max(10, options.pollIntervalMs ?? DEFAULT_WAIT_POLL_INTERVAL_MS);
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      if (this.pendingMessages.length > 0 || this.droppedMessageCount > 0) {
        return this.drainMessages();
      }
    }

    return {
      content: [{ type: "text" as const, text: "No new messages from Codex after waiting." }],
    };
  }

  // ── MCP Tool Handlers ─────────────────────────────────────

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "reply",
          description:
            "Send a message back to Codex. Your reply will be injected into the Codex session as a new user turn.",
          inputSchema: {
            type: "object" as const,
            properties: {
              chat_id: {
                type: "string",
                description: "The conversation to reply in (from the inbound <channel> tag).",
              },
              text: {
                type: "string",
                description: "The message to send to Codex.",
              },
              require_reply: {
                type: "boolean",
                description: "When true, Codex is required to send a reply. All Codex messages from this turn will be forwarded immediately (bypassing STATUS buffering). Use this when you need a direct answer from Codex.",
              },
              intent: {
                type: "string",
                enum: MESSAGE_INTENTS,
                description: "Optional structured collaboration intent for this message.",
              },
              in_reply_to: {
                type: "string",
                description: "Optional upstream message id that this reply is answering.",
              },
            },
            required: ["text"],
          },
        },
        {
          name: "reply_and_wait",
          description:
            "Send a message to Codex and then wait for the next Codex response in the same session. Best for iterative review loops.",
          inputSchema: {
            type: "object" as const,
            properties: {
              chat_id: {
                type: "string",
                description: "The conversation to reply in (from the inbound <channel> tag).",
              },
              text: {
                type: "string",
                description: "The message to send to Codex.",
              },
              require_reply: {
                type: "boolean",
                description: "When true, Codex is required to send a reply.",
              },
              intent: {
                type: "string",
                enum: MESSAGE_INTENTS,
                description: "Optional structured collaboration intent for this message.",
              },
              in_reply_to: {
                type: "string",
                description: "Optional upstream message id that this reply is answering.",
              },
              timeout_ms: {
                type: "number",
                description: "Optional maximum wait time in milliseconds. Defaults to 15000.",
              },
              poll_interval_ms: {
                type: "number",
                description: "Optional polling interval in milliseconds. Defaults to 500.",
              },
            },
            required: ["text"],
          },
        },
        {
          name: "get_messages",
          description:
            "Check for new messages from Codex. Call this after sending a reply or when you expect a response from Codex.",
          inputSchema: {
            type: "object" as const,
            properties: {},
            required: [],
          },
        },
        {
          name: "wait_for_codex",
          description:
            "Wait briefly for new messages from Codex in the current Claude session. Use this after reply when you need turn-by-turn collaboration.",
          inputSchema: {
            type: "object" as const,
            properties: {
              timeout_ms: {
                type: "number",
                description: "Optional maximum wait time in milliseconds. Defaults to 15000.",
              },
              poll_interval_ms: {
                type: "number",
                description: "Optional polling interval in milliseconds. Defaults to 500.",
              },
            },
            required: [],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (name === "reply") {
        return this.handleReply(args as Record<string, unknown>);
      }

      if (name === "reply_and_wait") {
        return this.replyAndWait(args as Record<string, unknown>);
      }

      if (name === "get_messages") {
        return this.drainMessages();
      }

      if (name === "wait_for_codex") {
        return this.waitForMessages({
          timeoutMs: typeof args?.timeout_ms === "number" ? args.timeout_ms : undefined,
          pollIntervalMs: typeof args?.poll_interval_ms === "number" ? args.poll_interval_ms : undefined,
        });
      }

      return {
        content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
        isError: true,
      };
    });
  }

  private async handleReply(args: Record<string, unknown>) {
    const text = args?.text as string | undefined;
    if (!text) {
      return {
        content: [{ type: "text" as const, text: "Error: missing required parameter 'text'" }],
        isError: true,
      };
    }

    const requireReply = args?.require_reply === true;
    const inReplyTo = typeof args?.in_reply_to === "string" ? args.in_reply_to : undefined;
    const parentMessage = inReplyTo ? this.recentMessages.get(inReplyTo) : undefined;
    const chainDepth = parentMessage?.chainDepth !== undefined ? parentMessage.chainDepth + 1 : undefined;
    const loopGuardTriggered = requireReply && chainDepth !== undefined && chainDepth >= MAX_REPLY_CHAIN_DEPTH;
    const effectiveRequireReply = requireReply && !loopGuardTriggered;

    const bridgeMsg: BridgeMessage = {
      id: (args?.chat_id as string) ?? `reply_${Date.now()}`,
      source: "claude",
      content: text,
      timestamp: Date.now(),
      intent: isMessageIntent(args?.intent) ? args.intent : undefined,
      replyRequested: effectiveRequireReply,
      inReplyTo: inReplyTo,
      chainDepth,
      loopGuardTriggered,
    };

    if (!this.replySender) {
      this.log("No reply sender registered");
      return {
        content: [{ type: "text" as const, text: "Error: bridge not initialized, cannot send reply." }],
        isError: true,
      };
    }

    const result = await this.replySender(bridgeMsg, effectiveRequireReply);
    if (!result.success) {
      this.log(`Reply delivery failed: ${result.error}`);
      return {
        content: [{ type: "text" as const, text: `Error: ${result.error}` }],
        isError: true,
      };
    }

    // Include pending message hint
    const pending = this.pendingMessages.length;
    let responseText = "Reply sent to Codex.";
    if (loopGuardTriggered) {
      responseText += ` Reply requests were downgraded by the loop guard at chain depth ${chainDepth}.`;
    }
    if (pending > 0) {
      responseText += ` Note: ${pending} unread Codex message${pending > 1 ? "s" : ""} already waiting \u2014 call get_messages to read them.`;
    }

    return {
      content: [{ type: "text" as const, text: responseText }],
    };
  }

  async replyAndWait(args: Record<string, unknown>) {
    const replyResult = await this.handleReply(args);
    if (replyResult.isError) {
      return replyResult;
    }

    return this.waitForMessages({
      timeoutMs: typeof args?.timeout_ms === "number" ? args.timeout_ms : undefined,
      pollIntervalMs: typeof args?.poll_interval_ms === "number" ? args.poll_interval_ms : undefined,
    });
  }

  private formatMessageForDisplay(message: BridgeMessage): string {
    const metaLines = [
      message.intent && message.intent !== "system" ? `intent: ${message.intent}` : null,
      message.replyRequested ? "reply requested: yes" : null,
      message.loopGuardTriggered ? "reply requested: suppressed by loop guard" : null,
      message.inReplyTo ? `in_reply_to: ${message.inReplyTo}` : null,
      message.chainDepth !== undefined ? `chain_depth: ${message.chainDepth}` : null,
    ].filter(Boolean);
    const body = parseMarker(message.content).body;
    if (metaLines.length === 0) return body;
    return `${metaLines.join("\n")}\n${body}`;
  }

  private normalizeIncomingMessage(message: BridgeMessage): BridgeMessage {
    if (!message.replyRequested || message.chainDepth === undefined || message.chainDepth < MAX_REPLY_CHAIN_DEPTH) {
      return message;
    }

    return {
      ...message,
      replyRequested: false,
      loopGuardTriggered: true,
    };
  }

  private rememberMessage(message: BridgeMessage) {
    this.recentMessages.set(message.id, message);
    while (this.recentMessages.size > RECENT_MESSAGE_CACHE_LIMIT) {
      const oldestKey = this.recentMessages.keys().next().value;
      if (!oldestKey) break;
      this.recentMessages.delete(oldestKey);
    }
  }

  private log(msg: string) {
    const line = `[${new Date().toISOString()}] [ClaudeAdapter] ${msg}\n`;
    process.stderr.write(line);
    try {
      appendFileSync(LOG_FILE, line);
    } catch {}
  }
}
