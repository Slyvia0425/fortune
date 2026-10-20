import json
from pathlib import Path

import pytest
from sqlalchemy import create_engine, event, func, select

from app.services.embeddings import OpenAIEmbeddingProvider, validate_embedding
from app.services.knowledge_v2 import schema as s
from app.services.knowledge_v2.conditions import evaluate
from app.services.knowledge_v2.ingest import build_manifest, import_candidate, sha, verify_manifest
from app.services.knowledge_v2.releases import activate, revoke
from app.services.knowledge_v2.retrieval import bm25, quotes, retrieve_production, review_local

ROOT = Path(__file__).resolve().parents[2] / "data/liuyao_knowledge"


@pytest.fixture(scope="module")
def corpus(tmp_path_factory):
    engine = create_engine("sqlite:///" + str(tmp_path_factory.mktemp("knowledge") / "test.sqlite"))

    @event.listens_for(engine, "connect")
    def fk(dbapi, record):
        dbapi.execute("PRAGMA foreign_keys=ON")

    manifest = build_manifest(ROOT)
    profile = {"provider": "test", "model_name": "test-model", "dimension": 4}
    report = import_candidate(engine, ROOT, manifest, profile)
    yield engine, manifest, profile, report
    engine.dispose()


def test_real_import_all_quotes_and_accounting(corpus):
    engine, _, _, report = corpus
    assert report["accounting_closed"]
    assert report["imported_counts"] == {"passage": 3541, "rule": 36, "case": 216, "diverted": 50}
    assert not report["quarantined"]
    assert len(report["offset_repairs"]) == 17
    with engine.connect() as conn:
        for rid in conn.execute(select(s.entity.c.revision_id)).scalars():
            assert quotes(conn, rid)
        assert (
            conn.execute(
                select(func.count())
                .select_from(s.entity)
                .where(s.entity.c.production_eligible.is_(True))
            ).scalar()
            == 0
        )
        assert conn.execute(select(func.count()).select_from(s.embedding)).scalar() == 0


def test_idempotent(corpus):
    engine, manifest, profile, report = corpus
    again = import_candidate(engine, ROOT, manifest, profile)
    assert again["idempotent_reuse"]
    assert again["release_id"] == report["release_id"]


def test_forbidden_and_hash_modified_inputs(corpus):
    _, manifest, _, _ = corpus
    copy = json.loads(json.dumps(manifest))
    copy["files"][0]["path"] = "教学测评集/answers.jsonl"
    with pytest.raises(ValueError):
        verify_manifest(ROOT, copy)
    copy = json.loads(json.dumps(manifest))
    copy["files"][0]["sha256"] = "wrong"
    with pytest.raises(ValueError):
        verify_manifest(ROOT, copy)


def test_production_has_no_review_leak_and_ignores_client_facts(corpus):
    engine, _, _, report = corpus
    pack = retrieve_production(
        engine,
        "父母 文书",
        report["release_id"],
        method="zengshan-single-cast-v1",
        chart_id="test",
        core_loader=lambda _: {"chart_hash": "core-hash", "facts": {}},
    )
    assert pack["supporting_evidence"] == []
    assert pack["review_candidates"] == []
    assert pack["status"] == "evidence_insufficient"
    with pytest.raises(ValueError):
        retrieve_production(
            engine, "父母", report["release_id"], method="x", chart_id="x", core_loader=lambda _: {}
        )
    with pytest.raises(ValueError):
        activate(engine, report["release_id"])


def test_review_quotes_method_and_revocation(corpus):
    engine, _, _, report = corpus
    pack = review_local(engine, "父母 文书", report["release_id"], method="zengshan-single-cast-v1")
    assert pack["review_candidates"]
    assert all(
        r["not_for_interpretation"] and r["condition_evaluation"] == "unknown"
        for r in pack["review_candidates"]
    )
    assert not review_local(engine, "父母", report["release_id"], method="different")[
        "review_candidates"
    ]
    rid = pack["review_candidates"][0]["entity_revision_id"]
    revoke(engine, entity_revision_id=rid, reason="test")
    assert rid not in [
        r["entity_revision_id"]
        for r in review_local(engine, "父母 文书", report["release_id"])["review_candidates"]
    ]


