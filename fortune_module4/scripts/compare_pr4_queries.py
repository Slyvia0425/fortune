"""Read-only same-chart/same-SQLite comparison; JSON stdin/stdout, no live embeddings.

Run via the PR-4 Vitest integration test so V4 queries come from the real compiler.
This is a retrieval baseline, NOT a relevance/accuracy benchmark.
"""

import json
import sys
from pathlib import Path

from sqlalchemy import create_engine

from app.api.v1.endpoints.liuyao_hybrid import knowledge_snapshot, source_identity
from app.services.knowledge_v2.source_retrieval import retrieve_sources


def compare(payload):
    path = knowledge_snapshot() / "knowledge.sqlite3"
    engine = create_engine(f"sqlite:///file:{Path(path).as_posix()}?mode=ro&uri=true")
    identity = source_identity(engine)
    core = payload["core"]
    chart = {
        "chart_id": payload["chart_id"],
        "chart_hash": payload["chart_hash"],
        "core_version": core.get("core_version", "liuyao-core-v1"),
        "method_profile_id": "zengshan-single-cast-v1",
        "facts": core,
    }
    result = {"retrieval_identity": identity, "semantic_mode": "bm25_only"}
    try:
        for version in ("v1", "v4_1"):
            queries = payload[version]
            pack = retrieve_sources(
                engine,
                identity["knowledge_release_id"],
                chart,
                [q["query"] for q in queries],
                query_lanes=[q["lane"] for q in queries],
                query_requests=[
                    {k: q[k] for k in ("request_id", "parent_task_id", "round")} for q in queries
                ]
                if version == "v4_1"
                else None,
            )
            units = pack["reasoning_evidence"]
            result[version] = {
                "queries": queries,
                "chart_hash": pack["chart_hash"],
                "knowledge_release_id": pack["knowledge_release_id"],
                "evidence_count": len(units),
                "case_count": sum(u["kind"] == "case" for u in units),
                "evidence_ids": [u["entity_revision_id"] for u in units],
                "task_traces": [t for t in pack["retrieval_trace"] if "query_id" in t],
            }
        return result
    finally:
        engine.dispose()


if __name__ == "__main__":
    print(json.dumps(compare(json.load(sys.stdin)), ensure_ascii=False))
