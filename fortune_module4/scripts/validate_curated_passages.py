"""Audit all offsets/types/links and verify source+case recall, optionally live semantic queries."""
import argparse
import json
import httpx
from collections import Counter, defaultdict
from pathlib import Path
from sqlalchemy import create_engine, select
from app.services.embeddings import get_embedding_provider, validate_embedding
from app.services.knowledge_v2 import schema as s
from app.services.knowledge_v2.ingest import canonical, sha
from app.services.knowledge_v2.retrieval import quotes
from app.services.knowledge_v2.runtime import freeze
from app.services.knowledge_v2.source_retrieval import retrieve_sources
from app.services.knowledge_v2.vectorize import verify_provider

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data/liuyao_knowledge/stage10-source-reading-v1"
QUESTIONS = [
    ("父亲的病能否康复", ["父母 疾病 康复", "父母 旬空 月破 生克"]),
    ("我能否找到工作", ["官鬼 功名 求官 职位", "官鬼 发动 世爻 生合"]),
    ("我和女朋友能否结婚", ["妻财 婚姻 女方", "妻财 世爻 应爻 生合"]),
    ("求财能否成功", ["妻财 求财 财利", "妻财 旬空 月破 生克"]),
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--snapshot", default="stage10-source-reading-v1", choices=["stage10-source-reading-v1", "stage11-context-review-v1"])
    args = parser.parse_args()
    data = ROOT / "data/liuyao_knowledge" / args.snapshot
    engine = create_engine("sqlite:///" + str(data / "knowledge.sqlite3"))
    report = json.loads((data / ("context_review_report.json" if args.snapshot=="stage11-context-review-v1" else "curation_report.json")).read_text())
    with engine.connect() as conn:
        sources = {r["source_revision_id"]: r for r in conn.execute(select(s.source)).mappings()}
        entities = {r["revision_id"]: r for r in conn.execute(select(s.entity)).mappings()}
        annotations = list(conn.execute(select(s.passage_annotation)).mappings())
        grouped = defaultdict(list)
        for row in annotations:
            assert row["text_hash"] == sha(sources[row["source_revision_id"]]["raw_text"][row["start"]:row["end"]])
            grouped[row["parent_revision_id"]].append(row)
            for rid in row["case_revision_ids"]:
                assert entities[rid]["kind"] == "case"
                assert any(q["source_revision_id"] == row["source_revision_id"] and q["start"] < row["end"] and q["end"] > row["start"] for q in quotes(conn, rid))
        for rid, parts in grouped.items():
            assert "".join("".join(sources[r["source_revision_id"]]["raw_text"][r["start"]:r["end"]].split()) for r in sorted(parts, key=lambda r:r["start"])) == "".join(entities[rid]["text"].split())
        curated = [r for r in entities.values() if r["metadata_json"].get("curation_version")]
        for row in curated:
            q = quotes(conn, row["revision_id"])
            assert len(q) == 1 and q[0]["quote"] == row["text"]
            assert row["metadata_json"]["content_type"] in ("theory", "author_commentary")
            assert not row["production_eligible"]
        items = list(conn.execute(select(s.release_item).where(s.release_item.c.release_id == report["release_id"])).mappings())
        vectors = {r["view_id"]: r for r in conn.execute(select(s.embedding).where(s.embedding.c.profile_id == report["profile_id"])).mappings()}
        views = {r["view_id"]:r for r in conn.execute(select(s.view)).mappings()}
        for item in items:
            view = views[item["view_id"]]
            assert sha(view["text"]) == view["text_hash"]
            if item["view_id"] in vectors:
                saved = vectors[item["view_id"]]
                vector = validate_embedding(saved["vector"], 1024)
                assert sha(canonical(vector)) == saved["vector_hash"]
        complete = all(item["view_id"] in vectors for item in items)
        integrity = conn.exec_driver_sql("PRAGMA integrity_check").scalar_one()
        assert integrity == "ok"
        assert not list(conn.exec_driver_sql("PRAGMA foreign_key_check"))
    provider = None
    if args.live:
        assert complete, "Embedding jobs incomplete"
        provider = get_embedding_provider()
        for attempt in range(3):
            try:
                verify_provider(provider, data / "probe_baseline.json")
                break
            except httpx.TransportError:
                if attempt == 2:
                    raise
    smoke = []
    if complete:
        for question, queries in QUESTIONS:
            pack = retrieve_sources(engine, report["release_id"], freeze([1,1,1], question), queries, provider=provider)
            units = pack["reasoning_evidence"]
            assert any(u["kind"] == "case" for u in units), f"No cases for {question}: {[u['content_type'] for u in units]}"
            assert any(u["kind"] == "passage" and u["content_type"] == "theory" for u in units)
            assert not any(u["kind"] == "rule" for u in units)
            if args.live:
                assert sum(t.get("vector_hits", 0) for t in pack["retrieval_trace"]) > 0, f"Semantic lane unavailable: {question}"
            smoke.append({"question": question, "counts": dict(Counter(u["content_type"] if u["kind"] == "passage" else "case" for u in units)),
                          "evidence_ids": [u["entity_revision_id"] for u in units],
                          "vector_hits": sum(t.get("vector_hits",0) for t in pack["retrieval_trace"]), "gaps": pack["gaps"]})
    result = {"source_integrity": integrity, "parent_passages_covered": len(grouped), "annotated_spans": len(annotations),
              "typed_segments": len(curated), "classification": dict(Counter(r["content_type"] for r in annotations)),
              "release_items": len(items), "embedding_complete": complete, "live_semantic": args.live,
              "smoke": smoke, "classification_review": "agent_context_review_with_prior_structural_annotations" if args.snapshot=="stage11-context-review-v1" else "automated_structural_not_expert_content_review"}
    (data / ("live_retrieval_validation.json" if args.live else "validation_report.json")).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    engine.dispose()


if __name__ == "__main__":
    main()
