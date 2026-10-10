"""Behavioral acceptance for plan §24, plus isolation and request replay."""

import json

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine

from app.services.knowledge_v2 import schema as s
from app.services.knowledge_v2.candidates import comparable, match_role, rule_condition
from app.services.knowledge_v2.hybrid import best_ranks, run_production, run_review_local, score
from app.services.knowledge_v2.ingest import sha
from app.services.knowledge_v2.query_plan import plan
from app.services.knowledge_v2.runtime import RuntimeStore, freeze

QUESTION = "我替妹妹问，她这次考试能不能过"
METHOD = "zengshan-single-cast-v1"
TRUE = {"field": "question.topic", "op": "eq", "value": "考试"}


def chart(kin=None):
    roles = kin or ["parents", "parents", "siblings", "offspring", "wealth", "officials"]
    return {
        "chart_id": "chart",
        "chart_hash": "trusted-test-hash",
        "original_question": QUESTION,
        "core_version": "test-core",
        "method_profile_id": METHOD,
        "method_profile_version": "1",
        "facts": {
            "main_lines_complete": True,
            "main_lines": [
                {"ref": f"main:{i}", "position": i, "kin": role, "moving": i == 1}
                for i, role in enumerate(roles, 1)
            ],
            "hidden_lines_complete": True,
            "hidden_lines": [],
            "transformed_lines_complete": True,
            "transformed_lines": [],
        },
    }


@pytest.fixture
def db(tmp_path):
    engine = create_engine("sqlite:///" + str(tmp_path / "corpus.sqlite"))
    s.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(
            s.profile.insert().values(
                profile_id="p", config={"model_name": "test"}, verified=True, dimension=2
            )
        )
        conn.execute(
            s.release.insert().values(
                release_id="release",
                status="published",
                manifest_hash="fixture",
                profile_id="p",
                created_at="test",
                validation={},
            )
        )
    yield engine
    engine.dispose()


def add(
    engine,
    rid,
    text="妹妹 考试 父母 多现 不现 伏神",
    *,
    kind="rule",
    condition=TRUE,
    action=None,
    rule_type="subject_relation",
    metadata=None,
    conflicts=None,
    exceptions=None,
):
    with engine.begin() as conn:
        conn.execute(
            s.source.insert().values(
                source_revision_id=rid,
                source_id=rid,
                book="test",
                raw_text=text,
                raw_sha256=sha(text),
                offset_unit="unicode_codepoint",
                review_status="approved",
            )
        )
        conn.execute(
            s.entity.insert().values(
                revision_id=rid,
                entity_id=rid,
                kind=kind,
                text=text,
                content_hash=sha(text),
                review_status="approved",
                production_eligible=True,
                metadata_json=({"method_profile_id": METHOD} | (metadata or {}))
                if kind == "case"
                else (metadata or {}),
            )
        )
        conn.execute(
            s.lineage.insert().values(
                lineage_id=rid,
                entity_revision_id=rid,
                source_revision_id=rid,
                start=0,
                end=len(text),
                quote_hash=sha(text),
                relation="source",
            )
        )
        conn.execute(
            s.view.insert().values(
                view_id=rid,
                entity_revision_id=rid,
                view_type="fixture",
                text=text,
                text_hash=sha(text),
                normalizer_version="test",
                summary_review_status="approved",
                embedding_allowed=True,
                transforms=[],
            )
        )
        conn.execute(
            s.release_item.insert().values(
                release_id="release", entity_revision_id=rid, view_id=rid
            )
        )
        if kind == "rule":
            conn.execute(
                s.rule.insert().values(
                    entity_revision_id=rid,
                    rule_type=rule_type,
                    method_profile_id=METHOD,
                    conditions_ast=condition,
                    action_ast=action or {"op": "propose_role", "role": "parents"},
                    exceptions_ast=exceptions,
                    conflict_group_ids=conflicts or [],
                    executable=True,
                )
            )


