# Coding Review Loop

This workflow is for the most practical Claude/Codex coding collaboration pattern in AgentBridge:

- Claude acts as planner, reviewer, and quality gatekeeper
- Codex acts as implementer and executor
- The two agents iterate until the agreed quality bar is reached

## Goal

Use AgentBridge to run a repeatable coding loop:

1. Claude analyzes the task and defines constraints
2. Claude sends an implementation request to Codex
3. Codex writes or updates code
4. Claude waits for Codex, reviews the result, and sends follow-up feedback
5. The loop continues until the stop criteria are satisfied

## Role Split

Claude:

- Understand the user request
- Define implementation boundaries
- Review code and identify bugs, risks, regressions, and missing tests
- Decide whether the work is acceptable

Codex:

- Implement the requested changes
- Revise code based on Claude feedback
- Report results, checks, and constraints

## Recommended Tool Flow

For each iteration:

1. Claude preferably uses `reply_and_wait` to send the current task or review feedback to Codex and wait in one step
2. If finer control is needed, Claude can still use `reply` followed by `wait_for_codex`
3. Claude summarizes Codex's result in the chat
4. Claude either:
   - approves the work, or
   - sends another review round to Codex

Use `reply_and_wait` for the smoothest iterative collaboration flow.
Use `wait_for_codex` when you need explicit two-step control.
Use `get_messages` only for a quick mailbox check.

## Suggested Stop Criteria

Stop only when all relevant checks are satisfied:

- typecheck passes
- relevant tests pass
- requested behavior is implemented
- Claude has no blocking review findings left
- no obvious high-risk regression remains

If any item is not satisfied, the loop should continue.

## Prompt Template

Use the following prompt in Claude to enter this workflow:

```text
From now on, you and Codex must collaborate in a fixed coding-review loop until the stop criteria are met.

Your role:
- You are the Reviewer / Planner / Quality Gatekeeper
- You are responsible for understanding the task, constraining the implementation, reviewing quality, and deciding when the work is done

Codex's role:
- Codex is the Implementer / Executor
- Codex is responsible for writing code, revising code, and responding to your review feedback

Workflow:
1. First analyze the user's task and define the goal, scope, constraints, and stop criteria.
2. Then use agentbridge reply_and_wait to send a concrete implementation task to Codex and wait for Codex's response.
3. If reply_and_wait is not appropriate, use agentbridge reply and then wait_for_codex.
4. When wait_for_codex returns, you must explicitly show a Codex result summary in the chat in the format:
   Codex: <summary>
5. Then perform a code review.
6. Prioritize:
   - bugs
   - risks
   - regressions
   - edge cases
   - missing tests
   - type issues
   - weak implementation decisions
7. If problems remain, send clear, actionable feedback to Codex through agentbridge reply and then call wait_for_codex again.
8. Continue until the stop criteria are fully met.

Stop criteria:
- typecheck passes
- relevant tests pass
- the requested behavior is implemented
- you have no blocking review findings left
- there is no obvious high-risk regression

Rules:
- Do not just say "Codex replied" — show the result summary.
- Prefer reply_and_wait for iterative work.
- If you use a split flow, prefer wait_for_codex over a single get_messages call.
- Do not stop early unless the stop criteria are satisfied.
- If Codex says the work is done, verify it independently before approving.
```

## Practical Notes

- This workflow reduces the amount of manual prompting during iterative coding
- It does not bypass Claude product-level safety confirmations
- If you want fewer interruptions, keep the orchestration prompt stable across the whole task
- For tasks with many iterations, explicitly restate the stop criteria at the beginning
