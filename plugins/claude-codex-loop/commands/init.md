---
description: Create or update the Claude Codex Loop project config files in the current workspace
allowed-tools: Read,Write,Edit,MultiEdit,LS
---

Bootstrap or update Claude Codex Loop's project-local configuration in this workspace.

Follow these rules:

1. Work only inside `.claude-codex-loop/`.
2. Do not install plugins or modify `.claude/settings.json` here. Plugin setup belongs to terminal workflows: `claude-codex-loop init` attempts best-effort plugin installation, and `claude-codex-loop dev` handles local marketplace registration/sync.
3. Preserve user edits when the files already exist. Update only the fields the user asked to change.
4. Keep `.claude-codex-loop/config.json` valid JSON.
5. Keep `.claude-codex-loop/collaboration.md` human-editable and concise.

If `.claude-codex-loop/config.json` is missing, create it with this default template:

```json
{
  "version": "1.0",
  "daemon": {
    "port": 4500,
    "proxyPort": 4501
  },
  "agents": {
    "claude": {
      "role": "Reviewer, Planner",
      "mode": "push"
    },
    "codex": {
      "role": "Implementer, Executor"
    }
  },
  "markers": ["IMPORTANT", "STATUS", "FYI"],
  "turnCoordination": {
    "attentionWindowSeconds": 15,
    "busyGuard": true
  },
  "idleShutdownSeconds": 30
}
```

If `.claude-codex-loop/collaboration.md` is missing, create it with this default template:

```markdown
# Collaboration Rules

## Roles
- Claude: Reviewer, Planner, Hypothesis Challenger
- Codex: Implementer, Executor, Reproducer/Verifier

## Thinking Patterns
- Analytical/review tasks: Independent Analysis & Convergence
- Implementation tasks: Architect -> Builder -> Critic
- Debugging tasks: Hypothesis -> Experiment -> Interpretation

## Communication
- Use explicit phrases: "My independent view is:", "I agree on:", "I disagree on:", and "Current consensus:"
- Tag messages with [IMPORTANT], [STATUS], or [FYI]

## Review Process
- Cross-review: author never reviews their own code
- All changes go through feature/fix branches + PR
- Merge via squash merge

## Custom Rules
<!-- Add project-specific collaboration rules here -->
```

When you finish, briefly summarize what changed and point the user to the two files you updated.
