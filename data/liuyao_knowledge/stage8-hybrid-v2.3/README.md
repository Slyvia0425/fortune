# v2.3：方案第 17–24 节混合检索编排

2026-10-10。本轮交付为可运行的后端检索链路与验收测试，复用 stage7-v2.2 的知识库和向量；没有另建或覆盖知识实体、批量重算向量、放开生产发布资格。

## 已实现

- 三数字＋原问题单次起卦：调用仓库既有 `python_algorithm/hexagram_engine.py`，不重写算法。服务端保存原输入、算法版本、源码指纹、core/method 版本、UTC 时间及 chart_hash。同一用户相同 request_id 重试不重起卦；复用 ID 却改变输入会拒绝。
- 版本化问题模板：提取关系、代占、专题、目标、明确提供的考试类型、原始时间表达；保留原文字符偏移。未提供的考试类型保持 null，“这次”不推成日期；“科举”等仅记录为历史搜索别名。
- 默认三条首轮查询：关系／对象规则、专题规则、问事案例。记录 lane、purpose、provenance、词典与模板版本；不调用模型改写，不添加预设六亲或吉凶结果。
- 两路 BM25＋真实向量＋结构化规则条件召回；按实体 revision 去重，各通道跨查询取最佳排名，再做 RRF。规则最多 8 条、案例最多 4 条，各 lane 引文最多 12,000 字符。常规 Top-K 截断记录为排序截断；必要条件或冲突组超预算才返回预算缺口。
- 独立保存 candidate_role、candidate_line、selected_use。只有可执行、条件成立、生产合格的规则可提出类别；唯一爻位也不自动选用。选爻动作仅支持有审核记录的明确 scope＋predicate，不执行生成代码。
- 本卦六爻齐全且六亲标注完整，才能判定“不现”。变爻、伏神另列；世应不套六亲不现规则。多现／不现自动生成对应补查，最多两轮补查、全请求最多 8 条唯一查询。
- 条件与例外三值评估；保留 false、unknown、冲突与缺失字段；仅在对象／目标确实未知或命中规则明确需要未知考试类型时补问。core 缺字段返回系统缺口，不让用户猜盘面。
- 案例对比读取审核后的结构化问事字段；关系或目标不符不能直接类比，没有审核字段则 unknown。案例不参与取用投票，案例空不阻止充分规则支持下的有限解释，也不复制案例结局。
- 每轮沿用版本、审核资格、方法、隔离与撤销过滤；生产接口没有 review 开关。案例生产检索还要求明确匹配 method_profile_id；搜索视图须审核通过。
- 原文按 lineage 精确读取并校验哈希，不做第三轮原文向量搜索。教学材料仍不导入。
- Evidence Pack 返回 query_plan、冻结盘面标识、条件、候选、引用、缺口与使用边界。Guardian 边界函数验证结构化声明的引用／方法／chart_hash／事实值／选爻／再占请求；不宣称它能验证任意自然语言答案。

## 使用

后端已注册 `POST /api/v1/liuyao/hybrid/query`，沿用 Module 4 用户身份依赖。请求仅允许：

```json
{
  "numbers": [3, 5, 8],
  "question": "我替妹妹问，她这次考试能不能过",
  "request_id": "00000000-0000-0000-0000-000000000001"
}
```

request_id 可以省略由服务端生成；重试时使用响应中的相同 ID。响应沿用项目 Envelope，证据包位于 `result`。输入盘面、release_id、review 等额外字段会被拒绝。接口读取服务端 active production 指针；未发布的 stage7 快照不会产生正式证据。

本地复现（仓库的 fortune_module4 目录）：

```bash
PYTHONPATH=. .venv/bin/python scripts/query_liuyao_hybrid_v2.py '我替妹妹问，她这次考试能不能过' --numbers 3 5 8 --keyword-only
PYTHONPATH=. .venv/bin/python scripts/query_liuyao_hybrid_v2.py '我替妹妹问，她这次考试能不能过' --numbers 3 5 8 --review --output ../data/liuyao_knowledge/stage8-hybrid-v2.3/review_smoke.json
```

第二条为本地审核入口；使用既有 embedding 配置并先检查漂移探针。`--review --keyword-only` 可检查不调用外部模型的 BM25 路径。HTTP 接口不提供这一审核权限。

请求与查询计划保存在 `fortune_module4/.runtime/liuyao-hybrid.sqlite3`，该目录已被 Git 忽略，与公共知识库分开。当前是单机 SQLite 实现，不是多机共享审计存储。

## 实际验证与界限

- `production_smoke.json`：3 条查询、0 次 embedding 请求、0 条正式证据；返回 NO_ELIGIBLE_EVIDENCE、CHART_FACTS_INCOMPLETE、UNRESOLVED_CONDITION。
- `review_smoke_final.json`：最终三条真实向量查询，返回最多 8 条规则、4 条案例，所有材料标记 not_for_interpretation；没有伪造候选类别或选爻。消耗和耗时见该文件的 query_plan.consumption；不把单条工程试查当作独立准确率评测。
- 测试覆盖方案第 24 节全部 12 类行为，另含 API 输入隔离、请求重试、所有权、例外条件、冲突、方法过滤、Guardian、向量跨改写去重。完整计数见工作区结果文档和本轮更新记录。
- 测试用的合格规则、六亲完整卦盘为隔离的合成夹具，不写入真实知识库。

**尚未具备正式解释条件：** 当前 core 只提供卦象与动爻，缺纳甲／六亲／世应／伏神／旺衰等字段；真实规则尚未完成可执行编码和生产发布。内容审核结果保持原样，不需要重新审核全部原文，但上述工程和发布步骤不能用内容审核代替。

本轮没有接入网页解释按钮或自由文本解释模型；现有卦爻辞按卦序／爻位精确取文链路保留，两种证据层没有混用。总 token 上限与响应时限尚待部署压测确定，当前记录服务端实际用量，不拿字符数冒充 token；查询数量、补查轮数、候选与引文字数已受代码限制。

最终回归：52 项相关测试通过（新增 18 项），Ruff 与 Git diff 格式检查通过。最终真实向量试查返回 8 规则＋4 案例、82 query tokens，未出现语义检索错误。一次中间探针请求曾发生 RemoteProtocolError，重试后成功；没有绕过探针检查。`review_smoke.json` 保留最初的试查输出，其中普通 Top-K 截断被计作预算缺口的问题已修正，请以 `review_smoke_final.json` 为最终版本。