def test_unknown_and_false_conditions():
    cond = {
        "all": [
            {"field": "core.count", "op": "eq", "value": 2},
            {"field": "core.motion", "op": "eq", "value": "both"},
        ]
    }
    assert evaluate(cond, {"core": {"count": 2}})["value"] == "unknown"
    assert evaluate(cond, {"core": {"count": 1}})["value"] == "false"
    assert evaluate(cond, {"core": {"count": 2, "motion": "both"}})["value"] == "true"
    assert evaluate({"not": {"field": "x", "op": "eq", "value": 1}}, {})["value"] == "unknown"
    assert evaluate({"eval": '__import__("os")'}, {})["value"] == "unknown"


@pytest.mark.parametrize(
    "vector", [[0, 0], [float("nan"), 1], [float("inf"), 1], [1], [True, 1], ["1", 2]]
)
def test_reject_invalid_vectors(vector):
    with pytest.raises(RuntimeError):
        validate_embedding(vector, 2)


@pytest.mark.parametrize("indices", [[0, 0], [0, 2], [0, None], [True, 1]])
def test_api_rejects_invalid_indices(monkeypatch, indices):
    import httpx

    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            return {"data": [{"index": i, "embedding": [1, 2]} for i in indices]}

    monkeypatch.setattr(httpx, "post", lambda *args, **kwargs: Response())
    provider = OpenAIEmbeddingProvider(
        base_url="https://invalid.test", api_key="test", model_name="test", dimension=2
    )
    with pytest.raises(RuntimeError):
        provider.embed_many(["a", "b"])


def test_bm25_reproducible():
    scores = bm25("父母 文书", ["父母 文书", "考试 功名", "父母 父母"])
    assert scores[0] > scores[2] > scores[1]


def test_job_retries_cache_and_hash_provider_rejected(tmp_path):
    import httpx

    from app.services.embeddings import HashEmbeddingProvider
    from app.services.knowledge_v2.jobs import run_jobs

    engine = create_engine("sqlite:///" + str(tmp_path / "jobs.sqlite"))
    s.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(
            s.entity.insert().values(
                revision_id="r",
                entity_id="e",
                kind="rule",
                text="原文",
                content_hash=sha("原文"),
                review_status="review",
                production_eligible=False,
                metadata_json={},
            )
        )
        conn.execute(
            s.view.insert().values(
                view_id="v",
                entity_revision_id="r",
                view_type="normalized",
                text="父母",
                text_hash=sha("父母"),
                normalizer_version="test",
                summary_review_status="review",
                embedding_allowed=True,
                transforms=[],
            )
        )
        conn.execute(
            s.profile.insert().values(
                profile_id="p",
                dimension=2,
                verified=True,
                config={"model_name": "test", "tokenizer": "test", "max_input_tokens": 10},
            )
        )
        conn.execute(
            s.job.insert().values(
                job_id="j",
                view_id="v",
                profile_id="p",
                input_hash=sha("父母"),
                status="pending",
                attempts=0,
            )
        )
    with pytest.raises(ValueError):
        run_jobs(engine, "p", HashEmbeddingProvider(2), len)

    class Provider:
        name = "test"
        dimension = 2
        calls = 0

        def embed(self, text):
            self.calls += 1
            if self.calls == 1:
                raise httpx.ReadTimeout("temporary")
            return [1, 2]

    p = Provider()
    assert run_jobs(engine, "p", p, len)["completed"] == 1
    assert p.calls == 2
    assert run_jobs(engine, "p", p, len)["cached"] == 1
    assert p.calls == 2
    engine.dispose()


def test_source_revocation_and_isolation_apply_before_ranking(corpus):
    engine, _, _, report = corpus
    with engine.connect() as conn:
        source_ids = list(conn.execute(select(s.source.c.source_revision_id)).scalars())
    assert not review_local(engine, "父母 文书", report["release_id"], excluded_ids=source_ids)[
        "review_candidates"
    ]


def test_legacy_production_does_not_call_model_and_api_denies_review():
    from fastapi import HTTPException

    from app.api.v1.endpoints.liuyao_retrieval import query
    from app.schemas.liuyao_retrieval import LiuyaoRetrievalRequest
    from app.services.liuyao_retrieval import retrieve

    class NoCalls:
        def embed(self, text):
            raise AssertionError("Must filter before embedding")

    pack = retrieve(
        {"release_status": "review_only", "knowledge_release_id": "r", "rule_set_id": "s"},
        {"question": "父母"},
        embedding_provider=NoCalls(),
    )
    assert not pack["supporting_evidence"]
    with pytest.raises(HTTPException) as exc:
        query(LiuyaoRetrievalRequest(question="父母", review_mode=True))
    assert exc.value.status_code == 403
