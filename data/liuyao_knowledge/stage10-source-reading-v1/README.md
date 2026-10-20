# 分类原文与占例检索快照

本快照从 `stage9-text-reasoning-v2` 复制生成，保留原始实体、案例、来源和已有向量。新原文检索节点只使用有明确白名单的派生片段，不再扫描全部原始 passage。

## 资料组织

`knowledge_passage_annotation` 覆盖原来的 3,541 条 passage。分类区间以原始文本 Unicode 坐标记录，分为：

- `theory`：非案例区间的论述性文本。
- `author_commentary`：从明确的作者署名／评论标记处开始，保留作者观点属性。
- `case_excerpt`：与已整理 case 的实际来源区间重叠，关联具体 case revision ID。
- `unresolved_case_fragment`：卦盘、示例或疑似占例片段，尚无法可靠关联已整理的完整 case；不进入理论检索。
- `context_heading`：标题、署名、短标签与卦名表等上下文材料；不单独向量化。

隔离资料保留分类审计，但不会进入派生检索视图。旧 `case_id` 不是分类依据，避免把理论段落的继承标签误当占例边界。

理论和评论的相邻段落在同一来源、同一章、同一类别内合并，最多约 700 字；长原子段落保留原文。每个派生实体记录父 passage、原文坐标、章节与书名，并区分与 case 的区间重叠关联和附近来源关联。全文本哈希和原文切片须一致。

分类是自动结构整理，不是专家对古籍内容或断法的审核。`source_structure_validated` 仅表示来源和结构经过校验；`content_review=unreviewed` 不变，`production_eligible=false`，不得由此启用确定性断法。

## 去重和召回

归一化空白后的重复原文只建立一个检索视图，其他来源保留。召回后进一步按同一来源重叠区间与相同原文去重；案例优先，避免它所包含的原文再次成为独立证据。相关作者评论可以保留不同用途，但不应被视为独立验证。

检索分别保留最多 4 个占例、6 个理论片段和 2 个作者评论。各路 BM25 与已验证的真实语义向量经 RRF 融合。原文和案例分别返回类型、审核状态和来源引用。现有 207 个案例问句向量复用，新建 332 个理论／评论向量。

关键词通道补常见简繁字与占婚、求官、占病等历史检索词，仅扩展检索词汇，不写入问事事实。语义通道继续使用原始 query。

## 重建与验收

在 `fortune_module4` 下运行：

```bash
.venv/bin/python -m scripts.curate_liuyao_passages --prepare-only
.venv/bin/python -m scripts.curate_liuyao_passages
.venv/bin/python -m scripts.validate_curated_passages
.venv/bin/python -m scripts.validate_curated_passages --live
```

向量化使用既有配置的 embedding provider，按真实响应计 token，模型探针前后核验，带缓存与传输错误重试。只有全部作业完成后才设置 `source_reading` 活跃发布并写入 `retrieval_ready.json`；网页检索随后选择本快照。中断后可以重跑，已经完成的向量不会重复请求。

`curation_report.json` 是逐段分类和父来源报告；`embedding_report.json`、`embedding_batches.jsonl` 是向量化汇总和审计；`validation_report.json` 与 `live_retrieval_validation.json` 是全量来源／向量检查及四类问事的召回试查。试查验证管道与材料类型，不代表解卦语义正确性验收。