def run(engine, core=None, **kw):
    core = core or chart()
    return run_production(
        engine, "release", QUESTION, chart_id="chart", core_loader=lambda _: core, **kw
    )


def test_question_grounding_and_historical_alias():
    p = plan(QUESTION)
    ctx = p["question_context"]
    assert ctx["subject_relation"] == "妹妹" and ctx["topic"] == "考试"
    assert ctx["goal"] == "是否通过" and ctx["exam_type"] is None
    assert ctx["time_scope"] == {"raw": "这次", "normalized": None}
    assert len(p["queries"]) == 3
    for evidence in ctx["field_evidence"].values():
        assert QUESTION[evidence["start"] : evidence["end"]] == evidence["quote"]
    assert "科举" not in json.dumps(ctx, ensure_ascii=False)
    assert any(
        x.get("historical_search_alias") == "科举" for q in p["queries"] for x in q["provenance"]
    )
    assert all("parents" not in q["text"] and "官鬼" not in q["text"] for q in p["queries"])


def test_rewrites_and_multiple_views_do_not_vote_twice():
    one = best_ranks([("keyword", ["a", "a", "b"]), ("vector", ["b", "a"])])
    many = best_ranks([("keyword", ["a", "a", "b"])] * 8 + [("vector", ["b", "a"])] * 8)
    assert one == many and one["b"]["keyword"] == 2
    assert score(one["a"]) == score(many["a"])


def test_multiple_branch_keeps_conditional_selection(db):
    add(db, "role")
    add(
        db,
        "multi",
        rule_type="multiple_candidates",
        condition={"field": "core.motion_branch", "op": "eq", "value": "one_moving"},
        action={
            "op": "select_line",
            "role": "parents",
            "scope": "main",
            "where": {"field": "line.moving", "op": "eq", "value": True},
        },
    )
    p = run(db)
    assert any(q["purpose"] == "multiple_candidates" for q in p["query_plan"]["queries"])
    assert p["candidate_roles"][0]["main_hexagram_line_refs"] == ["main:1", "main:2"]
    assert not p["selected_use"] and "UNRESOLVED_CONDITION" in p["gaps"]
    c = chart()
    c["facts"]["motion_branch"] = "one_moving"
    p = run(db, c)
    assert p["selected_use"][0]["line_ref"] == "main:1"
    assert p["status"] == "evidence_ready" and not p["case_support_available"]


def test_absent_hidden_unknown_and_transformed_are_separate(db):
    add(db, "role")
    add(
        db,
        "hidden",
        rule_type="missing_candidate",
        condition={"field": "core.hidden_usable", "op": "eq", "value": True},
        action={
            "op": "select_line",
            "role": "parents",
            "scope": "hidden",
            "where": {"field": "line.ref", "op": "exists"},
        },
    )
    c = chart(["siblings"] * 6)
    c["facts"]["hidden_lines"] = [{"ref": "hidden:2", "kin": "parents"}]
    c["facts"]["transformed_lines"] = [{"ref": "transformed:1", "kin": "parents"}]
    p = run(db, c)
    role = p["candidate_roles"][0]
    assert role["presence_status"] == "known_absent"
    assert role["main_hexagram_line_refs"] == []
    assert role["hidden_line_refs"] == ["hidden:2"]
    assert role["transformed_line_refs"] == ["transformed:1"]
    assert role["selected_line_ref"] is None
    assert any(q["purpose"] == "missing_candidate" for q in p["query_plan"]["queries"])


def test_incomplete_is_unknown_and_does_not_trigger_absence(db):
    add(db, "role")
    c = chart(["siblings"] * 6)
    del c["facts"]["main_lines"][0]["kin"]
    p = run(db, c)
    assert p["candidate_roles"][0]["presence_status"] == "unknown"
    assert "CHART_FACTS_INCOMPLETE" in p["gaps"]
    assert all(q["purpose"] != "missing_candidate" for q in p["query_plan"]["queries"])
    assert p["clarification"] == []


