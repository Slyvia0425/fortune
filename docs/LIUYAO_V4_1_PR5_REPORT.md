# V4.1 PR-5：Gap Analyzer、EvidenceAccumulator 与双轮控制

实施日期：2026-10-15（Asia/Hong_Kong）。本阶段仅完成 PR-5；保留既有工作区改动，未创建远端 PR、未整体提交项目，也没有重建知识库或重新起真实用户卦盘。

## 交付与边界

- `lib/divination/evidence-gap.ts`：双触发校验、机器缺口、补充任务审批、审定别名、新颖请求校验。
- `lib/server/evidence-gap-llm.ts`：G1 Prompt 与调用，成功一次即停止；格式/网络失败在剩余预算内最多重试一次。
- `lib/divination/evidence-accumulator.ts`：来源片段、跨轮归因、原始分数/trace 累计、重叠与同文分组，以及临时旧写作适配器。
- `lib/divination/agent-controller.ts`：最多两轮、重要缺口门控、检查点恢复、partial/stale 状态、停止原因和显式失败重试。
- `lib/server/evidence-agent-store.ts`：owner/不可变指纹隔离的私人检查点、不可覆盖日志、原子替换、摘要检查和日志恢复。
- `lib/server/workflow-budget.ts`：从 interpret 开始的 180 秒总期限、节点预算与传输取消；原 Q1/R1/P1/写作与修正调用也继承该期限。
- interpret 默认进入 PR-5，响应增加 `evidence_snapshot`、`analysis_agent`，保留原盘、取用与初始任务。`LIUYAO_RETRIEVAL_PIPELINE=pr4` 可回退单轮，`v1` 可回退旧链路。

## 补检安全约束

`task_gap` 引用初始任务。只有实际 trace 的 keyword/vector 命中都为零，才接受机器判定 `no_results`；未执行、候选被预算挤掉不能伪装成零召回。低相关、覆盖不足及来源条件判断始终是 candidate，不是专家已核验结论。

`source_gap` 必须引用与该任务关联的真实累计 evidence ID，以及属于该 evidence、来自第一轮的 source span ID。补充任务的 parent 只能是初始任务，禁止递归扩展。冻结事实触发还需是真实、未计划且与父任务结构关联的事实；伏神可通过飞爻引用关联。

来源触发的新主题还需有受控术语锚点。该检查只是引用/词表/结构校验，不声称证明了古籍语义上的必要性。原文提伏神但没有冻结伏神事实时，扩展标为 `definitions_only`，不新增盘面事实或断定其适用。

首轮最多 5 条、第二轮最多 3 条；optional 补检最多 1 条，且只存在 optional 缺口不能触发第二轮。请求必须绑定合法缺口或经批准扩展。按请求规范签名去重，同时按实际编译词集合去重，换意图文字或换词序不能重复检索。同一运行没有第三轮。

## 累计与持久化

首轮成功后，先保存包含原始 pack、请求和 trace 的私人检查点，再运行 G1。第二轮批准意图在检索前再次保存。第二轮失败/超时，不覆盖首轮，返回 partial、未解决 gaps 和错误码。

同一来源版本的精确 span 或相同 quote hash 合并 rounds、request IDs、task IDs、各轮分数；不同位置保留全部 origins。引用 hash 以原文 UTF-8 校验，来源偏移保留 Python Unicode codepoint 坐标，不用 UTF-16 长度替换。

重叠但不同的原文语义单元共同保留，按重叠连通分量标记 `shared_source_group`。相同文本出现在不同来源版本时不合并来源，只标记 `same_text_group`。这些候选不能据此被算作多份独立支持。

Python 新请求路径不再提前删除重叠片段；旧无任务请求路径仍保留原有去重行为。检索身份升为 `source-reading-overlap-preserved-v2`，与旧缓存隔离。

私人文件位置为 `.runtime/analysis-agent/<owner+fingerprint hash>/`：保存原子 `checkpoint.json` 和逐阶段日志；不写公共 corpus。摘要针对 JSON 序列化后的对象计算，避免可选 undefined 字段导致恢复误报。最新文件缺失时可从完整日志恢复；存在但损坏的最新检查点不会被当作有效输入。

