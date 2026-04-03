# Claude Codex Loop Plugin

Claude Code plugin for Claude Codex Loop. This plugin packages the Claude Codex Loop MCP frontend, dual-mode Claude transport (push channel delivery plus pull-mode `get_messages`), the `/claude-codex-loop:init` command, and a non-blocking SessionStart health check.

## Structure

```text
plugins/claude-codex-loop/
├── .claude-plugin/plugin.json
├── .mcp.json
├── commands/init.md
├── hooks/hooks.json
├── scripts/health-check.sh
└── server/
    ├── bridge-server.js
    └── daemon.js
```

## Build

Run:

```bash
bun run build:plugin
```

This creates self-contained bundles at:

- `plugins/claude-codex-loop/server/bridge-server.js`
- `plugins/claude-codex-loop/server/daemon.js`

## Local Testing

1. Build the plugin bundles: `bun run build:plugin`
2. In Claude Code, load the plugin from this repo or install it from the marketplace manifest in `.claude-plugin/marketplace.json`
3. Reload plugins in the active session with `/reload-plugins`

## Notes

- The plugin frontend launches the sibling daemon bundle via `AGENTBRIDGE_DAEMON_ENTRY=./daemon.js`.
- Claude delivery supports both push notifications and pull-mode polling via `get_messages`, depending on the runtime mode.
- The SessionStart hook is informational only. It never starts or stops the daemon.
- The command at `/claude-codex-loop:init` edits project-local `.claude-codex-loop/` files only; plugin installation and marketplace registration remain terminal-side tasks (`claude-codex-loop init` / `claude-codex-loop dev`).
