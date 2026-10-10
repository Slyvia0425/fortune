"""Bounded, multi-query, filter-first retrieval (§17–24). No model-generated rule actions."""

from time import monotonic

from sqlalchemy import select

from app.services.embeddings import HashEmbeddingProvider, cosine_similarity, validate_embedding

from . import schema as s
from .candidates import ROLE_NAMES, comparable, complete_main, derive, rule_condition
from .ingest import canonical, sha
from .query_plan import make_query, plan
from .retrieval import TOKENIZER_VERSION, allowed_rows, bm25, quotes


def best_ranks(rankings):
    """Deduplicate views first, then take each entity's best rank per channel across queries."""
    result = {}
    for channel, hits in rankings:
        unique = list(dict.fromkeys(hits))
        for rank, rid in enumerate(unique, 1):
            ranks = result.setdefault(rid, {})
            ranks[channel] = min(rank, ranks.get(channel, rank))
    return result


def score(ranks):
    return sum(1 / (60 + rank) for rank in ranks.values())


def search(
    engine,
    release_id,
    queries,
    facts,
    context,
    *,
    method,
    provider=None,
    review=False,
    excluded_ids=(),
    vector_cache=None,
):
    cache = vector_cache if vector_cache is not None else {}
    with engine.connect() as conn:
        rel, rows = allowed_rows(
            conn,
            release_id,
            review=review,
            method=method,
            excluded_ids=excluded_ids,
            preserve_views=True,
        )
        rows = [
            r
            for r in rows
            if r["kind"] == "rule" or (r["kind"] == "case" and r["embedding_allowed"])
        ]
        profile = (
            conn.execute(select(s.profile).where(s.profile.c.profile_id == rel["profile_id"]))
            .mappings()
            .first()
        )
        trace, vectors = [], {}
        if rows and provider:
            if (
                not profile
                or not profile["verified"]
                or isinstance(provider, HashEmbeddingProvider)
                or provider.name != profile["config"].get("model_name")
                or provider.dimension != profile["dimension"]
                or (
                    profile["config"].get("endpoint_identity")
                    and getattr(provider, "endpoint_identity", None)
                    != profile["config"]["endpoint_identity"]
                )
            ):
                raise ValueError("Embedding profile mismatch")
            vectors = {
                r["view_id"]: r
                for r in conn.execute(
                    select(s.embedding).where(s.embedding.c.profile_id == rel["profile_id"])
                ).mappings()
            }
        if rows and provider is None:
            trace.append(
                {"reason": "NO_VERIFIED_QUERY_PROVIDER", "fallback": "bm25_and_structured"}
            )
        output = []
        for lane, budget in (("rule", 8), ("case", 4)):
            lane_rows = [r for r in rows if r["kind"] == lane]
            by_id = {r["revision_id"]: r for r in lane_rows}
            rankings = []
            for query in queries:
                if query["lane"] != lane:
                    continue
                candidates = [
                    r
                    for r in lane_rows
                    if lane != "rule"
                    or not query["rule_types"]
                    or r["rule"]["rule_type"] in query["rule_types"]
                ]
                keyword = bm25(query["text"], [r["search_text"] for r in candidates])
                hits = sorted(
                    (
                        (r["revision_id"], value)
                        for r, value in zip(candidates, keyword, strict=True)
                        if value > 0
                    ),
                    key=lambda x: (-x[1], x[0]),
                )
                rankings.append(("keyword", list(dict.fromkeys(rid for rid, _ in hits))[:40]))
                if candidates and provider:
                    key = (rel["profile_id"], query["text"])
                    if key not in cache:
                        try:
                            value = validate_embedding(
                                provider.embed(query["text"]), profile["dimension"]
                            )
                            cache[key] = value
                            trace.append(
                                {
                                    "query_id": query["query_id"],
                                    "embedding_request": True,
                                    "usage": getattr(provider, "last_response_metadata", {}).get(
                                        "usage"
                                    ),
                                }
                            )
                        except Exception as exc:
                            cache[key] = None
                            trace.append(
                                {
                                    "query_id": query["query_id"],
                                    "embedding_request": True,
                                    "semantic_unavailable": type(exc).__name__,
                                }
                            )
                    if cache[key] is not None:
                        hits = []
                        for row in candidates:
                            saved = vectors.get(row["view_id"])
                            if saved:
                                vector = validate_embedding(saved["vector"], profile["dimension"])
                                if sha(canonical(vector)) != saved["vector_hash"]:
                                    raise ValueError("Vector hash mismatch")
                                hits.append(
                                    (row["revision_id"], cosine_similarity(cache[key], vector))
                                )
                        rankings.append(
                            (
                                "vector",
                                list(
                                    dict.fromkeys(
                                        rid for rid, _ in sorted(hits, key=lambda x: (-x[1], x[0]))
                                    )
                                )[:40],
                            )
                        )
                trace.append(
                    {
                        "query_id": query["query_id"],
                        "lane": lane,
                        "eligible_views": len(candidates),
                        "keyword_hits": sum(v > 0 for v in keyword),
                    }
                )
            direct = [
                rid
                for rid, row in by_id.items()
                if row["rule"] and rule_condition(row["rule"], facts)["value"] == "true"
            ]
            rankings.append(("structured", sorted(direct)))
            ranks = best_ranks(rankings)
            ids = sorted(ranks, key=lambda rid: (rid not in direct, -score(ranks[rid]), rid))
            selected, quoted, used = [], {}, 0
            for seed in ids:
                if seed in selected:
                    continue
                members = {seed}
                while True:
                    groups = {
                        g
                        for rid in members
                        for g in (by_id[rid]["rule"] or {}).get("conflict_group_ids", [])
                    }
                    expanded = members | {
                        rid
                        for rid, row in by_id.items()
                        if groups.intersection((row["rule"] or {}).get("conflict_group_ids", []))
                    }
                    if expanded == members:
                        break
                    members = expanded
                additions = sorted(members - set(selected))
                if len(selected) + len(additions) > budget:
                    trace.append(
                        {
                            "reason": "EVIDENCE_BUDGET_EXCEEDED"
                            if groups or any(rid in direct for rid in additions)
                            else "RANKING_CUTOFF",
                            "lane": lane,
                            "entity_revision_ids": additions,
                        }
                    )
                    continue
                for rid in additions:
                    quoted[rid] = quotes(conn, rid)
                amount = sum(len(q["quote"]) for rid in additions for q in quoted[rid])
                if used + amount > 12000:
                    trace.append(
                        {
                            "reason": "EVIDENCE_BUDGET_EXCEEDED"
                            if groups or any(rid in direct for rid in additions)
                            else "RANKING_CUTOFF",
                            "lane": lane,
                            "entity_revision_ids": additions,
                        }
                    )
                    continue
                selected.extend(additions)
                used += amount
            for rid in selected:
                row, rule = by_id[rid], by_id[rid]["rule"]
                condition = (
                    rule_condition(rule, facts)
                    if rule
                    else comparable(row["metadata_json"], context)
                )
                output.append(
                    {
                        "entity_revision_id": rid,
                        "entity_id": row["entity_id"],
                        "kind": lane,
                        "source_quotes": quoted[rid],
                        "summary": row["search_text"],
                        "condition_evaluation": condition["value"],
                        "condition_details": condition,
                        "action_ast": rule["action_ast"] if rule else None,
                        "rule_contract": dict(rule) if rule else None,
                        "rule_type": rule["rule_type"] if rule else None,
                        "conflict_group_ids": (rule or {}).get("conflict_group_ids", []),
                        "not_for_interpretation": review,
                        "channel_ranks": ranks.get(rid, {}),
                        "rrf_score": score(ranks.get(rid, {})),
                    }
                )
        return output, trace, rel["profile_id"]


