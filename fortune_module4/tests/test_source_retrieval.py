import json
import shutil
from pathlib import Path

import pytest
from sqlalchemy import create_engine, insert, select

from app.services.knowledge_v2 import schema as s
from app.services.knowledge_v2.runtime import freeze
from app.services.knowledge_v2.source_retrieval import retrieve_sources

DATA = Path(__file__).resolve().parents[2] / "data/liuyao_knowledge/stage9-text-reasoning-v2"


def test_sources_cases_no_use_rules_and_revocation(tmp_path):
    path = tmp_path / "knowledge.sqlite3"
    shutil.copyfile(DATA / "knowledge.sqlite3", path)
    engine = create_engine("sqlite:///" + str(path))
    release = json.loads((DATA / "preparation_report.json").read_text())["release_id"]
    chart = freeze([1, 1, 1], "我问父亲疾病能否康复")
    queries = ["父母 疾病 病 康复", "父母 旬空 月破 生克"]
    pack = retrieve_sources(engine, release, chart, queries)
    units = pack["reasoning_evidence"]
    assert {u["kind"] for u in units} == {"case", "passage"}
    assert sum(u["kind"] == "case" for u in units) <= 4
    assert sum(u["kind"] == "passage" for u in units) <= 8
    assert all(u["review_status"] != "quarantined" for u in units)
    assert pack["chart_hash"] == chart["chart_hash"]
    case_only = retrieve_sources(engine, release, chart, queries, query_lanes=["case", "case"])
    assert case_only["reasoning_evidence"]
    assert all(u["kind"] == "case" for u in case_only["reasoning_evidence"])
    assert all(t.get("lane") == "case" for t in case_only["retrieval_trace"] if "lane" in t)
    with pytest.raises(ValueError, match="query lanes"):
        retrieve_sources(engine, release, chart, queries, query_lanes=["case"])
    with engine.connect() as conn:
        rel = (
            conn.execute(select(s.release).where(s.release.c.release_id == release))
            .mappings()
            .one()
        )
        profile = (
            conn.execute(select(s.profile).where(s.profile.c.profile_id == rel["profile_id"]))
            .mappings()
            .one()
        )

    class BatchProvider:
        name = profile["config"]["model_name"]
        dimension = profile["dimension"]
        calls = []

        def embed_many(self, texts):
            self.calls.append(texts)
            return [[1.0] + [0.0] * (self.dimension - 1) for _ in texts]

        def embed(self, text):
            raise AssertionError("Batch cache must avoid serial requests")

    provider = BatchProvider()
    batched = retrieve_sources(engine, release, chart, queries, provider=provider)
    assert provider.calls == [queries]
    assert any(t.get("vector_top") for t in batched["retrieval_trace"])
    assert not pack["interpretation_contract"]["strong_conclusion_allowed"]
    assert all(u["source_quotes"] for u in units)
    for i, left in enumerate(units):
        for right in units[i + 1 :]:
            assert not any(
                a["source_revision_id"] == b["source_revision_id"]
                and max(a["start"], b["start"]) < min(a["end"], b["end"])
                for a in left["source_quotes"]
                for b in right["source_quotes"]
            )
    rid = units[0]["entity_revision_id"]
    with engine.begin() as conn:
        conn.execute(
            insert(s.revocation).values(
                revocation_id="test", entity_revision_id=rid, reason="test", revoked_at="2026-10-13"
            )
        )
    again = retrieve_sources(engine, release, chart, queries)
    assert rid not in {u["entity_revision_id"] for u in again["reasoning_evidence"]}
    engine.dispose()


