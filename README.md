# Claude Codex Loop

[中文文档](README.zh-CN.md)

Claude Codex Loop is a local runtime that helps Claude Code and Codex work as a paired engineering system: Claude reviews and directs, Codex implements and iterates, and both agents collaborate through structured turn-based loops.

- Structured Claude/Codex coding-review loops
- Reliable bidirectional delivery with pull fallback
- Turn-based collaboration tools like `wait_for_codex` and `reply_and_wait`

## Acknowledgements

Claude Codex Loop builds on ideas and implementation foundations that originated in the original `agent-bridge` project. We would like to acknowledge that work for establishing the early bridge architecture, the Claude/Codex integration path, and the initial collaboration model that helped make this project possible.

Claude Codex Loop uses a two-process architecture:

- **bridge.ts** is the foreground MCP client started by Claude Code via the Claude Codex Loop plugin
- **daemon.ts** is a persistent local background process that owns the Codex app-server proxy and bridge state

When Claude Code closes, the foreground MCP process exits while the background daemon and Codex proxy keep running. When Claude Code starts again, it reconnects automatically with exponential backoff.

## What this project is / is not

**This project is:**

- A local developer tool for connecting Claude Code and Codex in one workflow
- A bridge that forwards messages between an MCP channel and the Codex app-server protocol
- An experimental setup for human-in-the-loop collaboration between multiple agents

**This project is not:**

- A hosted service or multi-tenant system
- A generic orchestration framework for arbitrary agent backends
- A hardened security boundary between tools you do not trust

## Architecture

```
┌──────────────┐     MCP stdio / plugin     ┌────────────────────┐
│ Claude Code  │ ──────────────────────────▶ │ bridge.ts          │
│ Session      │ ◀──────────────────────────  │ foreground client  │
└──────────────┘                             └─────────┬──────────┘
                                                       │
                                                       │ control WS (:4502)
                                                       ▼
                                             ┌────────────────────┐
                                             │ daemon.ts          │
                                             │ bridge daemon      │
                                             └─────────┬──────────┘
                                                       │
                                     ws://127.0.0.1:4501 proxy
                                                       │
                                                       ▼
                                             ┌────────────────────┐
                                             │ Codex app-server   │
                                             └────────────────────┘
```

### Data flow

| Direction | Path |
|-----------|------|
| **Codex -> Claude** | `daemon.ts` captures `agentMessage` -> control WS -> `bridge.ts` -> `notifications/claude/channel` |
| **Claude -> Codex** | Claude calls the `reply` tool -> `bridge.ts` -> control WS -> `daemon.ts` -> `turn/start` injects into the Codex thread |

### Loop prevention

Each message carries a `source` field (`"claude"` or `"codex"`). The bridge never forwards a message back to its origin.

## Prerequisites

