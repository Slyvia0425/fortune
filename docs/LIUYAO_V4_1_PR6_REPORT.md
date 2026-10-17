# V4.1 PR-6：StructuredReasoning 与最终文本接线

实施日期：2026-10-15（Asia/Hong_Kong）。仅完成 PR-6，本地实现；保留原工作区改动，未创建远端 PR、未整体提交项目，没有重建知识库或重新起真实用户卦盘。

## 本阶段交付

- `lib/divination/structured-reasoning.ts`：StructuredReasoningV1、findings、不同观点、未解决问题与整体评估的类型及程序校验。
- `lib/divination/reasoning-text.ts`：受控最终写作契约、引用/状态/内容校验及正文投影。
- `lib/server/structured-reasoning-llm.ts`：Reasoning Synthesizer 与最终写作 Prompt、每节点最多一次修复、节点整体 40 秒预算。
- `lib/server/reasoning-stage.ts`：推理→校验→持久化→写作→校验的阶段编排；校验失败不能转去旧解释节点。
- `lib/server/reasoning-stage-store.ts`：owner、输入指纹、来源版本、模型/Prompt/Schema 隔离的私人 reasoning/writing 检查点和诊断。
- interpret 默认启用 `analysis-planner-v4.1-pr6`，输出 `structured_reasoning / reasoning_text / analysis_status / reasoning_diagnostic / reasoning_checkpoint_key`。PR-6 分支在旧解释调用前返回，禁止自动自由写作兜底。
- 前端可在最终文本失败时查看结构化观察、条件、限制、不同观点、未解决项及真实原文/span。已确认旧会话恢复时重新通过服务端授权和版本检查，不把 sessionStorage 的 PR-4/5 文本当作 PR-6 结果。

显式 `LIUYAO_RETRIEVAL_PIPELINE=pr5 / pr4 / v1` 仍保留相应历史回退路径；未设置时为 PR-6，不因技术故障自动回退。

## 推理校验

输入只来自已确认冻结问事、同版本 InitialPlannerSnapshot、成功轮次历史及累计证据。进入推理前重放累计器，检查来源 hash/span、chart/question hash、知识身份和 evidence 一致性；stale 数据不能进入推理。

- finding/task/fact/evidence ID 必须真实存在；引用受任务/父任务范围约束。所有初始任务与已批准补充任务均需覆盖，任务携带的冻结事实不能静默删去。
- `observation` 由程序提供受控中文事实描述，模型必须逐字组合；不允许把月破改成不月破、改变动静、倒置生克或另造盘面。月令标签明确不等于综合旺衰。
- 无原文不能标有据；只有案例不能标 supported；未知事实、未核前提和定义专用补充任务不能升级为无条件支持。
- 两轮候选都要进入引用覆盖，且每个有两轮候选的任务不能只引用末轮。已标明的定义/条件/例外不能静默删除；source_gap 的原文锚点必须保留。
- conflicting finding、source_conflict gap 和检索已有冲突组均要求合法的 competing_views，引用必须真实。
- 未解决 gap、定义专用限制及检索错误必须逐字出现在 unresolved_questions。存在缺口、冲突或非 supported finding 时，overall 不得升级为 supported；所有 findings 不足时，整体不能标 conditional。
- insufficient 的 conclusion 必须为 null，不能利用总体结论字段重新制造预测。
- 概率、部分确定性预测及危险现实建议有额外字符串拦截，但这不是完整语义证明或独立适用性审核。

`supported` 仅是选定传统体系内的业务解释状态，不是现实事件已获科学证明。程序验证引用、覆盖和冻结事实一致性，不宣称验证了全部古籍语义推导。

## 最终解释的受控边界

本版将自然中文解释放在推理节点的 `interpretation` 中生成，最终写作节点负责组织 findings 的叙述顺序，不重新推断。

Writer 只收到已经校验的 StructuredReasoning 与输出模板，不收到原始检索包、案例、卦爻辞或可供另起结论的自由素材。每个 paragraph 的 `text` 必须逐字复制对应 finding.interpretation，status 和 evidence_ids 必须完整一致，全部 findings 恰好出现一次。额外自由 summary、修改条件、伪造引文或升级状态均被拒绝。

