# V4.1 PR-3：Q1、通用分类、冻结事实与初始计划

实施日期：2026-10-15（Asia/Hong_Kong）。本阶段为本地实现，保留工作区原有改动，未创建远端 PR，也未将已有改动整体提交。

## 修改范围

新增模块：

- `lib/divination/topic-taxonomy.ts`：版本化领域、事件、问题功能、任务种类、理论主题和固定取用分支的兼容边界。
- `lib/divination/question-analysis.ts`：Q1 四态、单一占事、来源片段、稳定人物 ID、关系方向、时间与背景约束。
- `lib/divination/analysis-utils.ts`：规范哈希与不可变输出。
- `lib/divination/analysis-facts.ts`：复用固定取用校验，生成稳定原子事实与有方向的五行关系。
- `lib/divination/analysis-plan.ts`：最多 7 项任务、引用/主题/依赖/覆盖校验、确定性最小回退。
- `lib/server/analysis-planner-llm.ts`：Q1/P1 Prompt、每节点最多一次修正。
- `lib/server/analysis-planner.ts`：Q1→现有 R1→F1→P1 编排、取用兼容检查、版本指纹与快照复验。
- `/api/divination/plan`：读取已确认冻结盘并生成/恢复初始计划，不起卦、不检索、不生成解卦文本。

修改现有链路：

- chat 路由在确认候选写入前执行 Q1；语义冲突返回已有对话节点的澄清格式，技术失败保存草稿并提供重试。
- 前端新增“重试问事预检”，重用原消息 ID 和草稿，不要求用户重新填写，也不重新运行已经成功的 D1。
- D1 的领域/事件目录与 Q1 注册表同步，原 `question_kind` 仍作为兼容字段。
- `determineUseRoles` 可接收只读 Q1；事业分支漏掉规则明确要求的世爻角色时，进入一次受控修正，不由 F1 擅自添加角色。
- Python 候选必须有合法单一 Q1 才可确认；确认和 chart 保存 Q1 快照，`/frozen` 返回只读分析。
- 私人运行库增建 `analysis_initial_plan` 表，首个成功提交的计划不可覆盖，技术失败不落为成功快照。

## API 契约与阶段行为

Q1：`valid / semantic_conflict / extraction_failed / unsupported`。新事件先保留 `other + 原问题`；只有后续固定取用分支确实无法支持才返回 unsupported。传输/格式故障与问事冲突分开，不用追问用户来掩盖技术失败。

确认前：Q1 只能检查 D1 整理后的问句，不能自行改写这个问句。用户确认的是该问句与已确认背景。Q1 模型输出不是最终授权，程序还检查单一占事、引用和事实来源。

冻结后：新记录直接复用冻结的 Q1。PR-2 已冻结但缺 Q1 的确认记录可只读补解析；若发生冲突或解析失败，保留原盘并停止规划。旧未确认盘拒绝进入新规划，不伪造确认。

规划接口请求：

```json
{"chart_id":"<已有冻结盘 UUID>","chart_hash":"<可选：原 chart_hash>"}
```

成功结果包含：`pipeline_version=analysis-planner-v4.1-pr3`、确认 ID/hash、chart ID/hash、版本集、SingleQuestionAnalysis、UseRoleAnalysis、FactCatalog、InitialAnalysisPlan。`initial_plan.status` 区分模型生成与安全回退；ready 只表示计划可执行，不表示理论充分或结果已经获得支持。

不接受客户端覆写问题、盘面、角色或任务。重复请求读取同版本快照，不重新取用或规划；同进程并发共用一次执行，数据库事务保证不同进程也不会覆盖首个提交。读取快照时重新核验版本、问事身份、角色定位、事实目录、任务引用与计划哈希。

## 原子事实与任务边界

所有 fact subject/object 引用均来自实际冻结 core，ID 由 chart hash、引用、谓词、值和计算版本稳定派生。缺失条件保留 null。月令标签不等同综合旺衰；酉化申不直接升级为进退吉凶；伏神存在不代表可用。生克计算保留 source→target 方向。

