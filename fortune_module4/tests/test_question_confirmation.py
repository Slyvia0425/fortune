import hashlib
import hmac
import json
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.deps import get_hybrid_user_id
from app.api.v1.endpoints import liuyao_hybrid as api
from app.services.knowledge_v2.runtime import ConfirmationConflict, RuntimeStore

SECRET = "unit-test-private-bridge-key-0123456789"
IDENTITY = "00000000-0000-0000-0000-000000000009"


def candidate(question="未来三个月能找到工作吗", numbers=None, timezone="Asia/Hong_Kong"):
    return {
        "question_context": {
            "parser_status": "parsed",
            "raw_question": question,
            "goal": {"value": question},
            "goal_groups": [question],
            "ambiguities": [],
            "known_facts": [],
            "target_entities": [],
            "relationships": [],
        },
        "question_analysis": {
            "version": "single-question-analysis-v4",
            "status": "valid",
            "issue_count": 1,
            "normalized_question": question,
        },
        "numbers": numbers or [3, 6, 8],
        "timezone": timezone,
    }


def prepare(store, owner="owner", question="未来三个月能找到工作吗", **kwargs):
    state = store.dialogue(owner)
    state = store.save_dialogue(
        owner,
        state["conversation_id"],
        0,
        [{"role": "user", "content": question}],
        candidate(question, **kwargs),
        None,
    )
    contract = store.confirm_question(
        owner, state["conversation_id"], state["revision"], state["candidate"]["question_hash"]
    )
    return state, contract


def signed_post(client, path, payload, *, tamper=False):
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    stamp = str(int(time.time()))
    signature = hmac.new(
        SECRET.encode(), f"{path}\n{stamp}\n{IDENTITY}\n{body}".encode(), hashlib.sha256
    ).hexdigest()
    return client.post(
        "/liuyao/hybrid/" + path,
        content=body + (" " if tamper else ""),
        headers={
            "content-type": "application/json",
            "X-Anonymous-Session": IDENTITY,
            "X-Divination-Timestamp": stamp,
            "X-Divination-Signature": signature,
        },
    )


def test_confirmation_hash_retry_owner_and_frozen_binding(tmp_path):
    store = RuntimeStore(tmp_path / "private.sqlite")
    state, contract = prepare(store)
    assert (
        store.confirm_question(
            "owner", state["conversation_id"], state["revision"], contract["question_hash"]
        )
        == contract
    )
    with pytest.raises(PermissionError):
        store.confirm_question(
            "other", state["conversation_id"], state["revision"], contract["question_hash"]
        )
    chart = store.freeze_confirmed("owner", contract["confirmation_id"], "request")
    assert chart == store.freeze_confirmed("owner", contract["confirmation_id"], "request")
    assert chart["confirmed_question"] == contract
    assert chart["question_context"] == state["candidate"]["question_context"]
    assert chart["original_question"] == contract["normalized_question"]
    with pytest.raises(PermissionError):
        store.freeze_confirmed("other", contract["confirmation_id"], "request")
    with pytest.raises(ConfirmationConflict):
        store.freeze_confirmed("owner", contract["confirmation_id"], "new-request")
    with store.connect() as conn:
        assert conn.execute("SELECT count(*) FROM frozen_cast").fetchone()[0] == 1


@pytest.mark.parametrize(
    "kwargs", [{"question": "今年能升职吗"}, {"numbers": [1, 2, 3]}, {"timezone": "UTC"}, {}]
)
def test_same_request_cannot_use_another_confirmation(tmp_path, kwargs):
    store = RuntimeStore(tmp_path / "private.sqlite")
    _, first = prepare(store)
    store.freeze_confirmed("owner", first["confirmation_id"], "same-request")
    _, second = prepare(store, **kwargs)
    with pytest.raises(ConfirmationConflict):
        store.freeze_confirmed("owner", second["confirmation_id"], "same-request")


def test_edit_invalidates_unfrozen_confirmation_and_preserves_full_history(tmp_path):
    store = RuntimeStore(tmp_path / "private.sqlite")
    state, contract = prepare(store)
    messages = [{"role": "user", "content": "第一条关键事实"}] + [
        {"role": "user", "content": f"第{i}轮补充"} for i in range(20)
    ]
    edited = store.save_dialogue(
        "owner", state["conversation_id"], state["revision"], messages, None, None
    )
    assert store.dialogue("owner", state["conversation_id"])["messages"] == messages
    assert edited["candidate"] is None and edited["confirmed_question"] is None
    with pytest.raises(ConfirmationConflict):
        store.freeze_confirmed("owner", contract["confirmation_id"], "request")
    with pytest.raises(ConfirmationConflict):
        store.save_dialogue(
            "owner", state["conversation_id"], state["revision"], messages, None, None
        )


