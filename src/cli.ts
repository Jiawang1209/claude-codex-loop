#!/usr/bin/env bun

/**
 * Claude Codex Loop CLI
 *
 * Commands:
 *   claude-codex-loop init        — Install plugin, check deps, generate project config
 *   claude-codex-loop dev         — Register local marketplace + install plugin for local dev
 *   claude-codex-loop claude      — Start Claude Code with push channel flags
 *   claude-codex-loop codex       — Start Codex TUI connected to daemon
 *   claude-codex-loop kill        — Force kill all Claude Codex Loop processes
 */

const args = process.argv.slice(2);
const command = args[0];
const restArgs = args.slice(1);

// Marketplace name constant (shared with plugin)
export const MARKETPLACE_NAME = "claude-codex-loop";
export const PLUGIN_NAME = "claude-codex-loop";

async function main() {
  switch (command) {
    case "init":
      const { runInit } = await import("./cli/init");
      await runInit();
      break;
    case "dev":
      const { runDev } = await import("./cli/dev");
      await runDev();
      break;
    case "claude":
      const { runClaude } = await import("./cli/claude");
      await runClaude(restArgs);
      break;
    case "codex":
      const { runCodex } = await import("./cli/codex");
      await runCodex(restArgs);
      break;
    case "kill":
      const { runKill } = await import("./cli/kill");
      await runKill();
      break;
    case "--help":
    case "-h":
    case undefined:
      printHelp();
      break;
    case "--version":
    case "-v":
      printVersion();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error(`Run "claude-codex-loop --help" (or "ccl --help") for usage.`);
      process.exit(1);
  }
}

function printHelp() {
  console.log(`
Claude Codex Loop — Multi-agent collaboration runtime

Usage:
  claude-codex-loop <command> [args...]
  ccl <command> [args...]

Commands:
  init              Install plugin, check dependencies, generate project config
  dev               Register local marketplace + install plugin (for local dev)
  claude [args...]  Start Claude Code with push channel enabled
  codex [args...]   Start Codex TUI connected to the Claude Codex Loop daemon
  kill              Force kill all Claude Codex Loop processes

Options:
  --help, -h        Show this help message
  --version, -v     Show version

Examples:
  ccl init                     # First-time setup
  ccl claude                   # Start Claude Code
  ccl claude --resume          # Start Claude Code and resume session
  ccl codex                    # Start Codex TUI
  ccl codex --model o3         # Start Codex with specific model
  ccl kill                     # Emergency: kill all processes
`.trim());
}

function printVersion() {
  try {
    const pkg = require("../package.json");
    console.log(`claude-codex-loop v${pkg.version}`);
  } catch {
    console.log("claude-codex-loop (version unknown)");
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
