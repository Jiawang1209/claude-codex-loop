# 代码审查循环

这份工作流适用于 AgentBridge 里最实用的一类 Claude/Codex 编码协作模式：

- Claude 负责规划、审查和质量把关
- Codex 负责实际实现和执行
- 双方持续迭代，直到达到约定的完成标准

## 目标

通过 AgentBridge 跑一套可重复的编码循环：

1. Claude 先分析任务并定义约束
2. Claude 把实现任务发给 Codex
3. Codex 编写或修改代码
4. Claude 等待 Codex 返回后进行 review，并提出下一轮意见
5. 循环持续，直到满足结束标准

## 角色分工

Claude：

- 理解用户需求
- 定义实现边界
- 审查代码，识别 bug、风险、行为回归和缺失测试
- 判断当前工作是否可以通过

Codex：

- 实现所需改动
- 根据 Claude 的反馈持续修改
- 汇报结果、校验情况和限制条件

## 推荐工具流程

每一轮建议这样执行：

1. Claude 优先使用 `reply_and_wait`，一次把当前任务或 review 意见发给 Codex，并等待返回
2. 如果需要更细的控制，也可以继续使用 `reply` 再接 `wait_for_codex`
3. Claude 在聊天中展示 Codex 的结果摘要
4. Claude 再决定：
   - 通过，或
   - 发起下一轮修改

`reply_and_wait` 更适合顺滑的一轮一轮协作。  
`wait_for_codex` 更适合需要显式拆成两步的时候。  
`get_messages` 更适合做一次性的邮箱检查。

## 建议结束标准

只有在相关标准都满足时才停止：

- 类型检查通过
- 相关测试通过
- 请求的行为已经实现
- Claude 没有剩余阻塞级 review 问题
- 没有明显高风险回归

只要其中任何一项不满足，就继续循环。

## 提示词模板

你可以把下面这段提示词直接交给 Claude，进入这套工作模式：

```text
从现在开始，你和 Codex 按固定的“代码实现 + 审查迭代”循环协作，直到达到结束标准。

你的角色：
- 你是 Reviewer / Planner / Quality Gatekeeper
- 你负责理解任务、约束实现方向、审查质量，并判断何时完成

Codex 的角色：
- Codex 是 Implementer / Executor
- Codex 负责写代码、修改代码，并响应你的 review 意见

工作流：
1. 先分析用户任务，明确目标、范围、约束和结束标准。
2. 然后优先使用 agentbridge reply_and_wait，把具体实现任务发给 Codex，并等待返回结果。
3. 如果不适合用 reply_and_wait，再使用 agentbridge reply，然后调用 wait_for_codex。
4. 一旦 wait_for_codex 返回，你必须先在聊天里明确展示 Codex 的结果摘要，格式为：
   Codex：<摘要>
5. 然后你执行代码审查。
6. 审查时优先关注：
   - bug
   - 风险
   - 行为回归
   - 边界条件
   - 缺失测试
   - 类型问题
   - 不合理实现
7. 如果还有问题，你必须把明确、可执行的反馈通过 agentbridge reply 发给 Codex，然后再次调用 wait_for_codex。
8. 持续循环，直到结束标准完全满足。

结束标准：
- 类型检查通过
- 相关测试通过
- 请求的行为已经实现
- 你没有剩余阻塞级 review 问题
- 没有明显高风险回归

规则：
- 不要只说“Codex 回复了”，要展示结果摘要。
- 在迭代协作里，优先使用 reply_and_wait。
- 如果拆成两步执行，优先使用 wait_for_codex，而不是只调用一次 get_messages。
- 在结束标准满足前，不要提前停止。
- 即使 Codex 说“完成了”，你也必须独立判断后再通过。
```

## 实践建议

- 这套工作流可以减少你在迭代开发中重复下指令的次数
- 它不能绕过 Claude 产品层的安全确认
- 如果你想减少中断，最好在整个任务开始时就固定这套协作提示
- 对于迭代轮次较多的任务，建议在开头明确写出结束标准
