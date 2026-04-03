# AgentBridge 演示脚本

本文档提供一套可直接操作的演示脚本，用来展示当前 AgentBridge 工作流下 Claude 与 Codex 的真实协作回路。

适用于演示或验证以下能力：

- Claude 可以向 Codex 发起任务
- Codex 可以回报状态并请求评审
- Claude 可以给出决策
- Codex 可以回传结果
- loop guard 可以防止对话无限来回 ping-pong

## 演示目标

演示一个真实协作场景：

> Codex 到 Claude 的消息不是稳定可见的，两个 Agent 协作诊断并修复这个问题。

## 开始前准备

推荐启动方式：

1. 通过 AgentBridge 启动 Claude：

```bash
agentbridge claude
```

2. 在另一个终端启动 Codex：

```bash
agentbridge codex
```

3. 如果你所在环境里的 channel 投递不稳定，确认 Claude 仍然可以通过 `get_messages` 读取消息。

4. 建议同时打开 [docs/agent-collaboration.zh-CN.md](agent-collaboration.zh-CN.md) 作为协议参考。

## 演示流程

### Round 1：Claude 发起任务

Claude 发送：

```json
{
  "text": "请调查为什么 Codex 到 Claude 的消息不能稳定可见。先从最小可行修复开始，在扩大范围之前先向我汇报。",
  "intent": "task_request",
  "require_reply": true
}
```

预期效果：

- Codex 收到一条边界清晰的任务请求
- 消息明确表示需要回复

### Round 2：Codex 发送状态更新

Codex 发送：

```text
[STATUS][intent=status][in_reply_to=msg-1][chain_depth=1] 我已经跟踪了链路，确认 Codex 消息确实会被发出并转发，但 Claude 在 push 模式下可能会静默忽略 channel notification。
```

预期效果：

- Claude 看到一条 `status` 更新
- 该消息属于同一条线程
- 这一步通常不要求立刻回复

### Round 3：Codex 请求 Claude 对方向进行判断

Codex 发送：

```text
[IMPORTANT][intent=review_request][reply_requested=true][in_reply_to=msg-1][chain_depth=1] 我的独立判断是：应该先把 pull queue 的可靠性补齐，再把 push 保留为 best-effort。你是否同意这个方向？
```

预期效果：

- Claude 看到一条 `review_request`
- bridge 会把它标记为请求回复
- 这会成为本轮协作的主要决策点

### Round 4：Claude 给出决策

Claude 发送：

```json
{
  "text": "我同意。先实现可靠的 pull fallback，并保持改动尽量小。",
  "intent": "decision",
  "in_reply_to": "msg-2",
  "require_reply": true
}
```

预期效果：

- Codex 收到一条方向明确的 `decision`
- 回复会继续挂在线程上
- 链深会继续增加

### Round 5：Codex 汇报结果

Codex 发送：

```text
[IMPORTANT][intent=result][reply_requested=true][in_reply_to=msg-3][chain_depth=3] 可靠 fallback 投递已经实现。聚焦测试和 typecheck 通过。更广泛的 E2E 仍有与本次改动无关的既有环境问题。
```

预期效果：

- Claude 看到一条最终 `result`
- 整段协作保持高信号、结构化

### Round 6：Claude 收尾

Claude 发送：

```json
{
  "text": "很好。先停在这里，并总结一下用户可见影响。",
  "intent": "task_request",
  "in_reply_to": "msg-4",
  "require_reply": true
}
```

预期效果：

- 如果当前回复链已经足够深，loop guard 会自动降级下一轮回复请求
- 消息仍然会正常发送
- bridge 不会继续鼓励无止境的来回互动

## 观察重点

演示过程中，重点观察以下信号：

1. Claude 能稳定看到 Codex 发来的消息
2. `get_messages` 输出里包含 `intent`、`in_reply_to` 和 `chain_depth`
3. Codex 可以明确请求 Claude 做 review 或给 decision
4. Claude 可以带结构化元数据回复
5. 当链深过深时，回复请求会被自动降级

## 最小 3 步演示版

如果你只想快速 smoke test，可以用这个更短的流程。

### Step 1：Claude -> Codex

```json
{
  "text": "请 review 一下我提出的修复方向。",
  "intent": "review_request",
  "require_reply": true
}
```

### Step 2：Codex -> Claude

```text
[IMPORTANT][intent=decision][reply_requested=true][in_reply_to=msg-1][chain_depth=1] 我同意先做小修复的方向。
```

### Step 3：Claude -> Codex

```json
{
  "text": "继续实现，并汇报结果。",
  "intent": "task_request",
  "in_reply_to": "msg-2",
  "require_reply": true
}
```

## 故障排查提示

- 如果 Claude 没有明显收到 Codex 消息，先用 `get_messages` 验证 pull queue 路径是否仍然可用。
- 如果往返显得太啰嗦，减少在 `status` 消息里使用 `reply_requested=true`。
- 如果线程后段不再请求回复，检查是否是 loop guard 已经把回复请求降级。
- 如果你确实还要继续下一轮，在人类明确判断后再继续，而不是试图强行绕过 bridge 的防环保护。
