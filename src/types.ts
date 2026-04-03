// ===== Bridge Core Types =====

export type MessageSource = "claude" | "codex";
export type MessageIntent =
  | "chat"
  | "question"
  | "task_request"
  | "review_request"
  | "status"
  | "decision"
  | "result"
  | "system";

export const MESSAGE_INTENTS: MessageIntent[] = [
  "chat",
  "question",
  "task_request",
  "review_request",
  "status",
  "decision",
  "result",
  "system",
];

export function isMessageIntent(value: unknown): value is MessageIntent {
  return typeof value === "string" && MESSAGE_INTENTS.includes(value as MessageIntent);
}

export interface BridgeMessage {
  id: string;
  source: MessageSource;
  content: string;
  timestamp: number;
  intent?: MessageIntent;
  replyRequested?: boolean;
  inReplyTo?: string;
  chainDepth?: number;
  loopGuardTriggered?: boolean;
}

// ===== JSON-RPC 2.0 =====

export interface JsonRpcRequest {
  jsonrpc?: "2.0";
  method: string;
  id: number;
  params?: Record<string, any>;
}

export interface JsonRpcResponse {
  jsonrpc?: "2.0";
  id: number;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

export interface JsonRpcNotification {
  jsonrpc?: "2.0";
  method: string;
  params?: Record<string, any>;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

// ===== MCP Tool Schema =====

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}
