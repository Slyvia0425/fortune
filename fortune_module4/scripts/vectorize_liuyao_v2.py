"""Prepare and embed a new snapshot; never publishes or modifies stage6."""

import argparse
import hashlib
import json
import sqlite3
from pathlib import Path

from sqlalchemy import create_engine, event, select

from app.services.embeddings import get_embedding_provider
from app.services.knowledge_v2 import schema as s
from app.services.knowledge_v2.ingest import canonical, sha, verify_manifest
from app.services.knowledge_v2.vectorize import (
    PROBES,
    compare_probes,
    prepare_release,
    run_batches,
    verify_provider,
)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--prepare-only", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2] / "data/liuyao_knowledge"
    old, out = root / "stage6-v2", root / "stage7-v2.2"
    out.mkdir(exist_ok=True)
    manifest = json.loads((old / "import_manifest.json").read_text())
    verify_manifest(root, manifest)
    if not (out / "knowledge.sqlite3").exists():
        with (
            sqlite3.connect(f"file:{old / 'knowledge.sqlite3'}?mode=ro", uri=True) as src,
            sqlite3.connect(out / "knowledge.sqlite3") as dst,
        ):
            src.backup(dst)
    old_hash = hashlib.sha256((old / "knowledge.sqlite3").read_bytes()).hexdigest()
    (out / "input_manifest.json").write_text(
        json.dumps(
            {
                "source_import_manifest": manifest,
                "source_database_sha256": old_hash,
                "source_database": str(old / "knowledge.sqlite3"),
                "derived_view_policy": "rules_and_pre_cast_questions_only",
                "teaching_imported": False,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n"
    )
    provider = get_embedding_provider()
    config, verification = verify_provider(provider, out / "probe_baseline.json")
    (out / "embedding_profile.json").write_text(
        json.dumps(config, ensure_ascii=False, indent=2) + "\n"
    )
    (out / "model_verification.json").write_text(
        json.dumps(verification, ensure_ascii=False, indent=2) + "\n"
    )
    engine = create_engine("sqlite:///" + str(out / "knowledge.sqlite3"))

    @event.listens_for(engine, "connect")
    def fk(connection, record):
        connection.execute("PRAGMA foreign_keys=ON")

    parent = json.loads((old / "validation_report.json").read_text())["release_id"]
    report = prepare_release(engine, parent, config, sha(canonical(manifest)))
    (out / "preparation_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    )
    print(
        json.dumps(
            {
                k: report[k]
                for k in ["release_id", "rule_count", "case_count", "embedding_job_count"]
            },
            ensure_ascii=False,
        ),
        flush=True,
    )
    print("excluded_cases", len(report["excluded_cases"]), flush=True)
    if args.prepare_only:
        engine.dispose()
        return
    result = run_batches(engine, report["profile_id"], provider, out / "embedding_batches.jsonl")
    baseline = json.loads((out / "probe_baseline.json").read_text())
    distances = compare_probes(baseline["vectors"], provider.embed_many(PROBES))
    result["post_build_probe_distances"] = distances
    result["old_database_unchanged"] = (
        hashlib.sha256((old / "knowledge.sqlite3").read_bytes()).hexdigest() == old_hash
    )
    if result["failed"] == 0 and result["blocked"] == 0 and result["accounting_closed"]:
        with engine.begin() as conn:
            rel = (
                conn.execute(
                    select(s.release).where(s.release.c.release_id == report["release_id"])
                )
                .mappings()
                .one()
            )
            conn.execute(
                s.release.update()
                .where(s.release.c.release_id == report["release_id"])
                .values(
                    status="embedded", validation={**rel["validation"], "embedding_result": result}
                )
            )
    (out / "embedding_report.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    )
    engine.dispose()
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