def test_atomic_freeze_retry_and_concurrent_idempotency(tmp_path, monkeypatch):
    from app.services.knowledge_v2 import runtime

    store = RuntimeStore(tmp_path / "private.sqlite")
    _, contract = prepare(store)
    original = runtime.freeze

    def fail(*args, **kwargs):
        raise ValueError("test engine failure")

    monkeypatch.setattr(runtime, "freeze", fail)
    with pytest.raises(ValueError):
        store.freeze_confirmed("owner", contract["confirmation_id"], "request")
    with store.connect() as conn:
        assert conn.execute("SELECT count(*) FROM frozen_cast").fetchone()[0] == 0
        assert conn.execute("SELECT chart_id FROM question_confirmation").fetchone()[0] is None
    monkeypatch.setattr(runtime, "freeze", original)
    with ThreadPoolExecutor(max_workers=2) as pool:
        charts = list(
            pool.map(
                lambda _: store.freeze_confirmed("owner", contract["confirmation_id"], "request"),
                range(2),
            )
        )
    assert charts[0] == charts[1]


def test_legacy_record_is_readable_but_changed_question_cannot_reuse(tmp_path):
    store = RuntimeStore(tmp_path / "private.sqlite")
    chart = store.freeze_once("owner", "legacy", [3, 6, 8], "旧问事")
    assert store.load("owner", chart["chart_id"]) == chart
    assert "confirmed_question" not in chart
    with pytest.raises(ConfirmationConflict):
        store.freeze_once("owner", "legacy", [3, 6, 8], "另一个问题")


def test_expired_and_dangling_candidates_cannot_be_confirmed(tmp_path):
    store = RuntimeStore(tmp_path / "private.sqlite")
    state = store.dialogue("owner")
    invalid = candidate()
    invalid["question_context"]["relationships"] = [
        {"from_entity_id": "missing", "to_entity_id": "missing", "relation": "前男友"}
    ]
    with pytest.raises(ValueError, match="Dangling"):
        store.save_dialogue(
            "owner",
            state["conversation_id"],
            0,
            [{"role": "user", "content": "前男友"}],
            invalid,
            None,
        )
    valid = candidate()
    state = store.save_dialogue(
        "owner",
        state["conversation_id"],
        0,
        [{"role": "user", "content": "未来三个月能找到工作吗"}],
        valid,
        None,
    )
    with store.connect() as conn:
        conn.execute(
            "UPDATE question_dialogue SET updated_at=?",
            ((datetime.now(UTC) - timedelta(hours=25)).isoformat(),),
        )
    with pytest.raises(ConfirmationConflict, match="expired"):
        store.confirm_question(
            "owner",
            state["conversation_id"],
            state["revision"],
            state["candidate"]["question_hash"],
        )


def test_candidate_without_q1_and_conflicting_q1_cannot_be_saved(tmp_path):
    store = RuntimeStore(tmp_path / "private.sqlite")
    state = store.dialogue("owner")
    missing = candidate()
    del missing["question_analysis"]
    conflicting = candidate()
    conflicting["question_analysis"]["status"] = "semantic_conflict"
    conflicting["question_analysis"]["issue_count"] = 2
    for invalid in [missing, conflicting]:
        with pytest.raises(ValueError, match="precheck"):
            store.save_dialogue(
                "owner",
                state["conversation_id"],
                0,
                [{"role": "user", "content": "未来三个月能找到工作吗"}],
                invalid,
                None,
            )
    assert store.dialogue("owner", state["conversation_id"])["revision"] == 0


