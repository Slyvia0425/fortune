# 六爻规则原文驱动的 LLM 候选分析 v1

> 2026-10-11 更新：案例通道已接入 v2。当前服务默认读取 `stage9-text-reasoning-v2`，使用 36 条规则及 207 条古籍案例。下面的 v1 记录保留作历史说明；当前行为参见 [案例通道接入说明](LIUYAO_CASE_RETRIEVAL_V2.md)。

2026-10-10。按本次用户选择，暂不要求全部36条规则可执行化；保留三数字确定性core，采用“检索审核后的规则文字 → LLM分析候选与条件 → 结构化校验”的第一版。

## 路径

`/api/divination/interpret` 继续按服务端chart_id读取用户所属的冻结卦盘；后端 `/liuyao/hybrid/evidence` 使用 `run_text_reasoning`，按关键词和已验证向量provider检索规则，再沿lineage精确回读原文。不是把全部36条放进System Prompt，单次默认最多8个规则证据单元。无可用语义服务时保留BM25降级记录。

新用途快照位于 `data/liuyao_knowledge/stage9-text-reasoning-v1/`。从stage7复制数据并复用向量，新增 `text_published` 版本和 `text_reasoning` 指针，按实体/视图哈希显式允许36条modified_pass规则供文字分析。此状态不等于规则执行发布，36条executable仍false，原库及旧执行模式保持不变。

本版不自动允许案例进入文字分析版本，案例仍保留在数据库；如以后开放，需另立用途审核。本次没有新增教学题目/答案、重新生成向量或把未审核资料通过review开关送给模型。

## 模型要求

### 2026-10-12：解释节点的字段契约

问题位于检索后的 `interpretHybridEvidence` 候选分析节点。请求构造与 Guardian 现在使用同一个 `factCatalog(core, question, pack.facts?.question)`：在原有盘面事实之外，只接纳上游 `topic/subtopic/subject_mode/subject_relation/asked_object/goal/exam_type` 的字符串或 null，注册为 `question.*`。`question.original` 始终使用本次原问题，不接受上下文覆盖。未提供的字段不补造；这些解析字段不等于用户逐项确认。

Prompt 明确要求：只从实际目录复制字段和值；条件的每个引用必须先在同一候选 known_facts 中声明；不能创造 `core_facts.subject_relation` 等路径；无规则依据的辅助角色不加入候选。输出各层仅接受列出的字段，程序拒绝额外字段。影响当前取用的缺失放 missing_information，其他后续分析缺项放 uncertainties；未放宽禁止虚构事实或无依据选定的校验。

本轮 35 项相关单元测试及 TypeScript 类型检查通过；未重新调用远程模型，不能把此前 12 题结果视为修复后效果。

`lib/divination/model-use-analysis.ts` 包含System Prompt及输出验证器：

- 先说明对象、关系、目标，再提出候选；接收服务端问题上下文。
- 每个候选、条件、选用、解释段落均引用本次证据ID。
- 已知事实按fact_catalog原值输出，不能改爻位、六亲、阴阳动静或补算旺衰。
- 列条件是否满足、已知事实、缺少条件及例外；未知不能当成不利或弱。
- 多候选可并列；不足时selection保持null。伏神存在不等于可用。
- 不复制古例结局，不补造应期、概率或确定吉凶。

输出包括question_understanding、candidates、selection、uncertainties和readings。与原规则引擎的candidate_roles/selected_use分开，不把模型判断写成引擎确认结果。

## 程序拒绝条件

不存在或与候选角色不符的爻位；已知事实值与core不一致；错误chart_hash/method；引用非本次规则证据；条件unknown/not_met却选定；关键信息待补仍选定；用争议或明确不适用规则强行选定；完整盘面缺失；无文字用途授权。

引用核验、数据一致性核验不等于验证全部自然语言推理正确。系统不声称程序能证明古籍取用语义或检测所有自由文本幻觉。展示明确标注“模型依据原文作出的候选用神分析”。

发布用途授权按manifest哈希及逐实体/视图哈希核验，仍执行撤销、方法与排除名单检查。旧embedded/review版本不能直接用于此模式。

## 界面

`hybrid-evidence-panel.tsx` 展示模型理解的对象/关系/目标、候选爻、条件状态、缺失条件、例外、建议选用或不足以选定，以及本次检索原文。引擎未确认状态不再因为36条未executable就挡住有合格原文的模型分析。

## 验证与运行

- 新增TypeScript模型输出校验测试13项，与网页冻结解释接线测试合计19项通过。
- 后端第一轮相关回归42项通过；另增加manifest和原文篡改测试后，文字用途测试5项全部通过。
- 真实36条规则在未executable状态下，可经新文字用途检索进入reasoning_evidence；强结论开关仍false，selected_use仍空。
- TypeScript编译、目标Python文件Ruff及diff检查通过时记录于本轮交付；多轮提取任务并行修改的测试以其最终报告为准。
- 本轮没有实际调用远程解释LLM进行质量评测；测试不代表真实模型候选正确率。

构建快照脚本：`PYTHONPATH=fortune_module4 fortune_module4/.venv/bin/python fortune_module4/scripts/prepare_liuyao_text_reasoning.py`。已存在快照时拒绝覆盖。

Python后端重启后加载新快照；前端开发服务通常热更新，生产构建需重新构建/重启。已有冻结盘继续复用，缺字段的历史盘不会被自动重排。模型或结构化验证失败时保留原文并显示未生成，不能偷偷换成无约束解卦。
