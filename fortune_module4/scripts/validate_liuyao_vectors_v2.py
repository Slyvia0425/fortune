"""Local exact-vector retrieval smoke test, not an independently labelled benchmark."""

import hashlib
import json
from pathlib import Path

from sqlalchemy import create_engine, func, select, text

from app.services.embeddings import get_embedding_provider, validate_embedding
from app.services.knowledge_v2 import schema as s
from app.services.knowledge_v2.ingest import canonical, sha, verify_manifest
from app.services.knowledge_v2.retrieval import quotes, retrieve_production, review_local
from app.services.knowledge_v2.vectorize import run_batches, verify_provider

# Authored from reviewed rule titles and pre-cast case openings, not teaching answers.
SMOKE = [
    ("rule", "我替父亲问事情，父母长辈属于什么类别？", ["YS-OC-01", "YS-SR-02"]),
    ("rule", "合同、文书和房屋取什么类别？", ["YS-OC-02"]),
    ("rule", "为亲兄弟问事，目标应该按什么亲属关系确定？", ["YS-OC-04", "YS-SR-02"]),
    ("rule", "自己占自己的病，世爻应爻如何区分？", ["YS-SR-03", "YS-SR-01"]),
    ("rule", "同一种用神出现两个爻，不能确定选哪一个。", ["YS-MC-04", "YS-MC-01"]),
    ("rule", "用神在本卦中没有出现，变出来的爻能当伏神吗？", ["YS-MS-05", "YS-MS-01"]),
    ("rule", "元神和忌神怎样按用神五行确定？", ["YS-SP-01", "YS-SP-02"]),
    ("rule", "行人在外，我问归期和我问平安有什么区别？", ["YS-TO-04"]),
    ("case", "哥哥犯了官司被定重罪，弟弟想问能不能救他。", ["final-case:005-1"]),
    ("case", "开一家金银首饰店做生意。", ["final-case:056-1"]),
    ("case", "我的孩子出门很久没有回来，想问生死。", ["final-case:024-1"]),
    ("case", "为父亲问是否可以服用人参。", ["final-case:202-1"]),
]


def main():
    root = Path(__file__).resolve().parents[2] / "data/liuyao_knowledge"
    out = root / "stage7-v2.2"
    prep = json.loads((out / "preparation_report.json").read_text())
    manifest = json.loads((out / "input_manifest.json").read_text())
    verify_manifest(root, manifest["source_import_manifest"])
    provider = get_embedding_provider()
    _, verification = verify_provider(provider, out / "probe_baseline.json")
    engine = create_engine("sqlite:///" + str(out / "knowledge.sqlite3"))
    report = {
        "release_id": prep["release_id"],
        "profile_id": prep["profile_id"],
        "test_scope": "engineering_smoke_only_not_independent_quality_benchmark",
        "query_set_origin": "agent_authored_from_reviewed_sources_no_teaching_import",
        "model_verification": verification,
    }
    with engine.connect() as conn:
        report["integrity"] = conn.execute(text("PRAGMA integrity_check")).scalar()
        report["foreign_key_errors"] = [
            list(r) for r in conn.execute(text("PRAGMA foreign_key_check"))
        ]
        report["source_quote_count"] = sum(
            len(quotes(conn, rid)) for rid in conn.execute(select(s.entity.c.revision_id)).scalars()
        )
        vectors = (
            conn.execute(select(s.embedding).where(s.embedding.c.profile_id == prep["profile_id"]))
            .mappings()
            .all()
        )
        for row in vectors:
            validate_embedding(row["vector"], 1024)
            if sha(canonical(row["vector"])) != row["vector_hash"]:
                raise ValueError("Vector hash mismatch")
        report["verified_vectors"] = len(vectors)
        report["job_counts"] = dict(
            conn.execute(
                select(s.job.c.status, func.count())
                .where(s.job.c.profile_id == prep["profile_id"])
                .group_by(s.job.c.status)
            ).all()
        )
        report["source_revision_ids"] = list(
            conn.execute(select(s.source.c.source_revision_id)).scalars()
        )
        report["entity_counts"] = dict(
            conn.execute(select(s.entity.c.kind, func.count()).group_by(s.entity.c.kind)).all()
        )
    results = []
    for lane, query, expected in SMOKE:
        pack = review_local(
            engine, query, prep["release_id"], method="zengshan-single-cast-v1", provider=provider
        )
        assert len([r for r in pack["review_candidates"] if r["kind"] == "rule"]) <= 8
        assert len([r for r in pack["review_candidates"] if r["kind"] == "case"]) <= 4
        hits = [r["entity_id"] for r in pack["review_candidates"] if r["kind"] == lane]
        vector_used = any("vector" in r["retrieval_channels"] for r in pack["review_candidates"])
        result = {
            "lane": lane,
            "query": query,
            "expected_any": expected,
            "retrieved_ids": hits,
            "expected_found": bool(set(expected) & set(hits)),
            "vector_channel_used": vector_used,
            "evidence": pack,
        }
        results.append(result)
        print(
            json.dumps({k: v for k, v in result.items() if k != "evidence"}, ensure_ascii=False),
            flush=True,
        )
    (out / "retrieval_smoke_results.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=2) + "\n"
    )
    report["smoke_queries"] = len(results)
    report["smoke_expected_found"] = sum(r["expected_found"] for r in results)
    report["smoke_vector_used"] = sum(r["vector_channel_used"] for r in results)
    # Missing model -> visible lexical fallback within identical frozen release.
    fallback = review_local(
        engine, "父母 文书", prep["release_id"], method="zengshan-single-cast-v1"
    )
    report["keyword_fallback_visible"] = any(
        t.get("semantic_unavailable") for t in fallback["retrieval_trace"]
    )
    isolated = review_local(
        engine, "父母", prep["release_id"], excluded_ids=report["source_revision_ids"]
    )
    report["all_sources_excluded_returns_zero"] = len(isolated["review_candidates"]) == 0
    prod = retrieve_production(
        engine,
        "父母 文书",
        prep["release_id"],
        method="zengshan-single-cast-v1",
        chart_id="audit-only",
        core_loader=lambda _: {"chart_hash": "audit-fixture", "facts": {}},
    )
    report["production_evidence_count"] = len(prod["supporting_evidence"])
    report["production_fixture_notice"] = (
        "Synthetic chart tests publication gate only, not live core."
    )
    report["old_database_unchanged"] = (
        hashlib.sha256((root / "stage6-v2/knowledge.sqlite3").read_bytes()).hexdigest()
        == manifest["source_database_sha256"]
    )
    cache = run_batches(
        engine, prep["profile_id"], provider, out / "cache_verification_batches.jsonl"
    )
    report["resume_cache_check"] = cache
    (out / "database_audit.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    )
    engine.dispose()
    print(
        json.dumps(
            {k: v for k, v in report.items() if k != "source_revision_ids"},
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
