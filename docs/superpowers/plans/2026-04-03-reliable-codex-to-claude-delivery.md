# Reliable Codex-to-Claude Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Codex-to-Claude messages reliably readable even when Claude channel push is unavailable or silently ignored.

**Architecture:** Keep the current daemon/control protocol unchanged for phase 1. Change Claude-side delivery semantics so every inbound Codex message is first persisted into the in-memory pull queue, then optionally pushed via channel as a best-effort fast path. `get_messages` becomes the reliability backstop instead of an API-key-only side path.

**Tech Stack:** Bun, TypeScript, MCP SDK, Bun test

---

### Task 1: Define the phase-1 delivery contract in tests

**Files:**
- Modify: `src/dual-mode.test.ts`
- Test: `src/dual-mode.test.ts`

- [ ] **Step 1: Write the failing test for push mode reliability**

```ts
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
```

- [ ] **Step 2: Run the single test to verify it fails**

Run: `bun test src/dual-mode.test.ts -t "pushNotification stores messages for get_messages even in push mode"`
Expected: FAIL because push mode currently does not queue the message

- [ ] **Step 3: Add a failing test for notification failure fallback**

```ts
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
```

- [ ] **Step 4: Run the dual-mode test file to capture the red state**

Run: `bun test src/dual-mode.test.ts`
Expected: New tests fail, existing pull-mode tests stay green

### Task 2: Implement reliable queue-first Claude delivery

**Files:**
- Modify: `src/claude-adapter.ts`
- Modify: `src/bridge.ts`
- Test: `src/dual-mode.test.ts`

- [ ] **Step 1: Update `ClaudeAdapter.pushNotification()` to queue first, push second**

```ts
async pushNotification(message: BridgeMessage) {
  this.queueForPull(message);
  if (this.resolvedMode === "push") {
    await this.pushViaChannel(message);
  }
}
```

- [ ] **Step 2: Ensure `pushViaChannel()` never clears or bypasses the queue**

```ts
private async pushViaChannel(message: BridgeMessage) {
  const msgId = `codex_msg_${this.notificationIdPrefix}_${++this.notificationSeq}`;
  // Best-effort only. Queue retention is handled before this method runs.
  await this.server.notification({ ... });
}
```

- [ ] **Step 3: Keep `bridge.ts` using the same single delivery entrypoint**

```ts
daemonClient.on("codexMessage", (message) => {
  log(`Forwarding daemon → Claude (${message.content.length} chars)`);
  void claude.pushNotification(message);
});
```

- [ ] **Step 4: Run the targeted test file to verify green**

Run: `bun test src/dual-mode.test.ts`
Expected: PASS

### Task 3: Verify no regressions in adjacent bridge behavior

**Files:**
- Test: `src/codex-adapter.test.ts`
- Test: `src/daemon-client.test.ts`
- Modify: `src/daemon-client.test.ts` only if the test harness still needs stabilization

- [ ] **Step 1: Run the adjacent adapter test file**

Run: `bun test src/codex-adapter.test.ts`
Expected: PASS

- [ ] **Step 2: Run the daemon client test file**

Run: `bun test src/daemon-client.test.ts`
Expected: PASS, or expose any unrelated existing harness failure clearly

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 4: Run the required project verification subset**

Run: `bun test src/`
Expected: PASS, or if pre-existing failures remain, capture them explicitly with scope
