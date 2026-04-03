import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { ClaudeAdapter } from "./claude-adapter";

// Access internals for testing
function createAdapter(envMode?: string): any {
  const origMode = process.env.AGENTBRIDGE_MODE;
  const origMax = process.env.AGENTBRIDGE_MAX_BUFFERED_MESSAGES;

  if (envMode !== undefined) {
    process.env.AGENTBRIDGE_MODE = envMode;
  } else {
    delete process.env.AGENTBRIDGE_MODE;
  }

  const adapter = new ClaudeAdapter() as any;

  // Restore env immediately after construction reads it
  if (origMode !== undefined) {
    process.env.AGENTBRIDGE_MODE = origMode;
  } else {
    delete process.env.AGENTBRIDGE_MODE;
  }
  if (origMax !== undefined) {
    process.env.AGENTBRIDGE_MAX_BUFFERED_MESSAGES = origMax;
  } else {
    delete process.env.AGENTBRIDGE_MAX_BUFFERED_MESSAGES;
  }

  return adapter;
}

function makeBridgeMessage(content: string, ts?: number) {
  return {
    id: `test_${Date.now()}`,
    source: "codex" as const,
    content,
    timestamp: ts ?? Date.now(),
  };
}

describe("Dual-mode transport: mode resolution", () => {
  test("configuredMode defaults to 'auto' when AGENTBRIDGE_MODE is not set", () => {
    const adapter = createAdapter();
    expect(adapter.configuredMode).toBe("auto");
  });

  test("configuredMode respects AGENTBRIDGE_MODE=push", () => {
    const adapter = createAdapter("push");
    expect(adapter.configuredMode).toBe("push");
  });

  test("configuredMode respects AGENTBRIDGE_MODE=pull", () => {
    const adapter = createAdapter("pull");
    expect(adapter.configuredMode).toBe("pull");
  });

  test("invalid AGENTBRIDGE_MODE falls back to 'auto'", () => {
    const adapter = createAdapter("invalid");
    expect(adapter.configuredMode).toBe("auto");
  });

  test("auto mode defaults to push", () => {
    const adapter = createAdapter();
    adapter.resolveMode();
    expect(adapter.resolvedMode).toBe("push");
    expect(adapter.getDeliveryMode()).toBe("push");
  });

  test("resolveMode sets 'push' when configuredMode is 'push'", () => {
    const adapter = createAdapter("push");
    adapter.resolveMode();
    expect(adapter.resolvedMode).toBe("push");
    expect(adapter.getDeliveryMode()).toBe("push");
  });

  test("resolveMode sets 'pull' when configuredMode is 'pull'", () => {
    const adapter = createAdapter("pull");
    adapter.resolveMode();
    expect(adapter.resolvedMode).toBe("pull");
    expect(adapter.getDeliveryMode()).toBe("pull");
  });
});

