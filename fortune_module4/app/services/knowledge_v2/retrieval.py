"""Filter-first exact retrieval. Review access is a separate local function, not a request flag."""

import math
import re
from collections import Counter

from sqlalchemy import select

from app.services.embeddings import HashEmbeddingProvider, cosine_similarity, validate_embedding

from . import schema as s
from .conditions import evaluate
from .ingest import canonical, sha

TOKENIZER_VERSION = "cjk-bigram-v1"


def tokens(text):
    result = []
    for word in re.findall(r"[\u3400-\u9fff]+|[a-zA-Z0-9_]+", text.lower()):
        result.extend(
            [word]
            if not re.search(r"[\u3400-\u9fff]", word) or len(word) == 1
            else [word[i : i + 2] for i in range(len(word) - 1)]
        )
    return result


def bm25(query, texts):
    docs = [Counter(tokens(t)) for t in texts]
    if not docs:
        return []
    lengths = [sum(d.values()) for d in docs]
    avg = sum(lengths) / len(docs) or 1
    df = Counter(token for d in docs for token in d)
    scores = []
    for d, length in zip(docs, lengths, strict=True):
        score = 0.0
        for term in set(tokens(query)):
            tf = d.get(term, 0)
            if tf:
                idf = math.log(1 + (len(docs) - df[term] + 0.5) / (df[term] + 0.5))
                score += idf * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * length / avg))
        scores.append(score)
    return scores


def quotes(conn, rid):
    rows = conn.execute(
        select(
            s.lineage,
            s.source.c.raw_text,
            s.source.c.raw_sha256,
            s.source.c.offset_unit,
            s.source.c.url,
        )
        .join(s.source)
        .where(s.lineage.c.entity_revision_id == rid)
    ).mappings()
    result = []
    for row in rows:
        raw = row["raw_text"]
        quote = raw[row["start"] : row["end"]]
        if sha(raw) != row["raw_sha256"] or sha(quote) != row["quote_hash"]:
            raise ValueError("Source quote/hash mismatch")
        result.append(
            {
                k: row[k]
                for k in ("source_revision_id", "passage_id", "start", "end", "offset_unit", "url")
            }
            | {"quote": quote, "quote_hash": row["quote_hash"]}
        )
    if not result:
        raise ValueError("Entity lacks source quotes")
    return result


def allowed_rows(
    conn, release_id, *, review=False, excluded_ids=(), method=None, preserve_views=False
):
    rel = (
        conn.execute(select(s.release).where(s.release.c.release_id == release_id)).mappings().one()
    )
    if not review and rel["status"] != "published":
        return rel, []
    revocations = conn.execute(select(s.revocation)).mappings().all()
    excluded = set(excluded_ids) | {
        r["entity_revision_id"] for r in revocations if r["entity_revision_id"]
    }
    bad_sources = set(excluded_ids) | {
        r["source_revision_id"] for r in revocations if r["source_revision_id"]
    }
    bad = conn.execute(
        select(s.lineage.c.entity_revision_id).where(
            s.lineage.c.source_revision_id.in_(bad_sources)
        )
    ).scalars()
    excluded.update(bad)
    rows = (
        conn.execute(
            select(
                s.entity,
                s.view.c.view_id,
                s.view.c.text.label("search_text"),
                s.view.c.embedding_allowed,
                s.view.c.summary_review_status,
                s.view.c.text_hash,
            )
            .join(s.release_item, s.release_item.c.entity_revision_id == s.entity.c.revision_id)
            .join(s.view, s.view.c.view_id == s.release_item.c.view_id)
            .where(s.release_item.c.release_id == release_id)
        )
        .mappings()
        .all()
    )
    rules = {r["entity_revision_id"]: dict(r) for r in conn.execute(select(s.rule)).mappings()}
    result = []
    seen = set()
    for row in rows:
        rid = row["revision_id"]
        if rid in excluded or row["entity_id"] in excluded or (rid in seen and not preserve_views):
            continue
        if not review and (
            not row["production_eligible"] or row["review_status"] not in ("approved", "published")
        ):
            continue
        if not review and row["summary_review_status"] not in ("approved", "published"):
            continue
        if row["kind"] == "case" and method:
            case_method = row["metadata_json"].get("method_profile_id")
            if (case_method is not None and case_method != method) or (
                not review and case_method is None
            ):
                continue
        rule = rules.get(rid)
        if rule and method and rule["method_profile_id"] != method:
            continue
        if row["kind"] == "diverted":
            continue
        if not review and row["kind"] == "case" and not row["embedding_allowed"]:
            continue
        if sha(row["text"]) != row["content_hash"] or sha(row["search_text"]) != row["text_hash"]:
            raise ValueError("Immutable entity/view hash mismatch")
        seen.add(rid)
        result.append(dict(row) | {"rule": rule})
    return rel, result