def test_position_role_does_not_use_kin_absence():
    role = match_role("self", chart()["facts"])
    assert role["presence_status"] == "unknown" and role["missing_facts"] == ["core.position_roles"]


def test_review_never_proposes_roles_and_no_production_fallback(db):
    add(db, "role")
    with db.begin() as conn:
        conn.execute(s.release.update().values(status="embedded"))

    class Forbidden:
        def embed(self, _):
            raise AssertionError("must filter first")

    p = run(db, provider=Forbidden())
    assert not p["supporting_evidence"] and not p["review_candidates"]
    review = run_review_local(db, "release", QUESTION, chart())
    assert review["review_candidates"] and not review["candidate_roles"]
    assert all(u["not_for_interpretation"] for u in review["review_candidates"])


def test_case_relation_and_goal_mismatch_not_direct_analogy(db):
    metadata = {
        "question_context_review_status": "approved",
        "question_context": {"topic": "考试", "subject_relation": "本人", "goal": "何时"},
    }
    result = comparable(metadata, plan(QUESTION)["question_context"])
    assert result["value"] == "false" and not result["direct_analogy"]
    add(db, "case", kind="case", metadata=metadata)
    p = run(db)
    assert not p["case_support_available"]
    assert p["counter_evidence"][0]["condition_evaluation"] == "false"


def test_recast_text_never_changes_frozen_chart(db, tmp_path):
    add(db, "role", text="妹妹考试 父母 原文观点：再占")
    calls = []

    def cast(numbers, question):
        calls.append(1)
        return freeze(numbers, question)

    store = RuntimeStore(tmp_path / "runtime.sqlite")
    c = store.freeze_once("u", "id", [1, 2, 3], QUESTION, cast)
    again = store.freeze_once("u", "id", [1, 2, 3], QUESTION, cast)
    assert c == again and len(calls) == 1
    with pytest.raises(ValueError):
        store.freeze_once("u", "id", [1, 2, 4], QUESTION, cast)
    with pytest.raises(ValueError):
        store.load("other", c["chart_id"])
    p = run_production(
        db,
        "release",
        QUESTION,
        chart_id=c["chart_id"],
        core_loader=lambda cid: store.load("u", cid),
    )
    assert not p["interpretation_contract"]["recast_allowed"]
    assert p["chart_hash"] == c["chart_hash"]
    store.save("u", p)
    with store.connect() as conn:
        saved = json.loads(conn.execute("SELECT pack_json FROM retrieval_run").fetchone()[0])
    assert saved["query_plan"] == p["query_plan"]


def test_conflict_exceptions_and_isolation_every_round(db):
    add(db, "a", conflicts=["choice"])
    add(db, "b", conflicts=["choice"], action={"op": "propose_role", "role": "wealth"})
    p = run(db)
    assert "METHOD_CONFLICT" in p["gaps"] and not p["selected_use"]
    p = run(db, excluded_ids=["a", "b"])
    assert not p["supporting_evidence"] and not p["candidate_roles"]
    r = {
        "executable": True,
        "conditions_ast": TRUE,
        "exceptions_ast": {"field": "core.exception", "op": "eq", "value": True},
    }
    assert rule_condition(r, {"question": {"topic": "考试"}, "core": {}})["value"] == "unknown"


def test_api_rejects_client_facts_and_review():
    from app.api.v1.endpoints.liuyao_hybrid import HybridRequest

    for extra in ({"facts": {}}, {"review": True}, {"release_id": "arbitrary"}):
        with pytest.raises(ValidationError):
            HybridRequest(question=QUESTION, numbers=[1, 2, 3], **extra)
    with pytest.raises(ValidationError):
        HybridRequest(question=QUESTION, numbers=[True, 2, 3])


