# 案例逐节点输入输出

默认启用；设置 `LIUYAO_CASE_TRACE=false` 后关闭。变更环境变量后重启服务。

每次 chat / dialogue / confirm / cast / plan / interpret 请求创建独立 trace，
响应头 `X-Divination-Trace-Id` 返回编号，`X-Divination-Trace-Status` 表示日志是否完整。
文件在 `.runtime/case-traces/<trace UUID>/`，目录权限 0700、JSON 文件 0600，已被 Git 忽略，不进入知识库或公开 API。

每个节点在执行前保存 input；正常结束保存 output、耗时，异常保存错误。
`status=returned` 只表示函数返回，不表示专业内容正确，须检查输出的业务状态及 validation 节点。
进行中断电的节点会保留 running 状态。日志落盘失败只记录固定错误码并标记 partial，不改变占卜结果。

## 覆盖范围

- 前置对话、问事确认、起卦：API 输入/输出、后端调用、实际模型消息及原始 content。
- Q1 / P1：输入、逐次原始输出、校验错误、修复请求及最终计划（包括 fallback）。
- 用神节点：实际输入与最终结果，保持原有确定性/兼容路径不变。
- QueryCompiler：计划与事实输入、编译后的检索请求。
- 每轮检索：后端请求与原文结果；Gap Analyzer 意图、编译、累积证据检查点。
- PR6：Input Builder、实际模型输入、原始回复、校验结果、结构化结果。
- 最终文本：已验证 finding 输入、确定性文本输出及最终 API 结果。
- Planner / Reasoning / Writing / 整体解释缓存：单独标记 cache-hit；并发共享结果标记 inflight-hit。

后端内部检索算法的每个子函数并未另行打点；记录的是后端服务边界的真实请求与返回。
未执行的节点不会伪造输入或模型输出。缓存命中只记录复用结果，查找原 trace 才能看到原始模型调用。

## 按案例查找

```bash
node scripts/read-case-traces.mjs <chart_id 或 confirmation_id 或 conversation_id 或 trace UUID>
```

manifest 中业务 UUID 用于关联跨 HTTP 请求的同一案例；不以问题文本匹配，避免同题不同起卦混在一起。
每个节点 JSON 包含实际输入输出；model-call 文件包含模型、messages、usage、finish_reason。
不保存 HTTP headers、凭据、隐藏 reasoning_content；敏感字段及常见 Bearer / sk- 密钥脱敏。
用户问题及原文属于调试必需的敏感业务数据，仍保留在本地文件中，不是完全匿名数据。
不要公开整个日志目录。当前不自动清理历史日志，请按个人隐私需要手动管理；关闭记录不删除旧文件。

## 历史案例

旧系统没有完整保存 P1 请求与两次原始回复，无法补回历史模型输出。
可用保存的 initial_analysis 还原输入和最终计划，不调用模型、不重新起卦：

```bash
node_modules/.bin/vite-node scripts/export-case-planner.ts <保存 interpretation.json 的案例目录>
```

导出 `planner-input-output.reconstructed.json`。明确标记 historical_reconstruction：
使用当前构建逻辑、Prompt 和白名单，不声称是历史逐字请求；raw_model_outputs 为 null。
为避免覆盖已有记录，重复导出同名文件会失败。
