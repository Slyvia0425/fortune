"""Post-selection source/case retrieval; fixed use rules never enter this search."""

from sqlalchemy import select

from app.services.embeddings import cosine_similarity, embedding_request_timeout, validate_embedding

from . import schema as s
from .hybrid import best_ranks, score
from .ingest import canonical, sha
from .retrieval import allowed_rows, bm25, quotes

TRANSLATION = str.maketrans(
    dict(
        zip(
            "财孙应动变亲阴阳无进为书职复结问师时试举业气医药",
            "財孫應動變親陰陽無進為書職復結問師時試舉業氣醫藥",
            strict=True,
        )
    )
)


def keyword_query(query):
    """Historical vocabulary expands recall only, never creates chart/user facts."""
    aliases = []
    for triggers, terms in [
        (("婚", "复合", "戀", "恋"), "占婚 婚事"),
        (("求财", "求財", "财运", "生意"), "求財 占財 財利"),
        (("工作", "求职", "求職", "职位", "功名"), "功名 求官 仕途"),
        (("疾病", "康复", "康復", "病"), "占病 病症"),
        (("考试", "考試", "录取"), "功名 科舉 鄉試"),
    ]:
        if any(term in query for term in triggers):
            aliases.append(terms)
    return (query + " " + " ".join(aliases)).translate(TRANSLATION)


