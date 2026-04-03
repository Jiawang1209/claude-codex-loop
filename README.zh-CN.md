# Claude Codex Loop

English version: [README.md](README.md)

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Claude Codex Loop 是一个让 Claude Code 和 Codex 在同一工作会话中进行结构化协作的本地运行时，支持实现-审查循环、回合制执行和多轮迭代式开发。

- 面向 Claude / Codex 的结构化编码审查循环
- 带 pull fallback 的可靠双向消息传递
- 提供 `wait_for_codex`、`reply_and_wait` 等回合协作工具

## 致谢

Claude Codex Loop 建立在原始 `agent-bridge` 项目的思路与实现基础之上。我们特别感谢这项工作在早期桥接架构、Claude/Codex 集成路径以及初始协作模型上的探索，这些基础为当前项目的发展提供了重要起点。

Claude Codex Loop 采用两层进程结构：

- **bridge.ts** 是由 Claude Code 通过 Claude Codex Loop 插件启动的前台 MCP 客户端
- **daemon.ts** 是常驻本地的后台进程，持有 Codex app-server 代理和桥接状态

当 Claude Code 关闭时，前台 MCP 进程退出，后台 daemon 与 Codex 代理继续存活。当 Claude Code 再次启动时，会自动重连（指数退避）。

## 这个项目是什么 / 不是什么

**这个项目是：**

- 一个把 Claude Code 和 Codex 连接到同一工作流里的本地开发工具
- 一个在 MCP channel 与 Codex app-server 协议之间转发消息的桥接层
- 一个面向人工参与、多代理协作场景的实验性方案

**这个项目不是：**

- 一个托管服务或多租户系统
- 一个面向任意 Agent 后端的通用编排框架
- 一个可以隔离不可信工具的强化安全边界

## 架构

```
┌──────────────┐    MCP stdio / plugin     ┌────────────────────┐
│ Claude Code  │ ─────────────────────────▶ │ bridge.ts          │
│ Session      │ ◀─────────────────────────  │ 前台 MCP 客户端     │
└──────────────┘                            └─────────┬──────────┘
                                                      │
                                                      │ 控制 WS (:4502)
                                                      ▼
                                            ┌────────────────────┐
                                            │ daemon.ts          │
                                            │ 常驻后台桥接进程    │
                                            └─────────┬──────────┘
                                                      │
                                    ws://127.0.0.1:4501 proxy
                                                      │
                                                      ▼
                                            ┌────────────────────┐
                                            │ Codex app-server   │
                                            └────────────────────┘
```

### 数据流

| 方向 | 链路 |
|------|------|
| **Codex -> Claude** | `daemon.ts` 捕获 `agentMessage` -> 控制 WS -> `bridge.ts` -> `notifications/claude/channel` |
| **Claude -> Codex** | Claude 调用 `reply` tool -> `bridge.ts` -> 控制 WS -> `daemon.ts` -> `turn/start` 注入 Codex thread |

### 防循环

每条消息都携带 `source` 字段（`"claude"` 或 `"codex"`），Bridge 永远不会把消息转发回它的来源。

## 前置条件

