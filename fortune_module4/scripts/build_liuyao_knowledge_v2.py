"""Build/reuse a local candidate database. Does not publish or overwrite stage4."""

import argparse
import json
from pathlib import Path
from urllib.parse import urlsplit

from sqlalchemy import create_engine, event

from app.core.config import get_settings
from app.services.knowledge_v2.ingest import build_manifest, canonical, import_candidate


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--root", type=Path, default=Path(__file__).resolve().parents[2] / "data/liuyao_knowledge"
    )
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    root = args.root.resolve()
    output = (args.output or root / "stage6-v2").resolve()
    if output == root or output in [
        (root / d).resolve()
        for d in ["stage2-v1", "stage3-v1", "stage4-v1", "stage5-final-review-v1"]
    ]:
        raise ValueError("Output must be separate from input snapshots")
    output.mkdir(parents=True, exist_ok=True)
    path = output / "import_manifest.json"
    if path.exists():
        manifest = json.loads(path.read_text())
    else:
        manifest = build_manifest(root)
        path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    settings = get_settings()
    endpoint = urlsplit(settings.openai_embedding_base_url or settings.llm_base_url or "")
    config = {
        "provider": settings.embedding_provider,
        "model_name": settings.openai_embedding_model,
        "model_revision": None,
        "dimension": settings.embedding_dim,
        "endpoint_identity": endpoint.hostname,
        "distance_metric": "cosine",
        "normalization": "provider_output_checked_not_modified",
        "query_template": "{text}",
        "document_template": "{text}",
        "tokenizer": None,
        "max_input_tokens": None,
        "verification_status": "pending_revision_tokenizer_input_limit_and_drift_probe",
    }
    engine = create_engine("sqlite:///" + str(output / "knowledge.sqlite3"))

    @event.listens_for(engine, "connect")
    def foreign_keys(connection, record):
        connection.execute("PRAGMA foreign_keys=ON")

    report = import_candidate(engine, root, manifest, config)
    engine.dispose()
    (output / "validation_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    )
    (output / "legacy_case_mapping.jsonl").write_bytes(
        (root / "stage5-final-review-v1/candidate_entity_mapping.jsonl").read_bytes()
    )
    chunks = [
        json.loads(line)
        for line in (root / "stage2-v1/chunks.jsonl").read_text().splitlines()
        if line
    ]
    (output / "legacy_chunk_mapping.jsonl").write_text(
        "".join(
            canonical(
                {
                    "old_chunk_id": c["chunk_id"],
                    "passage_ids": c["passage_ids"],
                    "source_revision_id": c["source_revision_id"],
                    "start": c["start"],
                    "end": c["end"],
                }
            )
            + "\n"
            for c in chunks
        )
    )
    print(
        json.dumps(
            {
                k: report[k]
                for k in (
                    "release_id",
                    "imported_counts",
                    "job_counts",
                    "entity_count",
                    "accounting_closed",
                    "status",
                )
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    print(
        "offset_repairs:", len(report["offset_repairs"]), "quarantined:", len(report["quarantined"])
    )


if __name__ == "__main__":
    main()
