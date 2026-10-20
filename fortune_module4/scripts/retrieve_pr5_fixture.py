"""Read-only two-round fixture adapter for the real TS accumulator integration test."""

import json
import sys

from sqlalchemy import create_engine

from app.api.v1.endpoints.liuyao_hybrid import knowledge_snapshot, source_identity
from app.services.knowledge_v2.source_retrieval import retrieve_sources


def retrieve(payload):
    path = knowledge_snapshot() / "knowledge.sqlite3"
    engine = create_engine(f"sqlite:///file:{path.as_posix()}?mode=ro&uri=true")
    try:
        identity = source_identity(engine)
        chart = {
            "chart_id": payload["chart_id"],
            "chart_hash": payload["chart_hash"],
            "core_version": payload["core"]["core_version"],
            "method_profile_id": "zengshan-single-cast-v1",
            "facts": payload["core"],
        }
        packs = []
        for queries in payload["rounds"]:
            pack = retrieve_sources(
                engine,
                identity["knowledge_release_id"],
                chart,
                [q["query"] for q in queries],
                query_lanes=[q["lane"] for q in queries],
                query_requests=[
                    {k: q[k] for k in ("request_id", "parent_task_id", "round")} for q in queries
                ],
            )
            packs.append(pack | {"retrieval_identity": identity})
        return {"identity": identity, "packs": packs}
    finally:
        engine.dispose()


if __name__ == "__main__":
    print(json.dumps(retrieve(json.load(sys.stdin)), ensure_ascii=False))