P1 只能引用目录 ID 和允许主题。主角色、相关动变、日冲/月破/旬空和伏神条件必须由对应核心任务覆盖；无问时或期限不能添加 timing。依赖无环，不能用重复任务凑数量；程序拒绝新增爻、非法主题、提前下结论及遗漏关键结构。模型两次输出都失败时，只从相同冻结事实生成最小计划。

## 真实模型测试暴露的问题与修正

首次冒烟发现模型会省略可选字段、以自己的描述替换 raw_event_description、遗漏 actor evidence，以及给出偏移错误或未经 D1 确认的关系。

已采用有界的确定性规范化：

- raw_event_description 始终保存原问句；可选缺失信息保持空数组/null，关键状态、单一占事数、问句和功能枚举仍严格检查。
- 只有引用文本在指定来源中真实且唯一存在时才修正偏移；重复片段不能由程序替模型选择。
- actor 缺 evidence 时，仅能由唯一原文的同名标签生成；不能生成原句没有的姓名或身份。
- 状态文案保存经过定位的原文，不保留模型追加的事实性结论。当前状态还必须来自已提供的事实或阶段。
- D1 未确认任何关系时，模型新提的关系边丢弃并记录 `UNCONFIRMED_RELATION_DISCARDED`；已给关系则核验人物、方向、关系值和引用，不能自由重写。
- 多占事可以用最小冲突输出阻止确认，不要求模型为了填写其余字段而补造人物或状态。

这些检查证明结构与引用受到约束，不是传统理论或用户现实陈述已经被科学验证。

## 验证命令与结果

- `npm test`：204 passed，7 skipped（含显式选择运行的 5 项模型冒烟）；真实模型测试另行运行并通过。
- `npm run typecheck`：通过。
- `npm run build`：生产构建通过，新增 plan 路由成功编译。
- 本阶段 TypeScript、路由、前端、模型适配及测试文件定向 ESLint：通过。
- Python 全套 `.venv/bin/python -m pytest`：518 passed，1 warning。
- Python 确认/旧检索/source retrieval 定向测试：33 passed。
- 相关 Python 文件 Ruff 与 `git diff --check`：通过。
- `FORTUNE_LIVE_PLANNER=1 npx vitest run tests/analysis-planner.live.test.ts`：5 passed。实际配置模型通过求职、结婚、回款、复合多问拦截、求职初始计划；使用模拟问事和现有 core 样本，没有创建新卦或写入公共知识库。

实际模型用例属于小规模冒烟，不代表已完成跨领域准确率评测或古籍检索质量评测。浏览器完整点击链路与旧系统 A/B 检索对照留待下一阶段。

## 兼容与迁移

1. 新的确认候选必须带 `question_analysis`；缺预检的旧待确认候选需要重新整理，不能绕过 Q1。
2. 已冻结的旧确认记录只读兼容，不改原 question_hash/chart_hash；新增 Q1 与计划不触发重起卦。
3. 计划指纹包含问事、盘面、pipeline、Q1/P1 Prompt/Schema、分类和主题目录、固定规则内容、计算版本和模型配置哈希。尚未检索，因此本阶段没有假造 knowledge release。
4. 新表仅在私人 runtime 增建，不重构古籍库。代码回滚时可保留新增表和新记录，不删除原数据库；旧代码读取新 hash 的兼容性需配套验证，不能直接移除 Q1 数据重算冻结盘。

## 是否进入下一阶段

PR-3 的工程、接口和小规模配置模型验收通过。当前用户解释仍走既有检索/写作链路，独立 plan 接口输出新初始计划；PR-4 才接 QueryCompiler 与单轮检索。因此 M1 的“在当前数据库执行新计划的一轮检索”门槛尚待 PR-4，未提前宣称通过。

未接 Gap Analyzer、第二轮检索、StructuredReasoning 或 GraphRAG。下一阶段严格限定为 PR-4。
