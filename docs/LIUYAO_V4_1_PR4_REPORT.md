# V4.1 PR-4：QueryCompiler 与单轮检索基线

实施日期：2026-10-15（Asia/Hong_Kong）。仅完成 PR-4，本地实现，未创建远端 PR、未整体提交工作区已有改动。没有重建知识库或重新起真实用户卦盘。

## 本阶段交付

- `lib/divination/query-compiler.ts`：逻辑请求、纯程序编译、任务/事实/主题/词表校验，拒绝自由 query 和 SQL 字段。默认由 P1 任务确定性生成 theory 请求，不新增 P2 模型调用。
- 首轮最多 5 条查询，先按 critical/high/optional 排序，每任务先分配一个槽位。未进入预算的任务记录 `budget_deferred`，不改写初始任务列表，不声称全部完成。
- 理论查询只使用受控主题词。case 编译按已确认事件选择词表，不拼完整问题、日月、地支及所有爻；case 允许为零，未知事件不擅自映射。
- `lib/server/initial-plan-store.ts`：plan/interpret 共用初始计划的读取、校验、首次持久化和同进程并发合并。正常重试复用相同版本的 Q1/R1/F1/P1，不重新取用。
- `interpret/route.ts`：默认读取已确认冻结盘 → 恢复初始计划 → 编译 → 一次检索 → 旧解释节点。规划未就绪直接返回状态，不偷偷绕回旧链路。
- Python `/source-profile` 返回 owner 校验后的知识发布、manifest、embedding profile、撤销指纹与检索算法版本。新内部 `/source-evidence-round` 接受最多 5 条查询及对应任务引用，需内部签名。
- 检索前后核验版本身份；版本改变返回 409，不把新库资料写进旧身份的缓存。Next 再核对返回资料的 chart ID/hash 与检索身份。
- 缓存身份包含 pipeline、确认/盘面/问题、初始规划版本、模型指纹、编译哈希、检索身份和旧写作版本；与 V1 缓存隔离。
- 每条查询保留 `request_id / parent_task_id / round / keyword_hits / vector_hits / top候选 / selected_evidence_ids / candidate_status`。私人 retrieval_run 保存该 trace，资料仍保持 `condition_evaluation=unknown`。

`LIUYAO_RETRIEVAL_PIPELINE=v1` 可显式回退原链路；未设置时为新链路。不在技术失败或语义冲突后自动重跑另一套规划。

## 同库同盘对照

通过真实 TypeScript 编译器生成查询，并以 Python 只读 SQLite 连接执行两组检索。

- 盘面：已有 `docs/examples/liuyao-245-core.json`；固定 Q1/R1/P1 测试输入，P1 使用受控最小计划，无付费模型调用。
- 库：`stage11-context-review-v1/knowledge.sqlite3` 当前 source_reading。
- release：`source-release:073dc5fb09ae986ac588a39c635ab51a09d8ddf10b9a798cf3b3126d633d3341`。
- embedding profile 指纹：`77a76bacf7b6f17ab62dfc225e08cb9547b5879223325da4f5b527e885b4670e`。
- 本次对照为 BM25-only；不是在线 embedding 或端到端真实模型质量评测。原检索器的混合召回、分路预算、排序与原文去重规则继续复用，任务 trace 不等于独立适用性评审。

| 项目 | V1 确定性回退基线 | V4.1 |
| --- | --- | --- |
| 查询数 | 4 | 4 |
| 候选资料入选数 | 12 | 6 |
| 其中 case 数 | 4 | 0 |
| 逐任务 trace | 无任务映射 | 4 条 |

V4.1 实际查询：

1. T1：`用神 取用`，keyword_hits=55。
2. T2：`动爻 静爻 发动 动变 变爻`，keyword_hits=59。
3. T3：`日辰 月建 月破`，keyword_hits=38。
4. T4：`世爻 应爻 世应 生克 生扶 克制`，keyword_hits=94。

同一来源可能被多个任务召回；全局去重后只有 6 段，不把这些 task 命中累加为独立证据。以上结果只证明新 Planner 可复用旧 SQLite 并完成零 case 的单轮查询，不证明准确率或相关性提高。

线上响应中的 `query_comparison.v1` 也是确定性 V1 回退查询，只用于查看，`baseline_executed=false`；不会在一次解释中额外执行旧检索或旧查询模型。

复现：`PR4_COMPARISON_REPORT=1 npx vitest run tests/analysis-plan-route.test.ts`。内部脚本为 `fortune_module4/scripts/compare_pr4_queries.py`，从 stdin 接收两组实际查询，在 stdout 返回身份、查询、资料 ID 与 task traces，不写 corpus/runtime。

## 验收

- `npm test`：216 passed，7 skipped（显式 live 测试默认跳过）。
- Python 全量 pytest：519 项通过；新增单轮端点测试覆盖签名、owner、hash/版本、撤销指纹、任务 trace、零 case、零召回、5 条限制和私人 retrieval_run。
- `npm run typecheck`：通过。
- `npm run build`：通过；现有仓库外 package-lock 的 Turbopack 警告不影响构建。
- 本阶段相关 TS 文件 ESLint、相关 Python 文件 Ruff check/format、`git diff --check`：通过。
- TypeScript 新增覆盖通用问事、共享计划、缓存版本、非法请求/引用/关键词、case 事件词表、预算保留、换知识身份拒绝写作、真实 SQLite 对照。
- 对照测试在全量并行测试负载下首次触发默认 5 秒时限；调整为局部 30 秒集成测试时限后全量通过。未改变生产超时或跳过该测试。

## 明确未进入的阶段

尚未实现 PR-5 的 GapAnalyzer、EvidenceAccumulator、第二轮、补充任务、全局 deadline 和失效快照。超出首轮预算的任务只记录，不暗中补检。

尚未实现 PR-6 的 StructuredReasoning。当前仍是旧证据约束解释节点，响应明确提示这是 PR-4 基线。召回到原文只表示存在候选资料，不代表适用于本卦，也不授权强结论。

目前不新增独立 LLM 证据适用性审查。事件词表是召回提示，不是 SQLite 的硬 event 过滤或已完成的事件排除精排。暂不做知识图谱。