describe("Dual-mode transport: pull mode message queue", () => {
  test("queueForPull adds message to pendingMessages", () => {
    const adapter = createAdapter("pull");
    adapter.resolveMode();

    const msg = makeBridgeMessage("hello from codex");
    adapter.queueForPull(msg);

    expect(adapter.pendingMessages).toHaveLength(1);
    expect(adapter.pendingMessages[0].content).toBe("hello from codex");
    expect(adapter.getPendingMessageCount()).toBe(1);
  });

  test("queueForPull drops oldest when queue is full", () => {
    const orig = process.env.AGENTBRIDGE_MAX_BUFFERED_MESSAGES;
    process.env.AGENTBRIDGE_MAX_BUFFERED_MESSAGES = "3";
    const adapter = createAdapter("pull");
    process.env.AGENTBRIDGE_MAX_BUFFERED_MESSAGES = orig;

    adapter.resolveMode();

    adapter.queueForPull(makeBridgeMessage("msg1"));
    adapter.queueForPull(makeBridgeMessage("msg2"));
    adapter.queueForPull(makeBridgeMessage("msg3"));
    adapter.queueForPull(makeBridgeMessage("msg4"));

    expect(adapter.pendingMessages).toHaveLength(3);
    expect(adapter.pendingMessages[0].content).toBe("msg2");
    expect(adapter.pendingMessages[2].content).toBe("msg4");
    expect(adapter.droppedMessageCount).toBe(1);
  });

  test("pushNotification queues in pull mode", async () => {
    const adapter = createAdapter("pull");
    adapter.resolveMode();
    await adapter.pushNotification(makeBridgeMessage("pull msg"));
    expect(adapter.pendingMessages).toHaveLength(1);
    expect(adapter.pendingMessages[0].content).toBe("pull msg");
  });

  test("push mode message ids include a session-unique prefix", async () => {
    const adapter = createAdapter("push");
    adapter.resolveMode();

    const notifications: any[] = [];
    adapter.server = {
      notification: async (payload: any) => {
        notifications.push(payload);
      },
    };

    await adapter.pushNotification(makeBridgeMessage("first push", 1705312200000));
    await adapter.pushNotification(makeBridgeMessage("second push", 1705312205000));

    expect(notifications).toHaveLength(2);

    const firstId = notifications[0].params.meta.message_id as string;
    const secondId = notifications[1].params.meta.message_id as string;

    expect(firstId).toMatch(/^codex_msg_[a-f0-9]{12}_1$/);
    expect(secondId).toMatch(/^codex_msg_[a-f0-9]{12}_2$/);
    expect(firstId.replace(/_1$/, "")).toBe(secondId.replace(/_2$/, ""));
    expect(firstId).not.toBe("codex_msg_1");
  });

  test("pushNotification stores messages for get_messages even in push mode", async () => {
    const adapter = createAdapter("push");
    adapter.resolveMode();
    adapter.server = {
      notification: async () => {},
    };

    await adapter.pushNotification(makeBridgeMessage("reliable push"));

    expect(adapter.getPendingMessageCount()).toBe(1);
    const drained = adapter.drainMessages();
    expect(drained.content[0].text).toContain("reliable push");
  });

  test("pushNotification still queues message when channel notification throws", async () => {
    const adapter = createAdapter("push");
    adapter.resolveMode();
    adapter.server = {
      notification: async () => {
        throw new Error("channel unavailable");
      },
    };

    await adapter.pushNotification(makeBridgeMessage("fallback delivery"));

    expect(adapter.getPendingMessageCount()).toBe(1);
    expect(adapter.drainMessages().content[0].text).toContain("fallback delivery");
  });
});