def _retrieve(
    engine,
    question,
    release_id,
    *,
    review=False,
    method=None,
    excluded_ids=(),
    trusted_core=None,
    provider=None,
    rule_types=(),
):
    if not question.strip() or len(question) > 500:
        raise ValueError("Question must be 1–500 characters")
    with engine.connect() as conn:
        rel, rows = allowed_rows(
            conn, release_id, review=review, excluded_ids=excluded_ids, method=method
        )
        # Rule and case lanes have independent budgets; source paragraphs are fetched by lineage.
        rules = [
            r
            for r in rows
            if r["kind"] == "rule" and (not rule_types or r["rule"]["rule_type"] in rule_types)
        ]
        cases = [r for r in rows if r["kind"] == "case" and r["embedding_allowed"]]
        profile = (
            conn.execute(select(s.profile).where(s.profile.c.profile_id == rel["profile_id"]))
            .mappings()
            .one()
        )
        trace, qvector = [], None
        if rows and provider is not None:
            try:
                if (
                    not profile["verified"]
                    or isinstance(provider, HashEmbeddingProvider)
                    or provider.name != profile["config"]["model_name"]
                    or provider.dimension != profile["dimension"]
                    or (
                        profile["config"].get("endpoint_identity") is not None
                        and getattr(provider, "endpoint_identity", None)
                        != profile["config"]["endpoint_identity"]
                    )
                ):
                    raise ValueError("Profile mismatch")
                qvector = validate_embedding(provider.embed(question), profile["dimension"])
            except Exception as exc:
                trace.append({"semantic_unavailable": True, "reason": type(exc).__name__})
        elif rows:
            trace.append({"semantic_unavailable": True, "reason": "NO_VERIFIED_QUERY_PROVIDER"})
        vectors = (
            {
                v["view_id"]: v
                for v in conn.execute(
                    select(s.embedding).where(s.embedding.c.profile_id == rel["profile_id"])
                ).mappings()
            }
            if qvector
            else {}
        )
        selected = []
        for lane, candidates, budget in [("rule", rules, 8), ("case", cases, 4)]:
            scores = bm25(question, [r["search_text"] for r in candidates])
            channels = {
                "keyword": sorted(
                    [
                        (r["revision_id"], score)
                        for r, score in zip(candidates, scores, strict=True)
                        if score > 0
                    ],
                    key=lambda x: (-x[1], x[0]),
                )[:40]
            }
            if qvector:
                semantic = []
                for r in candidates:
                    v = vectors.get(r["view_id"])
                    if v:
                        vector = validate_embedding(v["vector"], profile["dimension"])
                        if sha(canonical(vector)) != v["vector_hash"]:
                            raise ValueError("Vector hash mismatch")
                        semantic.append((r["revision_id"], cosine_similarity(qvector, vector)))
                channels["vector"] = sorted(semantic, key=lambda x: (-x[1], x[0]))[:40]
            # Only reviewed executable true rules qualify for structured matches.
            facts = trusted_core.get("facts", {}) if trusted_core else {}
            direct = [
                r["revision_id"]
                for r in candidates
                if r["rule"]
                and r["rule"]["executable"]
                and evaluate(r["rule"]["conditions_ast"], facts)["value"] == "true"
            ]
            channels["structured"] = [(rid, 1) for rid in sorted(direct)]
            fused, ranks = Counter(), {}
            for channel, hits in channels.items():
                for rank, (rid, _) in enumerate(hits, 1):
                    fused[rid] += 1 / (60 + rank)
                    ranks.setdefault(rid, {})[channel] = rank
            by_id = {r["revision_id"]: r for r in candidates}
            ids = sorted(fused, key=lambda rid: (rid not in direct, -fused[rid], rid))[:30]
            # Admit complete conflict groups atomically within each lane's evidence budget.
            selected_ids, quote_cache, used = [], {}, 0
            for seed in ids:
                if seed in selected_ids:
                    continue
                members = {seed}
                while True:
                    groups = {
                        g
                        for rid in members
                        for g in (by_id[rid]["rule"] or {}).get("conflict_group_ids", [])
                    }
                    expanded = members | {
                        r["revision_id"]
                        for r in candidates
                        if groups.intersection((r["rule"] or {}).get("conflict_group_ids", []))
                    }
                    if expanded == members:
                        break
                    members = expanded
                additions = sorted(
                    members - set(selected_ids), key=lambda rid: (rid != seed, -fused[rid], rid)
                )
                if len(selected_ids) + len(additions) > budget:
                    trace.append(
                        {
                            "reason": "CONFLICT_GROUP_BUDGET_EXCEEDED",
                            "entity_ids": [by_id[rid]["entity_id"] for rid in additions],
                        }
                    )
                    continue
                for rid in additions:
                    quote_cache[rid] = quotes(conn, rid)
                amount = sum(len(q["quote"]) for rid in additions for q in quote_cache[rid])
                if used + amount > 12000:
                    trace.append(
                        {
                            "reason": "EVIDENCE_BUDGET_EXCEEDED",
                            "entity_ids": [by_id[rid]["entity_id"] for rid in additions],
                        }
                    )
                    continue
                selected_ids.extend(additions)
                used += amount
            for rid in selected_ids:
                r = by_id[rid]
                condition = (
                    evaluate(r["rule"]["conditions_ast"], facts)
                    if r["rule"] and r["rule"]["executable"]
                    else {
                        "value": "unknown",
                        "reason": "RULE_NOT_EXECUTABLE"
                        if r["rule"]
                        else "CASE_COMPARABILITY_NOT_VERIFIED",
                        "missing_fields": [],
                    }
                )
                unit = {
                    "entity_revision_id": rid,
                    "entity_id": r["entity_id"],
                    "kind": lane,
                    "summary": r["search_text"],
                    "source_quotes": quote_cache[rid],
                    "condition_evaluation": condition["value"],
                    "condition_details": condition,
                    "retrieval_channels": list(ranks.get(rid, {})),
                    "channel_ranks": ranks.get(rid, {}),
                    "conflict_group_ids": (r["rule"] or {}).get("conflict_group_ids", []),
                    "not_for_interpretation": review,
                    "rrf_score": fused[rid],
                }
                selected.append(unit)
        supporting = (
            [
                r
                for r in selected
                if r["condition_evaluation"] == "true" and not r["conflict_group_ids"]
            ]
            if not review
            else []
        )
        pending = [r for r in selected if r not in supporting] if not review else []
        return {
            "knowledge_release_id": release_id,
            "embedding_profile_id": rel["profile_id"],
            "chart_hash": trusted_core.get("chart_hash") if trusted_core else None,
            "method_profile_id": method,
            "facts": trusted_core.get("facts", {}) if trusted_core else {},
            "supporting_evidence": supporting,
            "counter_evidence": [r for r in pending if r["conflict_group_ids"]],
            "pending_conditions": pending,
            "review_candidates": selected if review else [],
            "gaps": [] if supporting else ["NO_ELIGIBLE_EVIDENCE"],
            "retrieval_trace": trace,
            "status": "evidence_ready" if supporting else "evidence_insufficient",
            "tokenizer_version": TOKENIZER_VERSION,
        }


def retrieve_production(engine, question, release_id, *, method, chart_id, core_loader, **kwargs):
    # core_loader is server-owned dependency, never client-provided arbitrary facts.
    core = core_loader(chart_id)
    if not core or not core.get("chart_hash"):
        raise ValueError("CHART_FACTS_INCOMPLETE")
    if "review" in kwargs or "trusted_core" in kwargs:
        raise ValueError("Review/fact override is forbidden")
    return _retrieve(engine, question, release_id, method=method, trusted_core=core, **kwargs)


def review_local(engine, question, release_id, **kwargs):
    return _retrieve(engine, question, release_id, review=True, **kwargs)
