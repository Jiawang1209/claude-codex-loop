# AgentBridge Demo Script

This document provides a practical demonstration script for showing a real Claude/Codex collaboration loop with the current AgentBridge workflow.

Use it when you want to verify or present:

- Claude can initiate work for Codex
- Codex can report status and ask for review
- Claude can respond with decisions
- Codex can return results
- loop-guard behavior prevents unbounded ping-pong

## Demo Goal

Demonstrate a realistic collaboration around this scenario:

> Codex-to-Claude messages are not reliably visible, and the two agents collaborate to diagnose and fix the issue.

## Before You Start

Recommended setup:

1. Start Claude through AgentBridge:

```bash
agentbridge claude
```

2. Start Codex in another terminal:

```bash
agentbridge codex
```

3. If channel delivery is unreliable in your environment, verify that Claude can still read messages through `get_messages`.

4. Keep [docs/agent-collaboration.md](agent-collaboration.md) open as the reference protocol.

## Demo Flow

### Round 1: Claude starts the task

Claude sends:

```json
{
  "text": "Please investigate why Codex-to-Claude messages are not reliably visible. Start with the smallest possible fix and report back before expanding scope.",
  "intent": "task_request",
  "require_reply": true
}
```

Expected outcome:

- Codex receives a bounded task request
- the message clearly indicates that a reply is needed

### Round 2: Codex sends a progress update

Codex sends:

```text
[STATUS][intent=status][in_reply_to=msg-1][chain_depth=1] I traced the path and confirmed that Codex messages are emitted and forwarded, but Claude may silently ignore channel notifications in push mode.
```

Expected outcome:

- Claude sees a `status` update
- the message stays in the same thread
- no immediate reply is required

### Round 3: Codex asks Claude for alignment

Codex sends:

```text
[IMPORTANT][intent=review_request][reply_requested=true][in_reply_to=msg-1][chain_depth=1] My independent view is: we should first make pull-queue delivery reliable, then keep push as best-effort. Do you agree with that direction?
```

Expected outcome:

- Claude sees a `review_request`
- the bridge marks it as reply-requested
- this becomes the main decision point of the exchange

### Round 4: Claude gives a decision

Claude sends:

```json
{
  "text": "I agree. Implement reliable pull fallback first and keep the change small.",
  "intent": "decision",
  "in_reply_to": "msg-2",
  "require_reply": true
}
```

Expected outcome:

- Codex receives a clear directional decision
- the reply stays threaded
- chain depth continues to increase

### Round 5: Codex reports the result

Codex sends:

```text
[IMPORTANT][intent=result][reply_requested=true][in_reply_to=msg-3][chain_depth=3] Reliable fallback delivery is implemented. Focused tests and typecheck pass. Broader E2E still has existing environment-related failures unrelated to this patch.
```

Expected outcome:

- Claude sees a final `result`
- the conversation remains high-signal and structured

### Round 6: Claude closes the loop

Claude sends:

```json
{
  "text": "Good. Stop here and summarize the user-facing impact.",
  "intent": "task_request",
  "in_reply_to": "msg-4",
  "require_reply": true
}
```

Expected outcome:

- if the reply chain is already deep enough, loop guard downgrades the next reply request
- the message still goes through
- the bridge stops encouraging an endless exchange

## What To Observe

During the demo, check these specific signals:

1. Claude can reliably see Codex-originated messages
2. `get_messages` includes `intent`, `in_reply_to`, and `chain_depth`
3. Codex can explicitly request review or a decision from Claude
4. Claude can reply with structured metadata
5. reply requests are downgraded once the chain becomes too deep

## Minimal 3-Step Version

If you only want a quick smoke test, use this shorter flow.

### Step 1: Claude -> Codex

```json
{
  "text": "Please review my proposed fix direction.",
  "intent": "review_request",
  "require_reply": true
}
```

### Step 2: Codex -> Claude

```text
[IMPORTANT][intent=decision][reply_requested=true][in_reply_to=msg-1][chain_depth=1] I agree with the small-fix-first direction.
```

### Step 3: Claude -> Codex

```json
{
  "text": "Proceed with implementation and report the result.",
  "intent": "task_request",
  "in_reply_to": "msg-2",
  "require_reply": true
}
```

## Troubleshooting Notes

- If Claude does not visibly receive Codex messages, use `get_messages` to confirm the pull queue path still works.
- If the exchange becomes too chatty, reduce `reply_requested=true` usage on `status` messages.
- If a conversation stops asking for replies late in the thread, check whether loop guard has already downgraded reply requests.
- If you want another round after loop guard has triggered, let the human operator explicitly decide to continue rather than trying to force the bridge.