| Dependency | Version | Install |
|-----------|---------|---------|
| [Bun](https://bun.sh) | v1.0+ | `curl -fsSL https://bun.sh/install \| bash` |
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | v2.1.80+ | `npm install -g @anthropic-ai/claude-code` |
| [Codex CLI](https://github.com/openai/codex) | latest | `npm install -g @openai/codex` |

> **Note:** Bun is required as the runtime for the Claude Codex Loop daemon and plugin server. Node.js alone is not sufficient.

## Quick Start

### Install via Plugin Marketplace (recommended)

Install Claude Codex Loop directly from Claude Code using the plugin marketplace:

```bash
# 1. In Claude Code, add the Claude Codex Loop marketplace
/plugin marketplace add liuyue/claude-codex-loop

# 2. Install the plugin
/plugin install claude-codex-loop@claude-codex-loop

# 3. Reload plugins to activate
/reload-plugins
```

Then install the CLI tool:

```bash
# 4. Install the CLI globally
npm install -g claude-codex-loop

# 5. Generate project config (optional)
ccl init

# 6. Start Claude Code with Claude Codex Loop channel enabled
ccl claude

# 7. Start Codex TUI connected to the bridge (in another terminal)
ccl codex
```

> **Tip:** `ccl` is a short alias for `claude-codex-loop`. Both commands are identical — use whichever you prefer.

That's it. The daemon starts automatically when needed and reconnects if restarted.

#### Updating the plugin

When a new version is released, update from Claude Code:

```bash
/plugin marketplace update claude-codex-loop
/reload-plugins
```

Or enable auto-update: run `/plugin` → **Marketplaces** tab → select **claude-codex-loop** → **Enable auto-update**.

### Install for local development

If you want to modify Claude Codex Loop source code, use the local development setup instead:

```bash
# 1. Clone and install dependencies
git clone https://github.com/liuyue/claude-codex-loop.git
cd claude-codex-loop
bun install
bun link

# 2. Set up local plugin + project config
claude-codex-loop dev     # Register local marketplace + install plugin
claude-codex-loop init    # Check dependencies, generate .claude-codex-loop/config.json

# 3. Start Claude Code with Claude Codex Loop plugin loaded
claude-codex-loop claude

# 4. Start Codex TUI connected to the bridge (in another terminal)
claude-codex-loop codex
```

> **Note:** `claude-codex-loop claude` injects `--dangerously-load-development-channels plugin:claude-codex-loop@claude-codex-loop` automatically. This loads a local development channel into Claude Code (currently a Research Preview workflow). Only enable channels and MCP servers you trust.

#### Updating after code changes

After modifying Claude Codex Loop source code, re-run `claude-codex-loop dev` to sync changes to the plugin cache, then restart Claude Code or run `/reload-plugins` in an active session.

## CLI Reference

> All commands work with both `claude-codex-loop` and the short alias `ccl`.

| Command | Description |
|---------|-------------|
| `ccl init` | Install plugin, check dependencies (bun/claude/codex), generate `.claude-codex-loop/config.json` and `collaboration.md` |
| `ccl claude [args...]` | Start Claude Code with push channel enabled. Clears any killed sentinel from a previous `kill`. Pass-through args are forwarded to `claude` |
| `ccl codex [args...]` | Start Codex TUI connected to Claude Codex Loop daemon. Manages TUI process lifecycle (pid tracking, cleanup). Pass-through args forwarded to `codex` |
| `ccl kill` | Gracefully stop both daemon and managed Codex TUI, clean up state files, write killed sentinel |
| `ccl dev` | (Dev only) Register local marketplace + force-sync plugin to cache |
| `ccl --help` | Show help |
| `ccl --version` | Show version |

### Owned flags

Some flags are automatically injected and cannot be manually specified:

- `claude-codex-loop claude` owns: `--channels`, `--dangerously-load-development-channels`
- `claude-codex-loop codex` owns: `--remote`, `--enable tui_app_server`

Passing these flags manually will result in a hard error with guidance to use the native command directly.

## Project Config

Running `claude-codex-loop init` creates a `.claude-codex-loop/` directory in your project root:

| File | Purpose |
|------|---------|
| `config.json` | Machine-readable project config (ports, agent roles, markers, turn coordination) |
| `collaboration.md` | Human/agent-readable collaboration rules (roles, thinking patterns, communication style) |

The config is loaded by the CLI and daemon at startup. Re-running `init` is idempotent and will not overwrite existing files.

### Collaboration Message Example

For the full practical protocol, see [docs/agent-collaboration.md](docs/agent-collaboration.md). A typical exchange looks like this:

Claude -> Codex:

```json
{
  "text": "Please investigate why Codex-to-Claude messages are not reliably visible, and propose the smallest fix first.",
  "intent": "task_request",
  "require_reply": true
}
```

Codex -> Claude:

```text
[IMPORTANT][intent=review_request][reply_requested=true][in_reply_to=msg-1] My independent view is: we should first make pull-queue delivery reliable, then add structured collaboration semantics. Do you agree with that order?
```

## File Structure

```
agent_bridge/
├── .github/
│   ├── ISSUE_TEMPLATE/           # Bug report and feature request templates
│   ├── pull_request_template.md
│   └── workflows/ci.yml          # GitHub Actions CI
├── assets/                        # Static assets (images, etc.)
├── docs/
│   ├── phase3-spec.md            # Phase 3 design spec (CLI + Plugin)
│   ├── v1-roadmap.md             # v1 feature roadmap
│   └── v2-architecture.md        # v2 multi-agent architecture design
├── plugins/claude-codex-loop/    # Claude Code plugin bundle
│   ├── .claude-plugin/plugin.json
│   ├── commands/init.md
│   ├── hooks/hooks.json
│   ├── scripts/health-check.sh
│   └── server/                    # Bundled bridge-server.js + daemon.js
├── src/
│   ├── bridge.ts                  # Claude foreground MCP client (plugin entry point)
│   ├── daemon.ts                  # Persistent background daemon
│   ├── daemon-client.ts           # WebSocket client for daemon control port
│   ├── daemon-lifecycle.ts        # Shared daemon lifecycle (ensureRunning, kill, startup lock)
│   ├── control-protocol.ts        # Foreground/background control protocol types
│   ├── claude-adapter.ts          # MCP server adapter for Claude Code channels
│   ├── codex-adapter.ts           # Codex app-server WebSocket proxy and message interception
│   ├── config-service.ts          # Project config (.claude-codex-loop/) read/write
│   ├── state-dir.ts               # Platform-aware state directory resolver
│   ├── message-filter.ts          # Smart message filtering (markers, summary buffer)
│   ├── types.ts                   # Shared types
│   ├── cli.ts                     # CLI entry point and command router
│   └── cli/
│       ├── init.ts                # claude-codex-loop init
│       ├── claude.ts              # claude-codex-loop claude
│       ├── codex.ts               # claude-codex-loop codex
│       ├── kill.ts                # claude-codex-loop kill
│       └── dev.ts                 # claude-codex-loop dev
├── CLAUDE.md                      # Project rules for AI agents
├── CODE_OF_CONDUCT.md
├── CONTRIBUTING.md
├── LICENSE
├── README.md
├── README.zh-CN.md
├── SECURITY.md
├── package.json
└── tsconfig.json
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CODEX_WS_PORT` | `4500` | Codex app-server WebSocket port |
| `CODEX_PROXY_PORT` | `4501` | Bridge proxy port for the Codex TUI |
| `AGENTBRIDGE_CONTROL_PORT` | `4502` | Control port between bridge.ts and daemon.ts |
| `AGENTBRIDGE_STATE_DIR` | Platform default | State directory for pid, status, logs (macOS: `~/Library/Application Support/Claude Codex Loop/`, Linux: `$XDG_STATE_HOME/claude-codex-loop/`) |
| `AGENTBRIDGE_MODE` | `push` | Message delivery mode (`push` for channels, `pull` for API key mode) |
| `AGENTBRIDGE_DAEMON_ENTRY` | `./daemon.ts` | Override daemon entry point (used by plugin bundles) |

### State Directory

The daemon stores runtime state in a platform-aware directory:

| Platform | Default Path |
|----------|-------------|
| macOS | `~/Library/Application Support/Claude Codex Loop/` |
| Linux | `$XDG_STATE_HOME/claude-codex-loop/` (fallback: `~/.local/state/claude-codex-loop/`) |

Contents: `daemon.pid`, `status.json`, `claude-codex-loop.log`, `killed` (sentinel), `startup.lock`

## Current Limitations

- Only forwards `agentMessage` items, not intermediate `commandExecution`, `fileChange`, or similar events
- Single Codex thread, no multi-session support yet
- Single Claude foreground connection; a new Claude session replaces the previous one
- Fixed ports mean only one Claude Codex Loop instance per machine (multi-project support planned for post-v1)

### Codex git restrictions

Codex runs in a sandboxed environment that **blocks all writes to the `.git` directory**. This means Codex cannot run `git commit`, `git push`, `git pull`, `git checkout -b`, `git merge`, or any other command that modifies git metadata. Attempting these commands will cause the Codex session to hang indefinitely.

**Recommendation:** Let Claude Code handle all git operations (branching, committing, pushing, creating PRs). Codex should focus on code changes and report completed work via `agentMessage`, then Claude Code takes care of the git workflow.

## Roadmap

- **v1.x (current)**: Improve the single-bridge experience without architectural refactoring -- less noise, better turn discipline, and clearer collaboration modes. See [docs/v1-roadmap.md](docs/v1-roadmap.md).
- **Current collaboration contract**: For the practical Claude/Codex message protocol used in the current bridge, see [docs/agent-collaboration.md](docs/agent-collaboration.md).
- **Demo script**: For a practical end-to-end demonstration flow, see [docs/demo-script.md](docs/demo-script.md).
- **Coding review loop**: For a practical Claude-review / Codex-implement workflow prompt, see [docs/coding-review-loop.md](docs/coding-review-loop.md).
- **v2 (planned)**: Introduce the multi-agent foundation -- room-scoped collaboration, stable identity, a formal control protocol, and stronger recovery semantics. See [docs/v2-architecture.md](docs/v2-architecture.md).
- **v3+ (longer term)**: Explore smarter collaboration, richer policies, and more advanced orchestration across runtimes.

## How This Project Was Built

This project was built collaboratively by **Claude Code** (Anthropic) and **Codex** (OpenAI), communicating through Claude Codex Loop itself -- the very tool they were building together. A human developer coordinated the effort, assigning tasks, reviewing progress, and directing the two agents to work in parallel and review each other's output.

In other words, Claude Codex Loop is its own proof of concept: two AI agents from different providers, connected in real time, shipping code side by side.