def retrieve_sources(
    engine,
    release_id,
    chart,
    queries,
    *,
    provider=None,
    question_context=None,
    query_lanes=None,
    query_requests=None,
):
    embedding_request_timeout()
    query_lanes = query_lanes if query_lanes is not None else ["all"] * len(queries)
    if len(query_lanes) != len(queries) or any(
        lane not in ("all", "theory", "case") for lane in query_lanes
    ):
        raise ValueError("Invalid query lanes")
    if query_requests is not None and (len(query_requests) != len(queries) or len(queries) > 5):
        raise ValueError("Invalid query requests")
    with engine.connect() as conn:
        rel, rows = allowed_rows(
            conn,
            release_id,
            method=chart["method_profile_id"],
            preserve_views=True,
            purpose="llm_source_reasoning",
        )
        if (
            rel["status"] != "text_published"
            or rel["validation"].get("purpose") != "llm_source_reasoning"
        ):
            raise ValueError("Text reasoning release unavailable")
        cases = [r for r in rows if r["kind"] == "case" and r["embedding_allowed"]]
        revoked = list(conn.execute(select(s.revocation)).mappings())
        revoked_entities = {r["entity_revision_id"] for r in revoked if r["entity_revision_id"]}
        revoked_sources = {r["source_revision_id"] for r in revoked if r["source_revision_id"]}
        bad = set(
            conn.execute(
                select(s.lineage.c.entity_revision_id).where(
                    s.lineage.c.source_revision_id.in_(revoked_sources)
                )
            ).scalars()
        )
        # Passages are reading material, not released executable rules. Retain review status.
        curated = "source_allowlist" in rel["validation"]
        passages = [r for r in rows if r["kind"] == "passage"] if curated else []
        for row in (
            []
            if curated
            else conn.execute(select(s.entity).where(s.entity.c.kind == "passage")).mappings()
        ):
            if (
                row["review_status"] == "quarantined"
                or row["revision_id"] in bad | revoked_entities
                or row["entity_id"] in revoked_entities
            ):
                continue
            if sha(row["text"]) != row["content_hash"]:
                raise ValueError("Immutable passage hash mismatch")
            passages.append(dict(row) | {"search_text": row["text"], "view_id": None})
        views = {
            r["entity_revision_id"]: r
            for r in conn.execute(
                select(s.view).where(s.view.c.embedding_allowed.is_(True))
            ).mappings()
        }
        vectors = {
            r["view_id"]: r
            for r in conn.execute(
                select(s.embedding).where(s.embedding.c.profile_id == rel["profile_id"])
            ).mappings()
        }
        profile = (
            conn.execute(select(s.profile).where(s.profile.c.profile_id == rel["profile_id"]))
            .mappings()
            .first()
        )
        if provider and (
            not profile
            or not profile["verified"]
            or provider.name != profile["config"].get("model_name")
            or provider.dimension != profile["dimension"]
        ):
            raise ValueError("Embedding profile mismatch")
        for row in passages:
            view = views.get(row["revision_id"])
            if view and view["text_hash"] == sha(view["text"]):
                row["view_id"] = view["view_id"]
        trace, cache, output, selected_spans, selected_texts = [], {}, [], [], set()
        # Multi-query planning adds requests: embed in small batches instead of serial round trips.
        if provider and hasattr(provider, "embed_many"):
            unique_queries = list(dict.fromkeys(queries))
            for offset in range(0, len(unique_queries), 4):
                embedding_request_timeout()
                batch = unique_queries[offset : offset + 4]
                try:
                    embedded = provider.embed_many(batch)
                    if len(embedded) != len(batch):
                        raise ValueError("Embedding batch count mismatch")
                    validated = [
                        validate_embedding(vector, profile["dimension"]) for vector in embedded
                    ]
                    cache.update(zip(batch, validated, strict=True))
                except Exception as exc:
                    cache.update({query: None for query in batch})
                    trace.append(
                        {
                            "semantic_unavailable": type(exc).__name__,
                            "query_ids": [i + 1 for i, q in enumerate(queries) if q in batch],
                            "fallback": "bm25",
                        }
                    )
        lanes = [("case", cases, 4, "case_excerpt")]
        if curated:
            lanes += [
                (
                    "passage",
                    [r for r in passages if r["metadata_json"]["content_type"] == "theory"],
                    6,
                    "theory",
                ),
                (
                    "passage",
                    [
                        r
                        for r in passages
                        if r["metadata_json"]["content_type"] == "author_commentary"
                    ],
                    2,
                    "author_commentary",
                ),
            ]
        else:
            lanes.append(("passage", passages, 8, None))
        for lane, candidates, budget, content_type in lanes:
            embedding_request_timeout()
            rankings = []
            by_id = {r["revision_id"]: r for r in candidates}
            for index, query in enumerate(queries):
                embedding_request_timeout()
                target = query_lanes[index]
                if target != "all" and not (
                    target == "case"
                    and lane == "case"
                    or target == "theory"
                    and lane == "passage"
                    and (not curated or content_type == "theory")
                ):
                    continue
                # Match common simplified/traditional terms without altering source quotations.
                values = bm25(
                    keyword_query(query),
                    [r["search_text"].translate(TRANSLATION) for r in candidates],
                )
                hits = sorted(
                    [
                        (r["revision_id"], v)
                        for r, v in zip(candidates, values, strict=True)
                        if v > 0
                    ],
                    key=lambda x: (-x[1], x[0]),
                )
                rankings.append(("keyword", [rid for rid, _ in hits][:40]))
                vector_hits = []
                if provider and any(r["view_id"] in vectors for r in candidates):
                    if query not in cache:
                        try:
                            cache[query] = validate_embedding(
                                provider.embed(query), profile["dimension"]
                            )
                        except Exception as exc:
                            cache[query] = None
                            trace.append(
                                {"query_id": index + 1, "semantic_unavailable": type(exc).__name__}
                            )
                    if cache[query] is not None:
                        for row in candidates:
                            saved = vectors.get(row["view_id"])
                            if saved:
                                vector = validate_embedding(saved["vector"], profile["dimension"])
                                if sha(canonical(vector)) != saved["vector_hash"]:
                                    raise ValueError("Vector hash mismatch")
                                vector_hits.append(
                                    (row["revision_id"], cosine_similarity(cache[query], vector))
                                )
                        rankings.append(
                            (
                                "vector",
                                [
                                    rid
                                    for rid, _ in sorted(vector_hits, key=lambda x: (-x[1], x[0]))
                                ][:40],
                            )
                        )
                trace.append(
                    {
                        **(query_requests[index] if query_requests else {}),
                        "lane": lane,
                        "content_type": content_type,
                        "query_id": index + 1,
                        "keyword_hits": len(hits),
                        "vector_hits": len(vector_hits),
                        "candidate_revision_ids": list(
                            dict.fromkeys(
                                [rid for rid, _ in hits[:40]]
                                + [
                                    rid
                                    for rid, _ in sorted(vector_hits, key=lambda x: (-x[1], x[0]))[
                                        :40
                                    ]
                                ]
                            )
                        ),
                        "keyword_top": [
                            {"entity_revision_id": rid, "score": value} for rid, value in hits[:10]
                        ],
                        "vector_top": [
                            {"entity_revision_id": rid, "similarity": value}
                            for rid, value in sorted(vector_hits, key=lambda x: (-x[1], x[0]))[:10]
                        ],
                    }
                )
            ranks = best_ranks(rankings)
            used, count = 0, 0
            for rid in sorted(ranks, key=lambda x: (-score(ranks[x]), x)):
                embedding_request_timeout()
                if count >= budget:
                    break
                source = quotes(conn, rid)
                fingerprint = sha("".join("".join(q["quote"].split()) for q in source))
                # V4 accumulator must see overlapping semantic units and source versions.
                exact = tuple(
                    sorted(
                        (q["source_revision_id"], q["start"], q["end"], q["quote_hash"])
                        for q in source
                    )
                )
                if (exact if query_requests is not None else fingerprint) in selected_texts:
                    trace.append({"reason": "SOURCE_TEXT_DEDUP", "entity_revision_id": rid})
                    continue
                # Cases first: avoid treating their containing passage as independent evidence.
                spans = [(q["source_revision_id"], q["start"], q["end"]) for q in source]
                if query_requests is None and any(
                    a == b and max(start, other_start) < min(end, other_end)
                    for a, start, end in spans
                    for b, other_start, other_end in selected_spans
                ):
                    trace.append({"reason": "SOURCE_OVERLAP_DEDUP", "entity_revision_id": rid})
                    continue
                size = sum(len(q["quote"]) for q in source)
                if size + used > 12000:
                    continue
                row = by_id[rid]
                output.append(
                    {
                        "entity_revision_id": rid,
                        "entity_id": row["entity_id"],
                        "kind": lane,
                        "usage": "analogy_only" if lane == "case" else "source_reading",
                        "summary": row["search_text"],
                        "source_quotes": source,
                        "content_type": row["metadata_json"].get("content_type", "unclassified"),
                        "content_review": row["metadata_json"].get(
                            "content_review", row["review_status"]
                        ),
                        "related_case_revision_ids": row["metadata_json"].get(
                            "related_case_revision_ids", []
                        ),
                        "review_status": row["review_status"],
                        "case_context": row["metadata_json"] if lane == "case" else None,
                        "condition_evaluation": "unknown",
                        "conflict_group_ids": [],
                        "not_for_interpretation": False,
                        "channel_ranks": ranks[rid],
                        "rrf_score": score(ranks[rid]),
                    }
                )
                selected_spans.extend(spans)
                selected_texts.add(exact if query_requests is not None else fingerprint)
                used += size
                count += 1
        embedding_request_timeout()
        selected_ids = {u["entity_revision_id"] for u in output}
        for item in trace:
            if "candidate_revision_ids" in item:
                item["selected_evidence_ids"] = [
                    rid for rid in item.pop("candidate_revision_ids") if rid in selected_ids
                ]
                item["candidate_status"] = (
                    "candidates_found"
                    if item["keyword_hits"] or item["vector_hits"]
                    else "no_results"
                )
        gaps = [] if output else ["NO_SOURCE_EVIDENCE"]
        if any(u["content_review"] == "unreviewed" for u in output):
            gaps.append("UNREVIEWED_SOURCE_MATERIAL")
        return {
            "chart_id": chart["chart_id"],
            "chart_hash": chart["chart_hash"],
            "core_version": chart["core_version"],
            "method_profile_id": chart["method_profile_id"],
            "knowledge_release_id": release_id,
            "status": "evidence_insufficient",
            "reasoning_mode": "llm_source_reasoning",
            "reasoning_evidence": output,
            "supporting_evidence": [],
            "pending_conditions": output,
            "counter_evidence": [],
            "selected_use": [],
            "candidate_roles": [],
            "facts": {"question": question_context},
            "gaps": gaps,
            "clarification": [],
            "retrieval_trace": trace,
            "query_plan": {
                "queries": queries,
                "query_lanes": query_lanes,
                "query_requests": query_requests,
                "version": "task-source-round-v1" if query_requests else "post-fixed-use-v2",
                "lanes": ["passage", "case"],
            },
            "interpretation_contract": {
                "model_reasoning_allowed": bool(output),
                "model_selection_allowed": False,
                "strong_conclusion_allowed": False,
                "recast_allowed": False,
                "copy_case_outcome": False,
            },
        }