def test_guardian_rejects_unsupported_claims(db):
    from app.services.knowledge_v2.guardian import validate_claims

    add(db, "role")
    p = run(db)
    verdict = validate_claims(
        p,
        [
            {
                "evidence_ids": ["invented"],
                "chart_hash": p["chart_hash"],
                "method_profile_id": METHOD,
                "strong_conclusion": True,
                "recast": True,
            }
        ],
    )
    assert not verdict["valid"] and len(verdict["errors"]) == 3


def test_query_budget_many_roles(db):
    from app.services.knowledge_v2.candidates import KIN

    for role in sorted(KIN):
        add(db, role, action={"op": "propose_role", "role": role})
    p = run(db, chart(["parents"] * 6))
    assert p["query_plan"]["consumption"]["unique_queries"] <= 8
    assert p["query_plan"]["consumption"]["followup_rounds"] <= 2
    assert len(p["supporting_evidence"]) <= 8


def test_single_line_needs_selection_rule_and_candidate_conditions(db):
    add(db, "role")
    c = chart(["parents", "siblings", "siblings", "offspring", "wealth", "officials"])
    assert run(db, c)["selected_use"] == []
    add(
        db,
        "select",
        condition={
            "field": "candidates.parents.presence_status",
            "op": "eq",
            "value": "known_present",
        },
        action={
            "op": "select_line",
            "role": "parents",
            "scope": "main",
            "where": {"field": "line.ref", "op": "exists"},
        },
    )
    p = run(db, c)
    assert p["selected_use"][0]["line_ref"] == "main:1"
    assert not p["gaps"] and p["query_plan"]["consumption"]["unique_queries"] == 3


def test_api_freezes_once_saves_plan_and_never_calls_provider_unpublished(
    db, tmp_path, monkeypatch
):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.api.deps import get_current_user_id
    from app.api.v1.endpoints import liuyao_hybrid as api

    add(db, "role")
    with db.begin() as conn:
        conn.execute(s.release.update().values(status="embedded"))
        conn.execute(s.active.insert().values(name="production", release_id="release"))
    store = RuntimeStore(tmp_path / "runtime.sqlite")
    monkeypatch.setattr(api, "dependencies", lambda: (db, store))

    def forbidden():
        raise AssertionError("Unpublished corpus must not call embedding service")

    monkeypatch.setattr(api, "verified_provider", forbidden)
    app = FastAPI()
    app.include_router(api.router)
    app.dependency_overrides[get_current_user_id] = lambda: "owner"
    with TestClient(app) as client:
        payload = {
            "numbers": [3, 5, 8],
            "question": QUESTION,
            "request_id": "00000000-0000-0000-0000-000000000001",
        }
        first = client.post("/liuyao/hybrid/query", json=payload)
        assert first.status_code == 200
        result = first.json()["result"]
        second = client.post("/liuyao/hybrid/query", json=payload).json()["result"]
        assert second["chart_hash"] == result["chart_hash"]
        assert second["retrieval_run_id"] != result["retrieval_run_id"]
        assert result["supporting_evidence"] == []
        assert result["query_plan"]["original_question"] == QUESTION
        assert client.post("/liuyao/hybrid/query", json={**payload, "facts": {}}).status_code == 422
        assert (
            client.post("/liuyao/hybrid/query", json={**payload, "numbers": [3, 5, 9]}).status_code
            == 422
        )


def test_explicit_exam_type_not_lost_and_only_relevant_clarification(db):
    from app.services.knowledge_v2.query_plan import extract

    assert extract("我替妹妹问，她这次高考能不能过")["exam_type"] == "高考"
    add(
        db,
        "role",
        condition={"all": [TRUE, {"field": "question.exam_type", "op": "eq", "value": "高考"}]},
    )
    p = run(db)
    assert [c["field"] for c in p["clarification"]] == ["exam_type"]


