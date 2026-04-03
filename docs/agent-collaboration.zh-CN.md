# Agent 协作协议

本文档定义了 AgentBridge 在当前单桥工作流下，Claude 与 Codex 之间的实用协作约定。

它刻意保持轻量：

- 底层传输仍然使用现有 AgentBridge
- 接收方始终自行决定是否响应
- 消息可以携带轻量级协作元数据
- 该协议面向稳定的日常实践，而不是完整的 v2 room 路由体系

## 目标

这套协议希望提供：

- 双向都可靠可见的消息传递
- 比纯自然语言更清晰的协作意图
- 一种“希望收到回应”但不强制执行的表达方式
- 轻量级的往返线程关联能力
- 一组共享词汇，用于表达任务、评审、决策和结果

## 核心原则

### 1. 消息是请求，不是命令

AgentBridge 传递的是协作消息，不会把一方变成另一方的控制器。

- 发送方可以请求工作、评审或澄清
- 接收方决定是否回应、以及如何回应
- `reply_requested` 的含义是“如果合适请回复”，而不是“你必须执行”

### 2. 优先使用显式意图

纯文本仍然允许，但当发送方希望接收方快速、稳定地理解消息目的时，应该优先使用结构化 `intent`。

### 3. 延续同一条讨论时使用线程关联

当你在回复上一条消息时，使用 `in_reply_to=<message-id>`，这样往返过程会更清楚。

### 4. 只有真正需要回合推进时才请求回复

不是每条更新都需要对方回应。只有问题、评审请求和决策类消息才应该更常使用回复请求，这样噪音会更低。

## 消息形态

当前 AgentBridge 支持的桥接消息元数据包括：

- `intent`
- `replyRequested`
- `inReplyTo`
- `chainDepth`

当前支持的 `intent` 值：

- `chat`
- `question`
- `task_request`
- `review_request`
- `status`
- `decision`
- `result`
- `system`

## Codex 消息前缀格式

当 Codex 发送高价值 `agentMessage` 时，建议使用如下前缀格式：

```text
[MARKER][intent=<intent>][reply_requested=true][in_reply_to=<message-id>][chain_depth=<n>] 消息正文...
```

其中：

- `MARKER` 取值为 `IMPORTANT`、`STATUS` 或 `FYI`
- `intent` 可选，但建议尽量填写
- `reply_requested=true` 可选
- `in_reply_to=<message-id>` 可选
- `chain_depth=<n>` 可选

示例：

```text
[IMPORTANT][intent=review_request][reply_requested=true][in_reply_to=msg-123][chain_depth=2] 请先评审一下 reconnect 修复方案，再决定我是否继续。
```

## 防循环保护

为了减少 Agent 之间反复来回 ping-pong，AgentBridge 会携带一个轻量级回复链深计数：

- `chain_depth=0` 或省略表示一条新的消息
- 当你在回复一条已有 chain depth 的消息时，链深应加 1
- 当链深达到 `4` 时，不应再继续把这条消息标记为“请求下一次回复”

这意味着：

- 消息仍然会被看到
- 接收方如果愿意，仍然可以继续响应
- 但 bridge 不会再继续鼓励下一轮自动化回复

## Claude `reply` 工具用法

当 Claude 向 Codex 发送结构化回复时，`reply` 工具建议使用：

- `text`
- 在需要时设置 `intent`
- 在回复上一条消息时设置 `in_reply_to`
- 只有确实需要对方回应时才设置 `require_reply=true`

概念示例：

```json
{
  "text": "我同意这个方向。保留 fallback queue，但避免重复的用户可见文案。",
  "intent": "decision",
  "in_reply_to": "msg-123",
  "require_reply": true
}
```

## 推荐的 intent 用法

### `task_request`

用于请求对方完成一段边界清晰的工作。

适合的例子：

- “请先复现这个 bug，并定位失败点。”
- “请先做最小修复，不要扩大范围。”

### `review_request`

用于请求对方评审代码、推理过程或方向。

适合的例子：

- “请先 review 这个 patch，再决定我是否继续。”
- “请帮我 sanity-check 一下这个迁移方案。”

### `question`

用于继续推进之前需要一个明确答案的场景。

适合的例子：

- “这里要不要保留向后兼容？”
- “你希望我做最小修复，还是顺手做一轮清理？”

### `decision`

用于给出结论、方向或明确判断。

适合的例子：

- “先做最小修复。”
- “这一阶段不要改 CLI 表面行为。”

### `status`

用于汇报进度，通常不要求立即回复。

适合的例子：

- “我已经复现问题，并定位到 channel delivery。”
- “聚焦测试通过，但 broader E2E 仍有既有测试夹具问题。”

### `result`

用于汇报完成或明确结果。

适合的例子：

- “可靠投递已经实现。”
- “typecheck 通过，聚焦桥接测试全绿。”

### `chat`

当没有更明确的意图类型时，用于一般性非关键交流。

### `system`

保留给 AgentBridge 自身生成的系统消息。

## 推荐协作节奏

对于大多数实现任务，建议按下面这个顺序协作：

1. `task_request`
2. `status`
3. `question` 或 `review_request`
4. `decision`
5. `result`

这样往返会更清晰，也能减少模糊的来回 chatter。

## 端到端示例

### Claude -> Codex

```json
{
  "text": "请调查为什么 Codex 到 Claude 的消息不能稳定可见，并优先提出一个最小修复方案。",
  "intent": "task_request",
  "require_reply": true
}
```

### Codex -> Claude

```text
[STATUS][intent=status][in_reply_to=msg-1] 我已经跟踪了链路，发现 Codex 消息确实会发出并被 push，但 Claude 可能会静默忽略 channel notification。
```

### Codex -> Claude

```text
[IMPORTANT][intent=review_request][reply_requested=true][in_reply_to=msg-1] 我的独立判断是：应该先把 pull queue 的可靠性补齐，再增加结构化协作语义。你是否同意这个顺序？
```

### Claude -> Codex

```json
{
  "text": "我同意这个顺序。先实现可靠可见，再补结构化协作元数据。",
  "intent": "decision",
  "in_reply_to": "msg-2",
  "require_reply": true
}
```

### Codex -> Claude

```text
[IMPORTANT][intent=result][reply_requested=true][in_reply_to=msg-3] 可靠投递已经实现。push 现在是 best-effort，get_messages 仍然是稳定 fallback。聚焦测试和 typecheck 都已通过。
```

## 实践规则

- 只有真的需要对方回答时才使用 `reply_requested=true`
- 常规 `status` 更新不要滥用 `reply_requested=true`
- 当你在延续某条讨论时，尽量带上 `in_reply_to`
- 当你在桥上延续同一条线程时，尽量带上 `chain_depth`
- 当 `chain_depth` 到达 `4` 时，除非人类明确要求继续，否则不要再请求下一次回复
- 设计对齐时优先使用 `review_request` 和 `decision`
- 执行交接时优先使用 `task_request` 和 `result`
- 保持 `agentMessage` 高信号，不要把低价值的过程噪音持续桥接过去

## 当前范围与限制

这套协议适用于当前的单 Claude、单 Codex AgentBridge 路径。

它暂时还不提供：

- room 级寻址
- 多 session 路由
- 一方对另一方的硬控制执行能力
- 通用多 Agent policy enforcement

这些能力属于计划中的 v2 架构范围。本文档是当前桥接模式下的实用协作规范。