def test_round_endpoint_identity_owner_task_trace_and_zero_case(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.api.deps import get_hybrid_user_id
    from app.api.v1.endpoints import liuyao_hybrid as api
    from app.services.knowledge_v2.confirmation_auth import require_dialogue_server
    from app.services.knowledge_v2.runtime import RuntimeStore

    path = tmp_path / "knowledge.sqlite3"
    shutil.copyfile(DATA / "knowledge.sqlite3", path)
    engine = create_engine("sqlite:///" + str(path))
    store = RuntimeStore(tmp_path / "runtime.sqlite3")
    chart = store.freeze_once("owner", "request", [1, 1, 1], "问父亲疾病")
    monkeypatch.setattr(api, "dependencies", lambda: (engine, store))
    monkeypatch.setattr(api, "verified_provider", lambda: None)
    app = FastAPI()
    app.include_router(api.router)
    app.dependency_overrides[get_hybrid_user_id] = lambda: "owner"
    with TestClient(app) as client:
        identity = client.post(
            "/liuyao/hybrid/source-profile", json={"chart_id": chart["chart_id"]}
        ).json()["result"]
        body = {
            "chart_id": chart["chart_id"],
            "chart_hash": chart["chart_hash"],
            "queries": ["月破 月建", "QXYZNOTFOUND"],
            "query_lanes": ["theory", "theory"],
            "query_requests": [
                {"request_id": f"r1_{i}", "parent_task_id": f"task_{i}", "round": 1} for i in (1, 2)
            ],
            "retrieval_identity": identity,
        }
        assert client.post("/liuyao/hybrid/source-evidence-round", json=body).status_code == 403
        app.dependency_overrides[require_dialogue_server] = lambda: None
        response = client.post("/liuyao/hybrid/source-evidence-round", json=body)
        assert response.status_code == 200
        pack = response.json()["result"]["hybrid_evidence"]
        assert pack["retrieval_identity"] == identity
        assert pack["reasoning_evidence"]
        assert all(
            u["kind"] == "passage" and u["condition_evaluation"] == "unknown"
            for u in pack["reasoning_evidence"]
        )
        traces = [t for t in pack["retrieval_trace"] if "request_id" in t]
        assert len(traces) == 2
        assert traces[0]["parent_task_id"] == "task_1" and traces[0]["round"] == 1
        assert traces[1]["candidate_status"] == "no_results"
        assert traces[1]["selected_evidence_ids"] == []
        assert pack["retrieval_run_id"]
        round2 = body | {
            "query_requests": [
                r | {"round": 2, "request_id": f"r2_{i}"}
                for i, r in enumerate(body["query_requests"])
            ]
        }
        second = client.post("/liuyao/hybrid/source-evidence-round", json=round2)
        assert second.status_code == 200
        assert all(
            t["round"] == 2
            for t in second.json()["result"]["hybrid_evidence"]["retrieval_trace"]
            if "request_id" in t
        )
        four = round2 | {
            "queries": ["月破"] * 4,
            "query_lanes": ["theory"] * 4,
            "query_requests": [
                {"request_id": f"r2_{i}", "parent_task_id": "task_1", "round": 2} for i in range(4)
            ],
        }
        assert client.post("/liuyao/hybrid/source-evidence-round", json=four).status_code == 422
        mixed = body | {"query_requests": [body["query_requests"][0], round2["query_requests"][1]]}
        assert client.post("/liuyao/hybrid/source-evidence-round", json=mixed).status_code == 422
        assert (
            client.post(
                "/liuyao/hybrid/source-evidence-round", json=body | {"retrieval_identity": {}}
            ).status_code
            == 409
        )
        assert (
            client.post(
                "/liuyao/hybrid/source-evidence-round", json=body | {"query_requests": []}
            ).status_code
            == 422
        )
        assert (
            client.post(
                "/liuyao/hybrid/source-evidence-round", json=body | {"queries": body["queries"] * 3}
            ).status_code
            == 422
        )
        with engine.begin() as conn:
            conn.execute(
                insert(s.revocation).values(
                    revocation_id="new",
                    entity_revision_id="test",
                    reason="test",
                    revoked_at="2026-10-15",
                )
            )
        assert client.post("/liuyao/hybrid/source-evidence-round", json=body).status_code == 409
        app.dependency_overrides[get_hybrid_user_id] = lambda: "other"
        assert (
            client.post(
                "/liuyao/hybrid/source-profile", json={"chart_id": chart["chart_id"]}
            ).status_code
            == 404
        )
        assert client.post("/liuyao/hybrid/source-evidence-round", json=body).status_code == 404
    engine.dispose()


def test_frozen_and_source_endpoints_preserve_owner_and_hash(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.api.deps import get_hybrid_user_id
    from app.api.v1.endpoints import liuyao_hybrid as api
    from app.services.knowledge_v2.runtime import RuntimeStore

    path = tmp_path / "knowledge.sqlite3"
    shutil.copyfile(DATA / "knowledge.sqlite3", path)
    engine = create_engine("sqlite:///" + str(path))
    store = RuntimeStore(tmp_path / "runtime.sqlite3")
    chart = store.freeze_once("owner", "request", [1, 1, 1], "问父亲疾病")
    monkeypatch.setattr(api, "dependencies", lambda: (engine, store))
    monkeypatch.setattr(api, "verified_provider", lambda: None)
    app = FastAPI()
    app.include_router(api.router)
    app.dependency_overrides[get_hybrid_user_id] = lambda: "owner"
    body = {
        "chart_id": chart["chart_id"],
        "chart_hash": chart["chart_hash"],
        "queries": ["父母 疾病"],
    }
    with TestClient(app) as client:
        assert (
            client.post("/liuyao/hybrid/frozen", json={"chart_id": chart["chart_id"]}).json()[
                "result"
            ]["question"]
            == "问父亲疾病"
        )
        result = client.post("/liuyao/hybrid/source-evidence", json=body)
        assert result.status_code == 200
        assert result.json()["result"]["hybrid_evidence"]["chart_hash"] == chart["chart_hash"]
        assert (
            client.post(
                "/liuyao/hybrid/source-evidence", json=body | {"chart_hash": "wrong"}
            ).status_code
            == 409
        )
        assert (
            client.post("/liuyao/hybrid/source-evidence", json=body | {"facts": {}}).status_code
            == 422
        )
        assert (
            client.post(
                "/liuyao/hybrid/source-evidence", json=body | {"query_lanes": []}
            ).status_code
            == 422
        )
        assert (
            client.post(
                "/liuyao/hybrid/source-evidence", json=body | {"query_lanes": ["invalid"]}
            ).status_code
            == 422
        )
        app.dependency_overrides[get_hybrid_user_id] = lambda: "other"
        assert (
            client.post("/liuyao/hybrid/frozen", json={"chart_id": chart["chart_id"]}).status_code
            == 404
        )
        assert client.post("/liuyao/hybrid/source-evidence", json=body).status_code == 404
    engine.dispose()