describe("Dual-mode transport: drainMessages (get_messages)", () => {
  test("returns 'no new messages' when queue is empty", () => {
    const adapter = createAdapter("pull");
    adapter.resolveMode();

    const result = adapter.drainMessages();
    expect(result.content[0].text).toBe("No new messages from Codex.");
  });

  test("returns formatted messages and clears queue", () => {
    const adapter = createAdapter("pull");
    adapter.resolveMode();

    const ts = 1705312200000; // fixed timestamp for deterministic output
    adapter.queueForPull(makeBridgeMessage("first message", ts));
    adapter.queueForPull(makeBridgeMessage("second message", ts + 5000));

    const result = adapter.drainMessages();
    const text = result.content[0].text;

    expect(text).toContain("[2 new messages from Codex]");
    expect(text).toContain("chat_id:");
    expect(text).toContain("[1]");
    expect(text).toContain("first message");
    expect(text).toContain("[2]");
    expect(text).toContain("second message");

    // Queue should be cleared
    expect(adapter.pendingMessages).toHaveLength(0);
    expect(adapter.getPendingMessageCount()).toBe(0);
  });

  test("drainMessages includes structured metadata labels", () => {
    const adapter = createAdapter("pull");
    adapter.resolveMode();

    adapter.queueForPull({
      id: "m1",
      source: "codex" as const,
      content: "Please review",
      timestamp: 1705312200000,
      intent: "review_request",
      replyRequested: true,
      inReplyTo: "msg-0",
      chainDepth: 2,
    });

    const text = adapter.drainMessages().content[0].text;
    expect(text).toContain("intent: review_request");
    expect(text).toContain("reply requested: yes");
    expect(text).toContain("in_reply_to: msg-0");
    expect(text).toContain("chain_depth: 2");
  });

  test("pushNotification suppresses deep reply requests with the loop guard", async () => {
    const adapter = createAdapter("pull");
    adapter.resolveMode();

    await adapter.pushNotification({
      id: "deep-1",
      source: "codex" as const,
      content: "Please keep replying forever",
      timestamp: 1705312200000,
      replyRequested: true,
      chainDepth: 4,
    });

    expect(adapter.pendingMessages[0].replyRequested).toBe(false);
    expect(adapter.pendingMessages[0].loopGuardTriggered).toBe(true);
  });

  test("includes dropped count when messages were lost", () => {
    const orig = process.env.AGENTBRIDGE_MAX_BUFFERED_MESSAGES;
    process.env.AGENTBRIDGE_MAX_BUFFERED_MESSAGES = "2";
    const adapter = createAdapter("pull");
    process.env.AGENTBRIDGE_MAX_BUFFERED_MESSAGES = orig;
    adapter.resolveMode();

    adapter.queueForPull(makeBridgeMessage("a"));
    adapter.queueForPull(makeBridgeMessage("b"));
    adapter.queueForPull(makeBridgeMessage("c")); // drops "a"

    const result = adapter.drainMessages();
    const text = result.content[0].text;
    expect(text).toContain("1 older message");
    expect(text).toContain("dropped due to queue overflow");
    expect(adapter.droppedMessageCount).toBe(0); // reset after drain
  });

  test("singular message uses correct grammar", () => {
    const adapter = createAdapter("pull");
    adapter.resolveMode();

    adapter.queueForPull(makeBridgeMessage("only one"));

    const result = adapter.drainMessages();
    expect(result.content[0].text).toContain("[1 new message from Codex]");
  });

  test("waitForMessages returns queued messages immediately without draining older sessions", async () => {
    const adapter = createAdapter("push");
    adapter.resolveMode();
    adapter.server = {
      notification: async () => {},
    };

    await adapter.pushNotification(makeBridgeMessage("banana"));

    const result = await adapter.waitForMessages({ timeoutMs: 50, pollIntervalMs: 10 });

    expect(result.content[0].text).toContain("banana");
    expect(adapter.pendingMessages).toHaveLength(0);
  });

  test("waitForMessages waits for a later Codex reply", async () => {
    const adapter = createAdapter("push");
    adapter.resolveMode();
    adapter.server = {
      notification: async () => {},
    };

    const waiter = adapter.waitForMessages({ timeoutMs: 200, pollIntervalMs: 10 });

    setTimeout(() => {
      void adapter.pushNotification(makeBridgeMessage("delayed reply"));
    }, 30);

    const result = await waiter;

    expect(result.content[0].text).toContain("delayed reply");
    expect(adapter.pendingMessages).toHaveLength(0);
  });

  test("waitForMessages times out cleanly when no message arrives", async () => {
    const adapter = createAdapter("pull");
    adapter.resolveMode();

    const result = await adapter.waitForMessages({ timeoutMs: 20, pollIntervalMs: 5 });

    expect(result.content[0].text).toBe("No new messages from Codex after waiting.");
  });
});