@pytest.mark.parametrize("pipeline", ["analysis-planner-v4.1-pr3", "analysis-planner-deterministic-v1"])
def test_initial_plan_is_private_versioned_and_cannot_be_overwritten(tmp_path, pipeline):
    store = RuntimeStore(tmp_path / "private.sqlite")
    _, contract = prepare(store)
    chart = store.freeze_confirmed("owner", contract["confirmation_id"], "request")
    key = "a" * 64
    assert store.initial_plan("owner", chart["chart_id"], key) is None
    plan = {
        "pipeline_version": pipeline,
        "chart_hash": chart["chart_hash"],
        "confirmation_id": contract["confirmation_id"],
        "question_hash": contract["question_hash"],
        "question_analysis": chart["question_analysis"],
        "initial_plan": {
            "chart_hash": chart["chart_hash"],
            "question_hash": contract["question_hash"],
            "tasks": ["first"],
        },
    }
    assert store.initial_plan("owner", chart["chart_id"], key, plan) == plan
    changed = {**plan, "initial_plan": {**plan["initial_plan"], "tasks": ["replacement"]}}
    assert store.initial_plan("owner", chart["chart_id"], key, changed) == plan
    assert store.initial_plan("owner", chart["chart_id"], key) == plan
    with pytest.raises(PermissionError):
        store.initial_plan("other", chart["chart_id"], key)
    with pytest.raises(ConfirmationConflict):
        store.initial_plan("owner", chart["chart_id"], "b" * 64, {**plan, "chart_hash": "wrong"})
    other_key = "c" * 64
    alternative = {**plan, "initial_plan": {**plan["initial_plan"], "tasks": ["other-mode"]}}
    assert store.initial_plan("owner", chart["chart_id"], other_key, alternative) == alternative
    assert store.initial_plan("owner", chart["chart_id"], key) == plan
    with pytest.raises(ConfirmationConflict):
        store.initial_plan("owner", chart["chart_id"], "d" * 64, {**plan, "pipeline_version": "unrecognized"})


def test_public_endpoints_require_real_candidate_and_confirmation(tmp_path, monkeypatch):
    store = RuntimeStore(tmp_path / "private.sqlite")
    monkeypatch.setattr(api, "question_store", lambda: store)
    monkeypatch.setattr(api, "dependencies", lambda: (None, store))
    monkeypatch.setenv("DIVINATION_INTERNAL_SECRET", SECRET)
    app = FastAPI()
    app.include_router(api.router)
    app.dependency_overrides[get_hybrid_user_id] = lambda: "owner"
    with TestClient(app) as client:
        legacy = {"question": "旧入口", "numbers": [3, 6, 8], "request_id": str(uuid4())}
        assert client.post("/liuyao/hybrid/cast", json=legacy).status_code == 422
        assert client.post("/liuyao/hybrid/query", json=legacy).status_code == 410
        assert (
            client.post(
                "/liuyao/hybrid/cast",
                json={"confirmation_id": str(uuid4()), "request_id": str(uuid4())},
            ).status_code
            == 404
        )
        state = client.post("/liuyao/hybrid/dialogue-load", json={}).json()["result"]
        payload = {
            "conversation_id": state["conversation_id"],
            "expected_revision": 0,
            "messages": [{"role": "user", "content": "未来三个月能找到工作吗"}],
            "candidate": candidate(),
            "reply": {"status": "ready_for_confirmation"},
        }
        assert client.post("/liuyao/hybrid/dialogue-save", json=payload).status_code == 403
        assert signed_post(client, "dialogue-save", payload, tamper=True).status_code == 403
        state = signed_post(client, "dialogue-save", payload).json()["result"]
        confirm = {
            "conversation_id": state["conversation_id"],
            "revision": state["revision"],
            "question_hash": state["candidate"]["question_hash"],
        }
        assert (
            signed_post(client, "confirm", confirm | {"question_hash": "0" * 64}).status_code == 409
        )
        contract = signed_post(client, "confirm", confirm).json()["result"]["confirmed_question"]
        body = {"confirmation_id": contract["confirmation_id"], "request_id": str(uuid4())}
        assert (
            client.post("/liuyao/hybrid/cast", json=body | {"question": "篡改"}).status_code == 422
        )
        chart = client.post("/liuyao/hybrid/cast", json=body).json()["result"]
        assert (
            client.post("/liuyao/hybrid/cast", json=body).json()["result"]["chart_hash"]
            == chart["chart_hash"]
        )
        frozen = client.post("/liuyao/hybrid/frozen", json={"chart_id": chart["chart_id"]}).json()[
            "result"
        ]
        assert frozen["confirmed_question"] == contract
        assert frozen["question"] == contract["normalized_question"]
        app.dependency_overrides[get_hybrid_user_id] = lambda: "other"
        assert client.post("/liuyao/hybrid/cast", json=body).status_code == 404
        assert (
            client.post(
                "/liuyao/hybrid/dialogue-load", json={"conversation_id": state["conversation_id"]}
            ).status_code
            == 404
        )
