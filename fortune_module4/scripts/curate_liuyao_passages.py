"""Reproducible derived snapshot, resumable embedding, then source-reading activation."""
import argparse
import json
import shutil
import sqlite3
from pathlib import Path
from sqlalchemy import create_engine, select
from app.services.embeddings import get_embedding_provider
from app.services.knowledge_v2 import schema as s
from app.services.knowledge_v2.ingest import canonical, sha
from app.services.knowledge_v2.passage_curation import prepare_segments, persist_annotations
from app.services.knowledge_v2.vectorize import PROBES, compare_probes, run_batches, verify_provider

ROOT = Path(__file__).resolve().parents[2]
OLD = ROOT / "data/liuyao_knowledge/stage9-text-reasoning-v2"
OUT = ROOT / "data/liuyao_knowledge/stage10-source-reading-v1"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--prepare-only", action="store_true")
    args = parser.parse_args()
    OUT.mkdir(exist_ok=True)
    old_hash = sha((OLD / "knowledge.sqlite3").read_bytes().hex())
    if not (OUT / "knowledge.sqlite3").exists():
        with sqlite3.connect(f"file:{OLD / 'knowledge.sqlite3'}?mode=ro", uri=True) as src, sqlite3.connect(OUT / "knowledge.sqlite3") as dst:
            src.backup(dst)
        shutil.copyfile(OLD / "probe_baseline.json", OUT / "probe_baseline.json")
    engine = create_engine("sqlite:///" + str(OUT / "knowledge.sqlite3"))
    if not (OUT / "preparation_report.json").exists():
        shutil.copyfile(OLD / "preparation_report.json", OUT / "preparation_report.json")
    report_path = OUT / "curation_report.json"
    if report_path.exists():
        report = json.loads(report_path.read_text())
    else:
        with engine.connect() as conn:
            parent = conn.execute(select(s.active.c.release_id).where(s.active.c.name == "text_reasoning")).scalar_one()
        report = prepare_segments(engine, parent)
        report["source_database_sha256_hex_encoded"] = old_hash
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    persist_annotations(engine, report)
    print(json.dumps({k: v for k, v in report.items() if k not in ("classified_spans", "segments")}, ensure_ascii=False), flush=True)
    if args.prepare_only:
        engine.dispose()
        return
    provider = get_embedding_provider()
    config, verification = verify_provider(provider, OUT / "probe_baseline.json")
    result = run_batches(engine, report["profile_id"], provider, OUT / "embedding_batches.jsonl", batch_size=5)
    baseline = json.loads((OUT / "probe_baseline.json").read_text())
    result["post_build_probe_distances"] = compare_probes(baseline["vectors"], provider.embed_many(PROBES))
    result["source_database_unchanged"] = sha((OLD / "knowledge.sqlite3").read_bytes().hex()) == old_hash
    (OUT / "embedding_report.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    if result["failed"] or result["blocked"] or not result["accounting_closed"] or not result["source_database_unchanged"]:
        raise RuntimeError("Embedding incomplete; source-reading snapshot not activated")
    with engine.begin() as conn:
        conn.execute(s.release.update().where(s.release.c.release_id == report["release_id"]).values(status="text_published"))
        old = conn.execute(select(s.active).where(s.active.c.name == "source_reading")).first()
        if old is None:
            conn.execute(s.active.insert().values(name="source_reading", release_id=report["release_id"]))
    readiness = {"release_id": report["release_id"], "source_vectors": report["source_vector_jobs"],
                 "case_vectors": report["case_vectors_reused"], "verification": verification, "embedding": result}
    (OUT / "retrieval_ready.json").write_text(json.dumps(readiness, ensure_ascii=False, indent=2) + "\n")
    engine.dispose()
    print(json.dumps(readiness, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
