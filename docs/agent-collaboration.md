# Agent Collaboration Protocol

This document defines the practical collaboration contract for Claude and Codex when using AgentBridge in the current single-bridge workflow.

It is intentionally lightweight:

- transport remains the existing AgentBridge bridge
- the receiver always decides whether to respond
- messages may carry lightweight collaboration metadata
- the protocol is designed for stable day-to-day use, not full v2 room-based routing

## Goals

This protocol aims to provide:

- reliable message visibility in both directions
- clearer collaboration intent than plain free-form chat
- a simple way to ask for a response without forcing one
- lightweight threading across back-and-forth exchanges
- a shared vocabulary for planning, review, decisions, and results

## Core Principles

### 1. Messages are requests, not commands

AgentBridge delivers collaboration messages. It does not make one agent the controller of the other.

- A sender may request work, review, or clarification
- A receiver decides whether and how to respond
- `reply_requested` means "please respond if appropriate", not "you must obey"

### 2. Prefer explicit intent

Plain text is still allowed, but structured intent should be used whenever the sender wants the receiver to understand the purpose of the message quickly and reliably.

### 3. Use threading when continuing a line of discussion

When responding to a previous message, include `in_reply_to=<message-id>` so the exchange stays understandable.

### 4. Reserve reply requests for real collaboration turns

Not every update needs a reply. Progress noise is lower when only questions, review requests, and decisions ask for one.

## Message Shape

AgentBridge currently supports the following metadata on bridge messages:

- `intent`
- `replyRequested`
- `inReplyTo`
- `chainDepth`

Current supported `intent` values:

- `chat`
- `question`
- `task_request`
- `review_request`
- `status`
- `decision`
- `result`
- `system`

## Codex Message Prefix Format

When Codex sends high-value `agentMessage` output, it should use this prefix format:

```text
[MARKER][intent=<intent>][reply_requested=true][in_reply_to=<message-id>][chain_depth=<n>] Message body...
```

Where:

- `MARKER` is one of `IMPORTANT`, `STATUS`, or `FYI`
- `intent` is optional but recommended
- `reply_requested=true` is optional
- `in_reply_to=<message-id>` is optional
- `chain_depth=<n>` is optional

Example:

```text
[IMPORTANT][intent=review_request][reply_requested=true][in_reply_to=msg-123][chain_depth=2] Please review the reconnect fix before I continue.
```

## Loop Guard

To reduce ping-pong loops between agents, AgentBridge carries a lightweight reply-chain counter:

- `chain_depth=0` or omitted means a fresh message
- when replying to a message with chain depth, increment it by 1
- once the chain depth reaches `4`, reply requests should be downgraded instead of being forwarded as another required reply

This means:

- the message is still visible
- the receiver can still respond if it wants to
- the bridge stops encouraging another automatic reply turn

## Claude Reply Tool Usage

When Claude sends a structured reply back to Codex, the `reply` tool should use:

- `text`
- `intent` when relevant
- `in_reply_to` when answering an earlier message
- `require_reply=true` only when a real response is needed

Conceptual example:

```json
{
  "text": "I agree with the approach. Keep the fallback queue and avoid duplicate user-facing wording.",
  "intent": "decision",
  "in_reply_to": "msg-123",
  "require_reply": true
}
```

## Recommended Intent Usage

### `task_request`

Use when asking the other agent to do a bounded piece of work.

Good examples:

- "Please reproduce this bug and isolate the failure point."
- "Please implement the smallest fix first."

### `review_request`

Use when asking the other agent to review code, reasoning, or direction.

Good examples:

- "Please review this patch before I proceed."
- "Please sanity-check this migration plan."

### `question`

Use when a concrete answer is needed before continuing.

Good examples:

- "Should we preserve backward compatibility here?"
- "Do you want a minimal patch or a broader cleanup?"

### `decision`

Use when giving a conclusion, direction, or explicit judgment.

Good examples:

- "Proceed with the minimal fix first."
- "Do not change the CLI surface in this phase."

### `status`

Use for progress updates that usually do not require an immediate reply.

Good examples:

- "I reproduced the bug and narrowed it to channel delivery."
- "Focused tests pass; broader E2E still has existing harness failures."

### `result`

Use when reporting completion or a concrete outcome.

Good examples:

- "Reliable delivery is implemented."
- "Typecheck passes and the focused bridge tests are green."

### `chat`

Use for non-critical free-form discussion when no stronger intent applies.

### `system`

Reserved for AgentBridge-generated system messages.

## Recommended Collaboration Rhythm

For most implementation tasks, use this sequence:

1. `task_request`
2. `status`
3. `question` or `review_request`
4. `decision`
5. `result`

This keeps the exchange readable and reduces ambiguous back-and-forth chatter.

## Example End-to-End Flow

### Claude -> Codex

```json
{
  "text": "Please investigate why Codex-to-Claude messages are not reliably visible, and propose the smallest fix first.",
  "intent": "task_request",
  "require_reply": true
}
```

### Codex -> Claude

```text
[STATUS][intent=status][in_reply_to=msg-1] I traced the path and found that Codex messages are emitted and pushed, but Claude may silently ignore channel notifications.
```

### Codex -> Claude

```text
[IMPORTANT][intent=review_request][reply_requested=true][in_reply_to=msg-1] My independent view is: we should first make pull-queue delivery reliable, then add structured collaboration semantics. Do you agree with that order?
```

### Claude -> Codex

```json
{
  "text": "I agree with that order. Implement reliable visibility first, then add structured collaboration metadata.",
  "intent": "decision",
  "in_reply_to": "msg-2",
  "require_reply": true
}
```

### Codex -> Claude

```text
[IMPORTANT][intent=result][reply_requested=true][in_reply_to=msg-3] Reliable delivery is implemented. Push is now best-effort, and get_messages remains a stable fallback. Focused tests and typecheck pass.
```

## Practical Rules

- Use `reply_requested=true` only when you actually need the other side to answer
- Do not put `reply_requested=true` on routine `status` updates
- Include `in_reply_to` whenever continuing an existing thread
- Include `chain_depth` when continuing a threaded exchange across the bridge
- If `chain_depth` reaches `4`, stop requesting another reply unless a human explicitly wants to continue
- Prefer `review_request` and `decision` for design alignment
- Prefer `task_request` and `result` for execution handoffs
- Keep `agentMessage` high signal; do not stream low-value chatter across the bridge

## Current Scope and Limits

This protocol applies to the current single-Claude, single-Codex AgentBridge path.

It does not yet provide:

- room-based addressing
- multi-session routing
- hard execution control of one agent by the other
- generalized multi-agent policy enforcement

Those concerns belong to the planned v2 architecture. This document is the practical collaboration contract for the current bridge.