describe("Dual-mode transport: reply pending hint", () => {
  test("handleReply includes pending message hint when queue is non-empty", async () => {
    const adapter = createAdapter("pull");
    adapter.resolveMode();

    adapter.replySender = async () => ({ success: true });
    adapter.queueForPull(makeBridgeMessage("waiting msg 1"));
    adapter.queueForPull(makeBridgeMessage("waiting msg 2"));

    const result = await adapter.handleReply({ chat_id: "test", text: "hello codex" });
    const text = result.content[0].text;

    expect(text).toContain("Reply sent to Codex.");
    expect(text).toContain("2 unread Codex message");
    expect(text).toContain("get_messages");
  });

  test("handleReply has no hint when queue is empty", async () => {
    const adapter = createAdapter("pull");
    adapter.resolveMode();

    adapter.replySender = async () => ({ success: true });

    const result = await adapter.handleReply({ chat_id: "test", text: "hello codex" });
    expect(result.content[0].text).toBe("Reply sent to Codex.");
  });

  test("handleReply carries structured metadata into outgoing messages", async () => {
    const adapter = createAdapter("pull");
    adapter.resolveMode();

    let outgoing: any;
    adapter.replySender = async (msg: any, requireReply?: boolean) => {
      outgoing = { msg, requireReply };
      return { success: true };
    };

    await adapter.handleReply({
      chat_id: "test",
      text: "please review this change",
      intent: "review_request",
      in_reply_to: "codex-msg-1",
      require_reply: true,
    });

    expect(outgoing.msg.intent).toBe("review_request");
    expect(outgoing.msg.inReplyTo).toBe("codex-msg-1");
    expect(outgoing.msg.replyRequested).toBe(true);
    expect(outgoing.requireReply).toBe(true);
  });

  test("handleReply increments chain depth from the parent message", async () => {
    const adapter = createAdapter("pull");
    adapter.resolveMode();

    adapter.queueForPull({
      id: "codex-msg-2",
      source: "codex" as const,
      content: "Please review this",
      timestamp: 1705312200000,
      chainDepth: 2,
    });

    let outgoing: any;
    adapter.replySender = async (msg: any, requireReply?: boolean) => {
      outgoing = { msg, requireReply };
      return { success: true };
    };

    await adapter.handleReply({
      chat_id: "test",
      text: "reviewed",
      in_reply_to: "codex-msg-2",
      require_reply: true,
    });

    expect(outgoing.msg.chainDepth).toBe(3);
    expect(outgoing.requireReply).toBe(true);
  });

  test("handleReply suppresses require_reply when the loop guard limit is reached", async () => {
    const adapter = createAdapter("pull");
    adapter.resolveMode();

    adapter.queueForPull({
      id: "codex-msg-deep",
      source: "codex" as const,
      content: "deep thread",
      timestamp: 1705312200000,
      chainDepth: 3,
    });

    let outgoing: any;
    adapter.replySender = async (msg: any, requireReply?: boolean) => {
      outgoing = { msg, requireReply };
      return { success: true };
    };

    const result = await adapter.handleReply({
      chat_id: "test",
      text: "stop the loop",
      in_reply_to: "codex-msg-deep",
      require_reply: true,
    });

    expect(outgoing.msg.chainDepth).toBe(4);
    expect(outgoing.msg.replyRequested).toBe(false);
    expect(outgoing.msg.loopGuardTriggered).toBe(true);
    expect(outgoing.requireReply).toBe(false);
    expect(result.content[0].text).toContain("loop guard");
  });

  test("handleReply returns error when text is missing", async () => {
    const adapter = createAdapter("pull");
    adapter.resolveMode();

    const result = await adapter.handleReply({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("missing required parameter");
  });

  test("handleReply returns error when replySender is not set", async () => {
    const adapter = createAdapter("pull");
    adapter.resolveMode();

    const result = await adapter.handleReply({ text: "hello" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("bridge not initialized");
  });

  test("replyAndWait sends the reply and waits for Codex in one step", async () => {
    const adapter = createAdapter("push");
    adapter.resolveMode();
    adapter.server = {
      notification: async () => {},
    };

    let sentMessage: any = null;
    adapter.setReplySender(async (msg: any) => {
      sentMessage = msg;
      setTimeout(() => {
        void adapter.pushNotification(makeBridgeMessage("implemented"));
      }, 20);
      return { success: true };
    });

    const result = await adapter.replyAndWait({
      text: "Please implement the patch",
      timeout_ms: 100,
      poll_interval_ms: 10,
    });

    expect(sentMessage.content).toBe("Please implement the patch");
    expect(result.content[0].text).toContain("implemented");
  });

  test("replyAndWait returns reply delivery errors without waiting", async () => {
    const adapter = createAdapter("pull");
    adapter.resolveMode();
    adapter.setReplySender(async () => ({ success: false, error: "busy" }));

    const result = await adapter.replyAndWait({ text: "hello" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("busy");
  });
});