def _run(engine, release_id, question, core, *, provider=None, review=False, excluded_ids=()):
    started = monotonic()
    if (
        not core.get("chart_hash")
        or not core.get("core_version")
        or not core.get("method_profile_id")
    ):
        raise ValueError("CHART_FACTS_INCOMPLETE")
    query_plan = plan(question)
    context = query_plan["question_context"]
    core_facts = core.get("facts", {})
    facts = {"question": context, "core": core_facts, "candidates": {}}
    traces, cache, executed = [], {}, set()
    roles, units = [], []
    for round_number in range(3):
        # Recheck qualification/revocation each round; cache query vectors only.
        queries = query_plan["queries"]
        executed.update((q["lane"], q["text"]) for q in queries)
        units, trace, profile_id = search(
            engine,
            release_id,
            queries,
            facts,
            context,
            method=core["method_profile_id"],
            provider=provider,
            review=review,
            excluded_ids=excluded_ids,
            vector_cache=cache,
        )
        traces.extend({**item, "round": round_number} for item in trace)
        roles = derive(units, core_facts)
        facts["candidates"] = {r["role_id"].removeprefix("role:"): r for r in roles}
        # Re-evaluate conditions against new candidates without another search.
        for unit in units:
            if unit["rule_contract"]:
                condition = rule_condition(unit["rule_contract"], facts)
                unit["condition_evaluation"] = condition["value"]
                unit["condition_details"] = condition
        roles = derive(units, core_facts)
        facts["candidates"] = {r["role_id"].removeprefix("role:"): r for r in roles}
        followups = []
        for candidate in roles:
            role = candidate["role_id"].removeprefix("role:")
            count = len(candidate["main_hexagram_line_refs"])
            kind = (
                "missing_candidate"
                if candidate["presence_status"] == "known_absent"
                else "multiple_candidates"
                if count >= 2
                else None
            )
            if kind:
                terms = (
                    "不现 伏神 飞神 可用条件"
                    if kind == "missing_candidate"
                    else "多现 动静 旺衰 选择条件"
                )
                followups.append(
                    make_query(
                        f"{ROLE_NAMES[role]} {terms}",
                        "rule",
                        kind,
                        ["candidates." + role],
                        rule_types=[kind],
                        round_number=round_number + 1,
                    )
                )
        unseen = [q for q in followups if (q["lane"], q["text"]) not in executed]
        if not unseen:
            break
        if round_number == 2:
            traces.append({"reason": "QUERY_BUDGET_EXCEEDED", "unexecuted": unseen})
            break
        for query in unseen:
            if len(queries) >= 8:
                traces.append({"reason": "QUERY_BUDGET_EXCEEDED", "unexecuted": query})
                break
            query["query_id"] = f"q{len(queries) + 1}"
            queries.append(query)
    supporting = [
        u
        for u in units
        if not review and u["condition_evaluation"] == "true" and not u["conflict_group_ids"]
    ]
    pending = [u for u in units if u not in supporting]
    gaps = []
    if not any(u["kind"] == "rule" for u in supporting):
        gaps.append("NO_ELIGIBLE_EVIDENCE")
    if not complete_main(core_facts) or any(r["missing_facts"] for r in roles):
        gaps.append("CHART_FACTS_INCOMPLETE")
    if (
        any(u["kind"] == "rule" and u["condition_evaluation"] == "unknown" for u in units)
        or not roles
        or any(not r["selected_line_ref"] for r in roles)
    ):
        gaps.append("UNRESOLVED_CONDITION")
    if any(u["conflict_group_ids"] for u in units) or any(r["conflicts"] for r in roles):
        gaps.append("METHOD_CONFLICT")
    if any("BUDGET_EXCEEDED" in t.get("reason", "") for t in traces):
        gaps.append("RETRIEVAL_BUDGET_EXCEEDED")
    clarification = []
    if context["subject_relation"] is None:
        clarification.append(
            {"field": "subject_relation", "question": "这次问的是谁的事情，你与对方是什么关系？"}
        )
    if context["goal"] is None:
        clarification.append(
            {"field": "goal", "question": "你想了解事情能否达成、发生时间，还是其他具体问题？"}
        )
    required = {
        field
        for unit in units
        if unit["kind"] == "rule"
        for field in unit["condition_details"].get("missing_fields", [])
    }
    if "question.exam_type" in required and context["exam_type"] is None:
        clarification.append(
            {
                "field": "exam_type",
                "question": "这次具体是什么类型的考试？相关规则需要区分考试类型。",
            }
        )
    if context["topic"] is None and "涉及多个专题，未确定主问" in context["ambiguities"]:
        clarification.append({"field": "topic", "question": "这次最主要想问哪一件事？"})
    if clarification:
        gaps.append("QUESTION_CONTEXT_INCOMPLETE")
    query_plan["consumption"] = {
        "unique_queries": len(executed),
        "followup_rounds": round_number,
        "embedding_requests": sum(bool(t.get("embedding_request")) for t in traces),
        "provider_usage": [t["usage"] for t in traces if t.get("usage")],
        "elapsed_ms": round((monotonic() - started) * 1000),
        "token_count_source": "provider_usage_only",
        "token_budget": None,
    }
    pack = {
        "knowledge_release_id": release_id,
        "embedding_profile_id": profile_id,
        "chart_id": core.get("chart_id"),
        "chart_hash": core["chart_hash"],
        "core_version": core["core_version"],
        "method_profile_id": core["method_profile_id"],
        "method_profile_version": core.get("method_profile_version"),
        "facts": facts,
        "query_plan": query_plan,
        "candidate_roles": roles,
        "selected_use": [
            {
                "role_id": r["role_id"],
                "line_ref": r["selected_line_ref"],
                "rule_ids": r.get("selection_rule_ids", []),
            }
            for r in roles
            if r["selected_line_ref"] and not gaps
        ],
        "supporting_evidence": supporting,
        "pending_conditions": pending if not review else [],
        "counter_evidence": [
            u for u in units if u["condition_evaluation"] == "false" or u["conflict_group_ids"]
        ]
        if not review
        else [],
        "review_candidates": units if review else [],
        "gaps": gaps,
        "clarification": clarification,
        "case_support_available": any(u["kind"] == "case" for u in supporting),
        "retrieval_trace": traces,
        "tokenizer_version": TOKENIZER_VERSION,
        "status": "evidence_ready" if not gaps else "evidence_insufficient",
        "interpretation_contract": {
            "recast_allowed": False,
            "calculate_missing_core_facts": False,
            "copy_case_outcome": False,
            "strong_conclusion_allowed": not gaps and not review,
        },
    }
    return pack


def run_production(
    engine, release_id, question, *, chart_id, core_loader, provider=None, excluded_ids=()
):
    core = core_loader(chart_id)
    if core.get("original_question") != question:
        raise ValueError("Frozen question mismatch")
    return _run(engine, release_id, question, core, provider=provider, excluded_ids=excluded_ids)


def run_review_local(engine, release_id, question, core, *, provider=None, excluded_ids=()):
    return _run(
        engine,
        release_id,
        question,
        core,
        provider=provider,
        excluded_ids=excluded_ids,
        review=True,
    )
