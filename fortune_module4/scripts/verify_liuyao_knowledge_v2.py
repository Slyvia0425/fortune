"""Audit the built database independently of the import-time report."""

import json
from pathlib import Path

from sqlalchemy import create_engine, func, select, text

from app.services.knowledge_v2 import schema as s
from app.services.knowledge_v2.ingest import verify_manifest
from app.services.knowledge_v2.retrieval import quotes, retrieve_production, review_local

root = Path(__file__).resolve().parents[2] / "data/liuyao_knowledge"
out = root / "stage6-v2"
verify_manifest(root, json.loads((out / "import_manifest.json").read_text()))
engine = create_engine("sqlite:///" + str(out / "knowledge.sqlite3"))
with engine.connect() as conn:
    releases = conn.execute(select(s.release)).mappings().all()
    rid = releases[0]["release_id"]
    count = 0
    for revision in conn.execute(select(s.entity.c.revision_id)).scalars():
        count += len(quotes(conn, revision))
    result = {
        "database_integrity": conn.execute(text("PRAGMA integrity_check")).scalar(),
        "foreign_key_errors": [list(row) for row in conn.execute(text("PRAGMA foreign_key_check"))],
        "verified_lineage_count": count,
        "entity_count": conn.execute(select(func.count()).select_from(s.entity)).scalar(),
        "embedding_count": conn.execute(select(func.count()).select_from(s.embedding)).scalar(),
        "active_release_count": conn.execute(select(func.count()).select_from(s.active)).scalar(),
        "input_and_stage4_hashes_unchanged": True,
    }
pack = review_local(engine, "父母 文书 两现", rid, method="zengshan-single-cast-v1")
result["review_rule_evidence_count"] = len(pack["review_candidates"])
production = retrieve_production(
    engine,
    "父母 文书",
    rid,
    method="zengshan-single-cast-v1",
    chart_id="audit-fixture",
    core_loader=lambda _: {"chart_hash": "audit-fixture-only", "facts": {}},
)
result["production_evidence_count"] = len(production["supporting_evidence"])
result["production_status"] = production["status"]
result["fixture_notice"] = (
    "Production gate check uses a synthetic audit chart, not a live core chart."
)
(out / "database_audit.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
(out / "review_example.json").write_text(json.dumps(pack, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(result, ensure_ascii=False, indent=2))
engine.dispose()
