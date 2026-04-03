# Structured Agent Collaboration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add lightweight structured collaboration semantics so Claude and Codex can exchange messages with explicit intent, reply requests, and reply threading while keeping the current bridge architecture compatible.

**Architecture:** Extend `BridgeMessage` with optional collaboration metadata instead of replacing the transport. Parse metadata out of Codex-authored message prefixes, carry metadata through the control protocol unchanged, and let Claude's `reply` tool emit the same metadata back to Codex. Update Claude pull-mode formatting and Codex bridge instructions so both sides can participate in structured exchanges without adding rooms or a new daemon protocol.

**Tech Stack:** Bun, TypeScript, MCP SDK, Bun test

---

### Task 1: Add failing tests for structured metadata parsing and formatting

**Files:**
- Modify: `src/message-filter.test.ts`
- Modify: `src/dual-mode.test.ts`
- Test: `src/message-filter.test.ts`
- Test: `src/dual-mode.test.ts`

- [ ] **Step 1: Write failing tests for metadata prefix parsing**

```ts
test("extracts intent and reply request metadata from message prefix", () => {
  const parsed = parseStructuredMessage("[IMPORTANT][intent=review_request][reply_requested=true][in_reply_to=msg-1] Please review");
  expect(parsed.marker).toBe("important");
  expect(parsed.metadata.intent).toBe("review_request");
  expect(parsed.metadata.replyRequested).toBe(true);
  expect(parsed.metadata.inReplyTo).toBe("msg-1");
  expect(parsed.body).toBe("Please review");
});
```

- [ ] **Step 2: Write a failing test for `get_messages` rendering structured metadata**

```ts
test("drainMessages includes structured metadata labels", () => {
  const adapter = createAdapter("pull");
  adapter.resolveMode();
  adapter.queueForPull({
    id: "m1",
    source: "codex",
    content: "Please review",
    timestamp: 1705312200000,
    intent: "review_request",
    replyRequested: true,
    inReplyTo: "msg-0",
  });

  const text = adapter.drainMessages().content[0].text;
  expect(text).toContain("intent: review_request");
  expect(text).toContain("reply requested: yes");
  expect(text).toContain("in_reply_to: msg-0");
});
```

- [ ] **Step 3: Run targeted tests to verify red**

Run: `bun test src/message-filter.test.ts src/dual-mode.test.ts`
Expected: New tests fail because parsing/formatting support does not exist yet

### Task 2: Implement structured message parsing for Codex-originated messages

**Files:**
- Modify: `src/types.ts`
- Modify: `src/message-filter.ts`
- Modify: `src/codex-adapter.ts`
- Modify: `src/message-filter.test.ts`

- [ ] **Step 1: Extend `BridgeMessage` with optional collaboration metadata**

```ts
export type MessageIntent =
  | "chat"
  | "question"
  | "task_request"
  | "review_request"
  | "status"
  | "decision"
  | "result"
  | "system";

export interface BridgeMessage {
  id: string;
  source: MessageSource;
  content: string;
  timestamp: number;
  intent?: MessageIntent;
  replyRequested?: boolean;
  inReplyTo?: string;
}
```

- [ ] **Step 2: Add a parser that strips metadata prefixes from message content**

```ts
const STRUCTURED_PREFIX_REGEX = /^\s*(\[(IMPORTANT|STATUS|FYI)\])?((\[(intent|reply_requested|in_reply_to)=[^\]]+\])*)\s*/i;

export function parseStructuredMessage(content: string) {
  // Return marker, cleaned body, and structured metadata.
}
```

- [ ] **Step 3: Populate metadata when Codex emits `agentMessage`**

```ts
const parsed = parseStructuredMessage(content);
this.emit("agentMessage", {
  id: item.id,
  source: "codex",
  content: parsed.body,
  timestamp: Date.now(),
  intent: parsed.metadata.intent,
  replyRequested: parsed.metadata.replyRequested,
  inReplyTo: parsed.metadata.inReplyTo,
} satisfies BridgeMessage);
```

- [ ] **Step 4: Update the bridge contract reminder so Codex knows the supported fields**

```ts
[Structured collaboration metadata]
- Optional prefixes after the marker:
  [intent=review_request|task_request|question|decision|result|chat|status]
  [reply_requested=true]
  [in_reply_to=<message-id>]
```

- [ ] **Step 5: Run targeted parsing tests to verify green**

Run: `bun test src/message-filter.test.ts`
Expected: PASS

### Task 3: Let Claude send and inspect structured collaboration metadata

**Files:**
- Modify: `src/claude-adapter.ts`
- Modify: `src/dual-mode.test.ts`
- Optionally Modify: `src/daemon-client.test.ts` only if typing updates require fixture payload changes

- [ ] **Step 1: Extend the `reply` tool input schema**

```ts
intent: {
  type: "string",
  enum: ["chat", "question", "task_request", "review_request", "status", "decision", "result", "system"],
},
in_reply_to: {
  type: "string",
},
```

- [ ] **Step 2: Carry metadata into outgoing Claude messages**

```ts
const bridgeMsg: BridgeMessage = {
  id: (args?.chat_id as string) ?? `reply_${Date.now()}`,
  source: "claude",
  content: text,
  timestamp: Date.now(),
  intent: isMessageIntent(args?.intent) ? args.intent : undefined,
  replyRequested: requireReply,
  inReplyTo: typeof args?.in_reply_to === "string" ? args.in_reply_to : undefined,
};
```

- [ ] **Step 3: Render metadata in `get_messages` output**

```ts
const metaLines = [
  msg.intent ? `intent: ${msg.intent}` : null,
  msg.replyRequested ? "reply requested: yes" : null,
  msg.inReplyTo ? `in_reply_to: ${msg.inReplyTo}` : null,
].filter(Boolean);
```

- [ ] **Step 4: Run the targeted Claude adapter tests**

Run: `bun test src/dual-mode.test.ts`
Expected: PASS

### Task 4: Verify compatibility and document phase-2 behavior

**Files:**
- Modify: `src/control-protocol.ts` only if type propagation needs tightening
- Test: `src/codex-adapter.test.ts`
- Test: `src/message-filter.test.ts`
- Test: `src/dual-mode.test.ts`

- [ ] **Step 1: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 2: Run the focused bridge regression suite**

Run: `bun test src/message-filter.test.ts src/dual-mode.test.ts src/codex-adapter.test.ts`
Expected: PASS

- [ ] **Step 3: If broader project tests still fail, record whether they are pre-existing harness issues or new regressions**

Run: `bun test src/`
Expected: Either PASS or clearly-scoped existing failures unrelated to structured metadata