| 依赖 | 版本 | 安装方式 |
|------|------|----------|
| [Bun](https://bun.sh) | v1.0+ | `curl -fsSL https://bun.sh/install \| bash` |
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | v2.1.80+ | `npm install -g @anthropic-ai/claude-code` |
| [Codex CLI](https://github.com/openai/codex) | latest | `npm install -g @openai/codex` |

> **注意：** Bun 是 Claude Codex Loop daemon 和插件服务器的必要运行时，仅有 Node.js 不够。

## Quick Start

### 通过插件市场安装（推荐）

在 Claude Code 中直接安装 Claude Codex Loop 插件：

```bash
# 1. 在 Claude Code 中，添加 Claude Codex Loop 市场
/plugin marketplace add liuyue/claude-codex-loop

# 2. 安装插件
/plugin install claude-codex-loop@claude-codex-loop

# 3. 重新加载插件以激活
/reload-plugins
```

然后安装 CLI 工具：

```bash
# 4. 全局安装 CLI
npm install -g claude-codex-loop

# 5. 生成项目配置（可选）
ccl init

# 6. 启动 Claude Code（自动加载 Claude Codex Loop channel）
ccl claude

# 7. 在另一个终端启动 Codex TUI 连接 Bridge
ccl codex
```

> **提示：** `ccl` 是 `claude-codex-loop` 的简写别名，两个命令完全等价，用哪个都行。

就这样。Daemon 会在需要时自动启动，重启后自动重连。

#### 更新插件

新版本发布后，在 Claude Code 中更新：

```bash
/plugin marketplace update claude-codex-loop
/reload-plugins
```

或启用自动更新：执行 `/plugin` → **Marketplaces** 标签页 → 选择 **claude-codex-loop** → **Enable auto-update**。

### 本地开发安装

如需修改 Claude Codex Loop 源码，使用本地开发模式：

```bash
# 1. 克隆并安装依赖
git clone https://github.com/liuyue/claude-codex-loop.git
cd claude-codex-loop
bun install
bun link

# 2. 安装本地插件 + 生成项目配置
claude-codex-loop dev     # 注册本地 marketplace + 安装插件
claude-codex-loop init    # 检查依赖、生成 .claude-codex-loop/config.json

# 3. 启动 Claude Code（自动加载 Claude Codex Loop 插件）
claude-codex-loop claude

# 4. 在另一个终端启动 Codex TUI 连接 Bridge
claude-codex-loop codex
```

> **注意：** `claude-codex-loop claude` 会自动注入 `--dangerously-load-development-channels plugin:claude-codex-loop@claude-codex-loop`。这会把本地开发中的 channel 挂载进 Claude Code（当前属于 Research Preview）。请只启用你信任的 channel 和 MCP server。

#### 修改代码后更新

修改 Claude Codex Loop 源码后，重新执行 `claude-codex-loop dev` 同步插件到缓存，然后重启 Claude Code 或在活跃会话中执行 `/reload-plugins`。

## CLI 命令参考

> 所有命令同时支持 `claude-codex-loop` 和简写别名 `ccl`。

| 命令 | 说明 |
|------|------|
| `ccl init` | 安装插件、检查依赖（bun/claude/codex）、生成 `.claude-codex-loop/config.json` 和 `collaboration.md` |
| `ccl claude [args...]` | 启动 Claude Code 并启用 push channel。自动清除之前 `kill` 留下的 sentinel。额外参数透传给 `claude` |
| `ccl codex [args...]` | 启动连接到 Claude Codex Loop daemon 的 Codex TUI。管理 TUI 进程生命周期（pid 跟踪、清理）。额外参数透传给 `codex` |
| `ccl kill` | 优雅停止 daemon 和托管的 Codex TUI，清理状态文件，写入 killed sentinel |
| `ccl dev` | （开发用）注册本地 marketplace + 强制同步插件到缓存 |
| `ccl --help` | 显示帮助 |
| `ccl --version` | 显示版本 |

### Owned flags

部分参数由 CLI 自动注入，不可手动指定：

- `claude-codex-loop claude` 拥有：`--channels`、`--dangerously-load-development-channels`
- `claude-codex-loop codex` 拥有：`--remote`、`--enable tui_app_server`

手动传入这些参数会报错，并提示使用原生命令。

## 项目配置

运行 `claude-codex-loop init` 会在项目根目录创建 `.claude-codex-loop/` 目录：

| 文件 | 用途 |
|------|------|
| `config.json` | 机器可读的项目配置（端口、Agent 角色、消息标记、回合协调） |
| `collaboration.md` | 人类/Agent 可读的协作规则（角色、思考模式、沟通风格） |

CLI 和 daemon 启动时会加载该配置。重复运行 `init` 是幂等的，不会覆盖已有文件。

### 协作消息示例

完整的实用协议见 [docs/agent-collaboration.zh-CN.md](docs/agent-collaboration.zh-CN.md)。一个典型往返示例如下：

Claude -> Codex：

```json
{
  "text": "请调查为什么 Codex 到 Claude 的消息不能稳定可见，并优先提出一个最小修复方案。",
  "intent": "task_request",
  "require_reply": true
}
```

Codex -> Claude：

```text
[IMPORTANT][intent=review_request][reply_requested=true][in_reply_to=msg-1] 我的独立判断是：应该先把 pull queue 的可靠性补齐，再增加结构化协作语义。你是否同意这个顺序？
```

## 文件结构

```
agent_bridge/
├── .github/
│   ├── ISSUE_TEMPLATE/           # Bug report 和 feature request 模板
│   ├── pull_request_template.md
│   └── workflows/ci.yml          # GitHub Actions CI
├── assets/                        # 图片资源
├── docs/
│   ├── phase3-spec.md            # Phase 3 设计文档（CLI + Plugin）
│   ├── v1-roadmap.md             # v1 功能路线图
│   └── v2-architecture.md        # v2 多 Agent 架构设计
├── plugins/claude-codex-loop/    # Claude Code 插件包
│   ├── .claude-plugin/plugin.json
│   ├── commands/init.md
│   ├── hooks/hooks.json
│   ├── scripts/health-check.sh
│   └── server/                    # 打包的 bridge-server.js + daemon.js
├── src/
│   ├── bridge.ts                  # Claude 前台 MCP 客户端（插件入口）
│   ├── daemon.ts                  # 常驻后台 daemon
│   ├── daemon-client.ts           # daemon 控制端口的 WebSocket 客户端
│   ├── daemon-lifecycle.ts        # 共享 daemon 生命周期（ensureRunning、kill、启动锁）
│   ├── control-protocol.ts        # 前后台控制协议类型
│   ├── claude-adapter.ts          # Claude Code channel 的 MCP server 适配层
│   ├── codex-adapter.ts           # Codex app-server WebSocket 代理与消息拦截
│   ├── config-service.ts          # 项目配置（.claude-codex-loop/）读写
│   ├── state-dir.ts               # 平台感知的状态目录解析
│   ├── message-filter.ts          # 智能消息过滤（标记、摘要缓冲）
│   ├── types.ts                   # 共享类型
│   ├── cli.ts                     # CLI 入口和命令路由
│   └── cli/
│       ├── init.ts                # claude-codex-loop init
│       ├── claude.ts              # claude-codex-loop claude
│       ├── codex.ts               # claude-codex-loop codex
│       ├── kill.ts                # claude-codex-loop kill
│       └── dev.ts                 # claude-codex-loop dev
├── CLAUDE.md                      # AI Agent 项目规则
├── CODE_OF_CONDUCT.md
├── CONTRIBUTING.md
├── LICENSE
├── README.md
├── README.zh-CN.md
├── SECURITY.md
├── package.json
└── tsconfig.json
```

## 配置

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CODEX_WS_PORT` | `4500` | Codex app-server WebSocket 端口 |
| `CODEX_PROXY_PORT` | `4501` | Bridge 代理端口，Codex TUI 连接此端口 |
| `AGENTBRIDGE_CONTROL_PORT` | `4502` | bridge.ts 与 daemon.ts 之间的控制端口 |
| `AGENTBRIDGE_STATE_DIR` | 平台默认 | 状态目录（pid、status、日志）。macOS: `~/Library/Application Support/Claude Codex Loop/`，Linux: `$XDG_STATE_HOME/claude-codex-loop/` |
| `AGENTBRIDGE_MODE` | `push` | 消息投递模式（`push` 用于 channel，`pull` 用于 API key 模式） |
| `AGENTBRIDGE_DAEMON_ENTRY` | `./daemon.ts` | 覆盖 daemon 入口（插件包使用） |

### 状态目录

daemon 在平台感知的目录中存储运行时状态：

| 平台 | 默认路径 |
|------|---------|
| macOS | `~/Library/Application Support/Claude Codex Loop/` |
| Linux | `$XDG_STATE_HOME/claude-codex-loop/`（回退：`~/.local/state/claude-codex-loop/`） |

内容：`daemon.pid`、`status.json`、`claude-codex-loop.log`、`killed`（sentinel）、`startup.lock`

## 当前限制

- 目前只转发 `agentMessage`，不转发 `commandExecution`、`fileChange` 等中间过程事件
- 当前只支持单个 Codex thread，不支持多会话
- 当前只支持单个 Claude 前台连接；新的 Claude 会话会替换旧连接
- 固定端口意味着每台机器只能运行一个 Claude Codex Loop 实例（多项目并行支持计划在 v1 之后）

### Codex 的 Git 操作限制

Codex 运行在沙箱环境中，**禁止对 `.git` 目录进行任何写操作**。这意味着 Codex 无法执行 `git commit`、`git push`、`git pull`、`git checkout -b`、`git merge` 等任何修改 Git 元数据的命令。尝试执行这些命令会导致 Codex 会话无限期挂起。

**建议做法：** 让 Claude Code 负责所有 Git 操作（创建分支、提交、推送、创建 PR）。Codex 专注于代码修改，通过 `agentMessage` 汇报完成的工作，由 Claude Code 负责 Git 工作流。

## Roadmap

- **v1.x（当前）**：在不改变架构的前提下优化单桥体验 -- 降噪、控回合、定角色。详见 [docs/v1-roadmap.md](docs/v1-roadmap.md)。
- **当前协作规范**：关于当前桥接模式下 Claude/Codex 的实用消息协议，详见 [docs/agent-collaboration.zh-CN.md](docs/agent-collaboration.zh-CN.md)。
- **演示脚本**：关于一套可直接演示的端到端协作流程，详见 [docs/demo-script.zh-CN.md](docs/demo-script.zh-CN.md)。
- **代码审查循环**：关于一套“Claude 审查、Codex 实现、循环迭代直到达标”的实用提示模板，详见 [docs/coding-review-loop.zh-CN.md](docs/coding-review-loop.zh-CN.md)。
- **v2（规划中）**：引入多 Agent 基础设施 -- Room 作用域协作、稳定身份、正式控制协议、更强的恢复语义。详见 [docs/v2-architecture.md](docs/v2-architecture.md)。
- **v3+（远期）**：更智能的协作、更丰富的策略、跨 runtime 的高级编排。

## 这个项目是怎么建成的

这个项目由 **Claude Code**（Anthropic）和 **Codex**（OpenAI）通过 Claude Codex Loop 本身进行实时双向通信，在人类开发者的指挥下协作完成。开发者负责分配任务、审查进度，并指挥两个 Agent 并行工作、互相 review。

换句话说，Claude Codex Loop 就是它自己的 proof of concept：两个来自不同厂商的 AI Agent，通过实时连接，肩并肩地交付代码。