恢复前核验 pipeline、指纹、chart/question hash、知识身份，并由成功 round 历史重放累计器，核对 evidence。改变字面问句、盘面、计划、模型、G1 Prompt/别名、知识发布、embedding profile 或撤销指纹均不能复用原身份。

普通读取复用终止快照。显式 `retry=true` 可在新的有界运行中恢复 G1 技术失败、第二轮失败或时间不足的首轮快照；不重跑成功的首轮/R1/P1。已批准的第二轮可直接恢复，不再次调用 G1。完成两轮或知识已失效的旧快照不能靠重试产生第三轮或进入写作。

## 时间预算与退化

- Interpret 全局期限：180 秒，从 POST 开始计时，不含用户多轮对话。
- 每次检索：最多 20 秒；第二轮启动前至少剩余 50 秒。
- G1 每次调用：最多 30 秒，最多两次尝试；剩余不足 50 秒时不再启动 G1。
- 旧写作阶段整体：最多 40 秒，包括其内部修正；同时受全局剩余时间限制。
- 节点 timeout 取节点预算和全局剩余预算的较小值，保留短 guard；已到 deadline 不启动新 fetch/LLM。超时会取消传输，不只是返回一个仍放任网络调用的 Promise。
- Python 新检索入口也启用 request-local 20 秒预算，embedding HTTP 使用剩余 timeout，batch/分路/候选循环检查期限；不修改共享 provider 的全局配置。同步本地计算无法被强制抢占，但期限后不会启动新的 embedding 请求，过期结果不继续进入正常检索流程。
- 本地检查点持久化可在截止时完成，不再发网络请求。知识身份在第二轮改变时保留审计快照并标 stale，旧资料不交给写作节点。

未召回任何原文时不调用旧解释模型伪造解读。停止只表示控制流程停止；新增候选不会自动消除条件缺口，unresolved gaps 继续保留，待后续业务推理处理。

## 验收

- `npm test`：247 passed、7 skipped；跳过的是显式 live 测试，本阶段未调用付费模型。
- `cd fortune_module4 && .venv/bin/python -m pytest -o addopts='' -q`：521 passed、1 warning。警告为现有 Starlette TestClient/httpx 弃用提示。
- `npm run typecheck`：通过。
- `npm run build`：通过；现有仓库外 package-lock 的 Turbopack 警告不影响构建。
- 相关 TS 文件 ESLint、相关 Python 文件 Ruff check/format、`git diff --check`：通过。

`tests/evidence-agent.test.ts` 覆盖 G01–G11，以及假零召回、无触发扩展、原文/事实审批、重复意图、同源重叠、跨来源同文、Unicode span、分数不覆盖、owner 隔离、日志恢复、deadline 取消、失败显式恢复和不产生第三轮。

`tests/analysis-plan-route.test.ts` 覆盖真实 interpret 两轮接线、模型/取用调用次数、首轮先保存、两轮并集送旧写作、重试复用、第二轮失败与最终写作失败保留累计结果，以及两轮空结果禁止写作。

另通过 `fortune_module4/scripts/retrieve_pr5_fixture.py`，在只读的现有 stage11 SQLite 和已有 245 冻结 core 上执行真实 TypeScript 编译的两轮 theory 查询，再将 Python 返回的真实原文/hash/span/trace 送入 TypeScript 累计器。首轮 evidence ID 均保留，两轮来源校验通过，零 case 合法。该测试为 BM25-only 接线/归因验证，不是相关性或预测准确率评测。

Python 覆盖内部签名、owner、Round 2 最多 3 条、禁止混合轮次、版本/撤销变化、空命中 trace，以及 embedding 剩余预算和截止后禁止请求。

## 尚未进入 PR-6

没有实现 StructuredReasoning 或最终写作改造，因此不宣称完整 M2 Gate 已通过（该 Gate 还要求 G12 与真正的 StructuredReasoning）。当前写作适配器只提供两轮原始候选并集，沿用现有证据约束写作；`strong_conclusion_allowed` 仍为 false，响应明确提示 PR-6 尚未接入。

没有增加独立 LLM 适用性审查、外部追问、重新取用、第二个占事、第三轮或知识图谱。本阶段验收完成后停止。