服务器将总体结论/不足说明、每项冻结观察、解释、全部前提与限制、不同观点和未解决项完整投影为现有 `DivinationModernInterpretation`，并添加固定的一般性现实决策提醒和传统文化免责声明。不会为了固定字数补造判断。PR-6 的 readings 为空，卦爻辞原文继续单独只读展示，不再用其支持六爻结果预测。

这是有意采用的严格组织模式，不是开放式自由润色；以后若允许模型自由改写，需要另行设计校验，不能直接放开本阶段保证。

## 缓存、超时与失败恢复

检查点位于 `.runtime/structured-reasoning/<owner+key hash>/`，独立保存 reasoning、writing 和 diagnostic；文件摘要针对 JSON 序列化后的表示计算，原子替换，权限 0600，不进入公共知识库。

Key 包含确认/问题/盘面、初始计划、累计快照、补充任务、知识身份、模型指纹、完整 Prompt hash、Prompt/Schema/阶段版本。来源变化、字面问句变化、快照变化均不能复用旧阶段结果。缓存载入后仍重新执行 validator，不因存在文件就视为合法。

推理前、写作前、交付前重新检查知识身份；发现来源/撤销/embedding 等身份改变，不交付旧文本。截止或暂时无法完成最终写作时保留已校验结构化分析与诊断；已知身份失效时不把旧结构化分析标为可用结果。

- 推理/写作各自整体最多 40 秒，包括其一次修复；均受 interpret 180 秒统一 deadline 限制。
- PR-6 给推理和写作预留 90 秒，剩余不足时不启动 G1/第二轮；PR-5 回退仍保持原 50 秒策略。预算不足不保证每节点能用满上限，所有网络调用仍使用实际剩余预算。
- 推理失败：保留累计证据，`analysis_status=reasoning_failed`、文本为 null，禁止新旧写作。
- 写作失败：`analysis_status=structured_available`，返回合法结构化分析与诊断；同 chart 显式重试复用推理和检索，仅恢复写作。
- 两轮无资料：程序生成保守 insufficient 结构，不调用推理/写作模型，不输出成败或应期。
- `analysis_status=complete` 仅指阶段流程完成，不等于整体判断 supported；证据不足仍明确显示不足。

## 测试与验收

- `npm test`：278 passed、7 skipped。新增 25 项 StructuredReasoning/阶段测试、4 项 PR-6 路由接线测试和 2 项前端静态渲染测试。
- Python 全量：521 passed、1 个现有 Starlette TestClient/httpx 弃用警告。本阶段没有修改 Python 生产实现。
- `npm run typecheck`、`npm run build`：通过。构建仍有现有仓库外 package-lock 的 Turbopack 提示，不影响构建。
- 相关修改文件 ESLint 与 `git diff --check`：通过。

G12 覆盖不存在的引用、错误问句/盘面身份、非法 task/fact、篡改来源、缺失条件、冲突遗漏、状态升级、推理两次失败禁止写作。与 PR-5 的 G01–G11 回归一起覆盖本阶段工程验收。

路由测试验证默认 PR-6 顺序为 P1/G1/推理/写作，R1 不重做、没有旧解释调用；写作失败后的重试不再取用/检索/推理；知识身份在推理后变化会阻断写作。

现有 stage11 SQLite + 已有 245 frozen core 的只读两轮集成测试，继续将真实 Python quote/hash/span/trace 送入累计器，再生成并校验结构化 fixture 和最终正文投影。该测试使用确定性模型 fixture 与 BM25，不是在线模型质量评测。

本阶段未运行付费 live 模型测试，未测古籍适用性准确率、预测质量或检索 nDCG/Recall，也未声称已证明命理结论。若进入生产质量评测，应另行准备人工标注与真实模型样本。

## 后续边界

PR-6 完成后停止。PR-7 Career-KG 仍暂缓，没有建图、批量构图或切换检索数据库。
