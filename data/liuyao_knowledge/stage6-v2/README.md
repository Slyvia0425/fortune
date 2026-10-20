# 六爻知识数据库 v2：本次处理结果

日期：2026-10-10。依据工作目录《六爻向量数据库处理详细方案 v2》。

**当前状态：已建成并验证本地候选数据库；尚未批量生成新版向量，也未发布生产检索。**

## 已落库的数据

数据库：本目录 `knowledge.sqlite3`。与原用户数据库、stage4 索引分开保存。

| 内容 | 数量 | 状态 |
| --- | ---: | --- |
| 来源版本 | 6 | 保留底本文字、网址和哈希；原始审核状态不升级 |
| 原文段落 | 3,541 | 保留段落、卦画、作者标记及前后段关联 |
| 文字规则 | 36 | 沿用 modified_pass；全部 executable=false、production_eligible=false |
| 案例父记录 | 216 | 保留 case_group_id、reading_id；不把完整结局嵌入案例检索摘要 |
| 分流材料 | 50 | 独立存放，不再作为案例召回 |
| 知识实体合计 | 3,843 | 全部为候选资料 |
| 来源关联 | 3,867 | 全部引用逐条验证原文、偏移及哈希 |

保留 263 行新旧案例映射、401 条旧 chunk 至段落的映射。不会把旧 chunk 永久作为新知识身份。

15 条案例和 2 条分流材料的旧偏移与文本不符。本次仅在新库中，通过同一底本内唯一全文匹配纠正 17 处偏移，未修改原文字句。修正前后区间详见 `validation_report.json` 的 `offset_repairs`。

## 导入与检索约束

- `import_manifest.json` 显式允许 8 个数据文件，逐个固定 SHA-256、实体类型及审核保留策略；拒绝额外路径、教学目录、哈希变化及越界路径。
- 没有新增导入教学题目、答案、评分或教学派生材料。既存古籍原文仍保留，独立实验必须另给隔离 ID 清单。
- stage4 的 index 和 manifest 哈希已记录并复核未变；未覆盖或升级旧索引。
- 原文暂保留已有原子段落边界，没有机械合并短段或拆断长段。短段、超长段、案例相关段和作者边界仍需后续语义切块审核。
- 新数据库检索有过滤后 BM25、精确余弦路径、RRF、三值 AST、冲突组补取与来源原文回填。BM25 使用明示的 `cjk-bigram-v1`，尚无完整版本化六爻术语词典。
- 案例的结果隐藏和摘要审核尚未完成，因此当前案例仅保存，不开启案例语义召回。
- 未经编码审核的规则结果仍是 unknown，不伪装成适用条件成立。
- 本地 review 函数与 production 函数分开。现有 HTTP 接口拒绝 review_mode 绕过；未发布旧索引在模型调用前直接返回缺证。
- 新版 production 函数需要服务端 core_loader；尚未连接真实冻结盘存储、解释模型或 Guardian，不能称为端到端可用。

## 向量状态

当前数据库向量数：**0**。这不是已完成的向量索引。

46 个视图已生成待处理作业（36 条规则、10 个满足初步长度与边界条件的原文段落）；其余 3,797 个视图排除自动向量化，保留资料本身。排除原因和作业状态可查数据库。

已对配置中的 `qwen3.7-text-embedding` 执行模型目录查询和三条固定短文本探针。模型目录有该名称，探针返回合法的 1,024 维非零有限向量。这里只说明接口和探针响应有效，不能据此认定模型底层身份或长输入能力。

服务没有给出固定 revision、tokenizer 和最大输入 token 数。`model_verification.json` 保存探针文本、响应向量哈希和缺项；没有复用旧 stage4 向量，也没有以 hash embedding 代替正式向量。需补足 tokenizer、输入上限及版本/漂移策略，建立新冻结 profile 后再跑批量作业。

已实现作业缓存、输入哈希校验、有上限的临时错误重试、返回 index/维度/数值/范数校验。认证或格式错误不会被静默降级成伪向量。

## 验证结果与限度

- 32 项相关测试通过：新库、旧检索、原文处理、规则数据、用户案例与推荐回归。
- 重复构建复用同一 release，无重复入库。
- 数据库 integrity_check=ok；外键错误 0；3,867 条来源关联全部通过回读核验。
- 本地审核检索示例返回 7 条规则材料，全部标记不用于正式解释；正式检索返回 0 条，状态 evidence_insufficient。
- 独立临时 SQLite 数据库执行 Alembic upgrade head 成功，新建 12 张 knowledge 表。
- PostgreSQL DDL 编译通过；**没有连接真实 PostgreSQL 执行迁移、向量查询或性能测试**。
- 未启用发布指针，未上线，未提交 Git。未修改起卦算法。

检查生产闸门时使用合成审计 chart；不是对真实 core 的集成测试。没有人工标注的独立检索集，不能报告 Recall/MRR/nDCG 或声称解释准确率。

## 重复运行

在 `fortune_module4` 目录执行：

```bash
PYTHONPATH=. .venv/bin/python scripts/build_liuyao_knowledge_v2.py
PYTHONPATH=. .venv/bin/python scripts/verify_liuyao_knowledge_v2.py
PYTHONPATH=. .venv/bin/python -m pytest tests/test_knowledge_v2.py tests/test_liuyao_retrieval.py tests/test_liuyao_corpus.py tests/test_liuyao_rule_dataset.py tests/test_recommendations.py tests/test_cases.py -q
```

输入改变时旧 manifest 会拒绝导入，应使用新的输出目录冻结新版本，不能覆盖旧 manifest 来假装相同版本。

## 与方案实施步骤对应

| 步骤 | 本次结果 |
| --- | --- |
| A 冻结与导入清单 | 完成，本地哈希冻结与明确允许列表 |
| B 独立表与迁移 | 完成本地数据库和迁移；PostgreSQL 运行验证待做 |
| C 来源/视图/切块 | 完成来源核对、原子段落和视图；语义重切块与案例子段待审 |
| D embedding 作业 | 代码和故障测试完成，真实批量作业因模型配置缺项未运行 |
| E 混合检索 | 实现数据库服务路径；真实向量召回尚未验收 |
| F 条件与证据 | 通用三值引擎、冲突补取、原文回填完成；36 条 AST 尚未审核编码 |
| G 解释与 Guardian | 尚未对接 |
| H 检索测评 | 完成工程测试；独立人工相关性标注集与指标尚缺 |
| I ANN 与重排 | 未启用；当前不具备启用依据 |

后续需先补齐模型参数、审核可执行规则及案例检索摘要，再做独立检索评测和实际服务对接。候选数据库成功写入不等于资料获准发布。
