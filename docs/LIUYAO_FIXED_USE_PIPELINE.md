# 固定分支取用与原文／案例检索

2026-10-13。网页主链路版本 `fixed-use-llm-query-v3`。

1. Next `/api/divination/interpret` 经 Python `/liuyao/hybrid/frozen` 读取当前会话所属冻结盘和原问题；校验 chart_hash。
2. `determineUseRoles` 将版本化固定分支规则、原问题、问题上下文及 core 交给 LLM，输出主角色、必要辅助角色、规则 ID、理由和缺失信息。婚姻按问事视角分财／官，健康按病人与提问人的关系分世／父母／兄弟／子孙／财／官；病症是独立观察对象。现代类比须说明限制，不能从主题标签直接断角色。
3. `validateUseRoles` 校验角色枚举和固定规则引用，从 core 定位本卦与伏神爻位。爻位不接受模型输出。两现保留全部候选，未使用 MVP 的空破优先等排序。伏神存在不等于可用。未决或模型失败保留 core，不启动后续检索／综合解释。
4. `buildUseRetrievalQueries` 提供确定性基线。新增 `planRetrievalQueries` LLM 从 core 事实目录与受控词表规划最多 4 条理论／案例 query，程序保留具体支变并拼接盘面文本，拒绝未知事实与自由断语；合并后最多 8 条，模型失败回退基线。返回 `retrieval_plan` 供观测。详见 `LIUYAO_QUERY_NODE_TEST.md`。
5. Python `/liuyao/hybrid/source-evidence` 再核对归属与哈希，当前已就绪快照分别召回最多 6 条理论、2 条评论与 4 条 case。不召回 knowledge_rule。BM25＋已验证真实向量经 RRF 排序，新增 theory/case query 仅检索目标通道，基线检索全部通道。来源与案例沿用文字发布白名单，保留 unreviewed 标记，不升级审核／发布资格。查询向量小批量请求，通道前 10 名与分数写入 retrieval_trace，语义不可用时记录关键词降级。
6. 按来源区间去重，案例优先，重叠原文不再作为独立证据。来源哈希和撤销继续检查。
7. 最终解释接收 use_role_analysis、固定规则、core、原文与案例及卦爻辞。P 为原文引用，C 为案例，T 为卦爻辞。固定规则 ID 只支持取用，不能充当吉凶来源引用。结构／来源引用校验继续执行。

新增返回字段 `use_role_analysis`；网页主链路不再返回旧候选分析 `hybrid_interpretation`。旧 `/evidence`、`/query` 与旧候选分析函数保留供兼容调用，网页不使用。数据库未迁移，知识快照和发布资格未修改。

原文整理更新：`stage10-source-reading-v1` 增加逐段分类坐标、理论／作者评论检索视图与案例关联。仅在向量作业全部完成并写入 `retrieval_ready.json` 后选择此快照；理论与案例可同时进行语义召回。详情见该快照 README。结构验证不等于内容审核，不升级原文断法资格。

上下文复核更新：已就绪的 `stage11-context-review-v1` 优先于 stage10。剩余 368 个疑似片段已核对分类，恢复 17 个新占例并补全 1 个现有案例；教学卦盘归为理论，评论单独拆分，串联复占不作为独立验证。6 段双列混排叙事仍保持隔离。新视图向量化完成后才启用；原快照保留供回溯。

限制：固定规则是有明确边界的工程分支，尚非完整传统断法；core 校验只确认爻位存在与角色匹配，不证明模型对问事的理解正确。检索目前没有新增适用性 reranker。未经审核原文的引用准确性及真实模型回答质量仍需单独测评。