def test_vector_multiquery_best_rank_and_revision_view_dedup(db):
    from app.services.knowledge_v2.hybrid import search
    from app.services.knowledge_v2.ingest import canonical

    add(db, "a")
    add(db, "b")
    with db.begin() as conn:
        for rid, vector in (("a", [1.0, 0.0]), ("b", [0.0, 1.0])):
            conn.execute(
                s.job.insert().values(
                    job_id=rid,
                    view_id=rid,
                    profile_id="p",
                    input_hash=sha(rid),
                    status="completed",
                    attempts=1,
                )
            )
            conn.execute(
                s.embedding.insert().values(
                    view_id=rid,
                    profile_id="p",
                    dimension=2,
                    vector=vector,
                    vector_hash=sha(canonical(vector)),
                    job_id=rid,
                )
            )

    class Provider:
        name = "test"
        dimension = 2

        def embed(self, text):
            return [1.0, 0.0]

    p = plan(QUESTION)
    a, _, _ = search(
        db, "release", p["queries"], {}, p["question_context"], method=METHOD, provider=Provider()
    )
    b, _, _ = search(
        db,
        "release",
        p["queries"] * 3,
        {},
        p["question_context"],
        method=METHOD,
        provider=Provider(),
    )
    assert {u["entity_id"]: u["rrf_score"] for u in a} == {
        u["entity_id"]: u["rrf_score"] for u in b
    }
    assert all("vector" in u["channel_ranks"] for u in a)


def test_case_method_filter_and_view_qualification(db):
    add(db, "other-method", kind="case", metadata={"method_profile_id": "other"})
    add(db, "unreviewed-view")
    with db.begin() as conn:
        conn.execute(
            s.view.update()
            .where(s.view.c.view_id == "unreviewed-view")
            .values(summary_review_status="draft")
        )
    p = run(db)
    assert not p["supporting_evidence"] and not p["pending_conditions"]


def test_web_cast_and_evidence_share_frozen_record(db, tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.api.deps import get_current_user_id
    from app.api.v1.endpoints import liuyao_hybrid as api

    with db.begin() as conn:
        conn.execute(s.release.update().values(status="embedded"))
        conn.execute(s.active.insert().values(name="production", release_id="release"))
    store = RuntimeStore(tmp_path / "web.sqlite")
    monkeypatch.setattr(api, "dependencies", lambda: (db, store))
    app = FastAPI()
    app.include_router(api.router)
    app.dependency_overrides[get_current_user_id] = lambda: "web-user"
    with TestClient(app) as client:
        body = {
            "question": QUESTION,
            "numbers": [3, 5, 8],
            "timezone": "Asia/Hong_Kong",
            "request_id": "00000000-0000-0000-0000-000000000007",
        }
        cast = client.post("/liuyao/hybrid/cast", json=body)
        assert cast.status_code == 200
        result = cast.json()["result"]
        assert result["core_facts"]["main_lines_complete"]
        assert result["core_receipt"]["timezone"] == "Asia/Hong_Kong"
        again = client.post("/liuyao/hybrid/cast", json=body).json()["result"]
        assert again["chart_hash"] == result["chart_hash"]
        evidence = client.post("/liuyao/hybrid/evidence", json={"chart_id": result["chart_id"]})
        assert evidence.status_code == 200
        pack = evidence.json()["result"]
        assert pack["cast"]["chart_hash"] == result["chart_hash"]
        assert pack["hybrid_evidence"]["chart_hash"] == result["chart_hash"]
        assert pack["question"] == QUESTION
        assert "CHART_FACTS_INCOMPLETE" not in pack["hybrid_evidence"]["gaps"]
        assert pack["hybrid_evidence"]["supporting_evidence"] == []
        assert (
            client.post(
                "/liuyao/hybrid/evidence", json={"chart_id": result["chart_id"], "facts": {}}
            ).status_code
            == 422
        )
        app.dependency_overrides[get_current_user_id] = lambda: "other-user"
        assert (
            client.post(
                "/liuyao/hybrid/evidence", json={"chart_id": result["chart_id"]}
            ).status_code
            == 404
        )
        with store.connect() as conn:
            assert conn.execute("SELECT count(*) FROM frozen_cast").fetchone()[0] == 1
