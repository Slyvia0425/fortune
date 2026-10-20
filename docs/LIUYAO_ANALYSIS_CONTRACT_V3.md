# 候选分析字段契约与一次修正 v3

前后端整体集成入口见 [系统输入输出与合并契约](LIUYAO_INTEGRATION_CONTRACT_V1.md)。本文件只描述解释节点内部契约。

2026-10-12。修改检索后的候选解释节点，前置问题理解与 core 算法不变。本版未调整召回算法或入库资料。

## 输入和输出

- 输入拆分 `rule_evidence` / `case_evidence`，同时提供 `allowed_rule_ids` / `allowed_case_ids`。候选、条件、选用只允许规则 ID；解释段允许规则与案例。历史检索包的 `reasoning_evidence` 不变。
- 模型只输出 `conditions.fact_refs`，不再输出 `known_facts`。Guardian 验证引用存在后从同一 `fact_catalog` 原样复制值、去重，构造返回给界面的 `known_facts`。不接受模型提交的重复事实值。
- `origin` 为 `main`、`hidden` 或 `moving_transformation`。最后一种只包含实际动爻对应的变爻，不能把全部变卦六爻都当作动爻变出。self/response 仅限本卦世应。
- 每个候选必须有匹配来源/角色的非空 `line_refs`；没有对应爻时不创建空候选，在解释或不确定项说明。不同来源分开列候选。
- 未知事实不能支持 met/not_met；关键缺失、未知条件、争议规则、权限禁止等情况仍禁止选定。伏神位置存在不等于已经确认可用。
- Prompt 强调适用场景边界，但程序校验仍不能证明自由文本的古籍语义推理成立。

## 错误与修正

`ModelAnalysisValidationError.issues` 提供 `code/path/message`，包括错误 JSON、额外字段、引用类型、未知事实、来源/角色不匹配、空候选、未决条件下选定等。当前逐次报告首先遇到的错误，不保证一次列出全部；修正指令要求同时自检完整输出。

生产函数先调用一次模型。校验失败时发送首次原文和错误列表，复用同一问题、core、事实目录、证据及权限，最多修正一次。修正结果重新走完整校验，不自动删引用或偷偷接受非法条目。网络错误不触发额外重试。第二次失败返回 unavailable，没有可发布 analysis。

返回的 `attempts` 分别保留每次 `raw_output/status/errors`；`validation_errors` 提供最终失败原因。API 随解释结果返回记录，不输出密钥。该返回记录本身不等于新增数据库持久化；本轮未新增生产审计表。评测脚本把每次原始回答、完整请求序列和校验错误写入独立结果目录。

## 评测

`tests/liuyao-e2e.live.test.ts` 直接记录 Guardian 错误，不再用另一套诊断脚本猜测原因。分别记录 `first_attempt_pass`、`repair_attempted`、`repair_succeeded`，避免最终通过率掩盖首次错误。真实调用最多两次，因此单题测试时间上限调整到 200 秒。

单元测试覆盖来源匹配、变卦静爻排除、伏神未决、事实值由程序复制、引用错误路径、一次修正成功/失败/超时、禁止修正时发明证据以及无第三次调用。

变更文件：`lib/divination/model-use-analysis.ts`、`model-use-validator.ts`、`lib/server/divination-llm.ts`、`lib/contracts/divination.ts` 和对应测试。
