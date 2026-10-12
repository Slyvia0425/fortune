import json
from pathlib import Path

import pytest
from sqlalchemy import create_engine, insert, select

from app.services.knowledge_v2 import schema as s
from app.services.knowledge_v2.hybrid import run_text_reasoning
from app.services.knowledge_v2.retrieval import allowed_rows
from app.services.knowledge_v2.runtime import freeze

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data/liuyao_knowledge/stage9-text-reasoning-v2"


@pytest.fixture
def db(tmp_path):
    import shutil

    path = tmp_path / "test.sqlite3"
    shutil.copyfile(DATA / "knowledge.sqlite3", path)
    engine = create_engine("sqlite:///" + str(path))
    yield engine
    engine.dispose()


def release_id():
    return json.loads((DATA / "preparation_report.json").read_text())["release_id"]


def test_text_release_not_executable_and_not_review_bypass(db):
    with db.connect() as conn:
        _, rows = allowed_rows(conn, release_id(), purpose="llm_source_reasoning")
        assert len(rows) == 243
        assert sum(r["kind"] == "case" for r in rows) == 207
        assert all(not r["rule"]["executable"] for r in rows if r["kind"] == "rule")
        assert allowed_rows(conn, release_id())[1] == []
        assert (
            allowed_rows(conn, release_id(), purpose="llm_source_reasoning", review=True)[1] == []
        )
        old = conn.execute(
            select(s.release.c.release_id).where(s.release.c.status == "embedded")
        ).scalar_one()
        assert allowed_rows(conn, old, purpose="llm_source_reasoning")[1] == []


def test_text_revocation_and_exclusion(db):
    with db.begin() as conn:
        _, rows = allowed_rows(conn, release_id(), purpose="llm_source_reasoning")
        rid = rows[0]["revision_id"]
        assert (
            len(
                allowed_rows(
                    conn, release_id(), purpose="llm_source_reasoning", excluded_ids=[rid]
                )[1]
            )
            == 242
        )
        conn.execute(
            insert(s.revocation).values(
                revocation_id="r", entity_revision_id=rid, reason="test", revoked_at="2026"
            )
        )
        assert len(allowed_rows(conn, release_id(), purpose="llm_source_reasoning")[1]) == 242


def test_real_non_executable_rules_reach_model_evidence(db):
    q = "我问父亲是否成功"
    c = freeze([1, 5, 1], q)
    pack = run_text_reasoning(db, release_id(), q, chart_id=c["chart_id"], core_loader=lambda _: c)
    assert pack["reasoning_evidence"]
    assert all(u["source_quotes"] for u in pack["reasoning_evidence"])
    assert pack["interpretation_contract"]["model_reasoning_allowed"]
    assert not pack["interpretation_contract"]["strong_conclusion_allowed"]
    assert pack["selected_use"] == []


def test_text_manifest_tamper_is_rejected(db):
    with db.begin() as conn:
        conn.execute(
            s.release.update()
            .where(s.release.c.release_id == release_id())
            .values(manifest_hash="tampered")
        )
        with pytest.raises(ValueError, match="manifest hash"):
            allowed_rows(conn, release_id(), purpose="llm_source_reasoning")


def test_text_source_tamper_is_rejected(db):
    from app.services.knowledge_v2.retrieval import quotes

    with db.begin() as conn:
        _, rows = allowed_rows(conn, release_id(), purpose="llm_source_reasoning")
        rid = rows[0]["revision_id"]
        sid = (
            conn.execute(
                select(s.lineage.c.source_revision_id).where(s.lineage.c.entity_revision_id == rid)
            )
            .scalars()
            .first()
        )
        conn.execute(
            s.source.update()
            .where(s.source.c.source_revision_id == sid)
            .values(raw_text="tampered")
        )
        with pytest.raises(ValueError):
            quotes(conn, rid)


def test_cases_reach_evidence_with_sources_and_limitations(db):
    q = "我问父亲疾病"
    c = freeze([1, 5, 1], q)
    pack = run_text_reasoning(db, release_id(), q, chart_id=c["chart_id"], core_loader=lambda _: c)
    cases = [u for u in pack["reasoning_evidence"] if u["kind"] == "case"]
    assert 0 < len(cases) <= 4
    assert pack["case_support_available"]
    assert all(u["usage"] == "analogy_only" and u["source_quotes"] for u in cases)
    assert all("remaining_issues" in u["case_context"] for u in cases)
    assert all(u["condition_evaluation"] == "unknown" for u in cases)
    assert not pack["interpretation_contract"]["copy_case_outcome"]
    assert any(t.get("fallback") == "bm25_and_structured" for t in pack["retrieval_trace"])


def test_case_grants_metadata_and_method_are_checked(db):
    with db.begin() as conn:
        _, rows = allowed_rows(conn, release_id(), purpose="llm_source_reasoning")
        case = next(r for r in rows if r["kind"] == "case")
        rid = case["revision_id"]
        conn.execute(
            s.entity.update()
            .where(s.entity.c.revision_id == rid)
            .values(
                metadata_json={**case["metadata_json"], "remaining_issues": [], "tampered": True}
            )
        )
        assert rid not in {
            r["revision_id"]
            for r in allowed_rows(conn, release_id(), purpose="llm_source_reasoning")[1]
        }


def test_legacy_rule_only_release_still_excludes_cases():
    old = ROOT / "data/liuyao_knowledge/stage9-text-reasoning-v1"
    engine = create_engine("sqlite:///" + str(old / "knowledge.sqlite3"))
    try:
        rid = json.loads((old / "preparation_report.json").read_text())["release_id"]
        with engine.connect() as conn:
            _, rows = allowed_rows(conn, rid, purpose="llm_source_reasoning")
            assert len(rows) == 36 and all(r["kind"] == "rule" for r in rows)
    finally:
        engine.dispose()


def test_case_vector_channel_is_used(db):
    from app.services.knowledge_v2.hybrid import search
    from app.services.knowledge_v2.query_plan import plan

    with db.connect() as conn:
        pid = conn.execute(
            select(s.release.c.profile_id).where(s.release.c.release_id == release_id())
        ).scalar_one()
        profile = (
            conn.execute(select(s.profile).where(s.profile.c.profile_id == pid)).mappings().one()
        )
        vector = conn.execute(
            select(s.embedding.c.vector).where(s.embedding.c.profile_id == pid)
        ).scalar()

    class TestProvider:
        # Deterministic fixture only: no remote API, not a quality evaluation.
        name = profile["config"]["model_name"]
        dimension = profile["dimension"]
        endpoint_identity = profile["config"].get("endpoint_identity")

        def embed(self, text):
            return vector

    query_plan = plan("我问父亲疾病")
    units, _, _ = search(
        db,
        release_id(),
        query_plan["queries"],
        {},
        query_plan["question_context"],
        method="zengshan-single-cast-v1",
        provider=TestProvider(),
        purpose="llm_source_reasoning",
    )
    assert any(u["kind"] == "case" and "vector" in u["channel_ranks"] for u in units)
