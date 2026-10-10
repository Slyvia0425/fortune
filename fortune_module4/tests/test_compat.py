from fastapi.testclient import TestClient

from tests.conftest import headers


def test_upstream_event_contract_maps_to_module4(client: TestClient) -> None:
    response = client.post(
        "/api/session/event",
        json={
            "session_id": "compat-session-001",
            "event_type": "question",
            "module": "bazi",
            "event_id": "20000000-0000-0000-0000-000000000020",
            "user_id": "compat-user",
            "occurred_at": "2026-09-20T10:00:00+08:00",
            "payload": {
                "question": "今年适合换工作吗？",
                "source_ref": "source:compat-bazi",
            },
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["system"] == "session-event-v1"
    assert body["session_id"] == "compat-session-001"
    assert body["result"]["accepted"] is True
    assert body["result"]["event_count"] == 1
    assert body["result"]["inference_eligible"] is False
    assert body["source_refs"] == [
        {"source_id": "source:compat-bazi", "title": "source:compat-bazi"}
    ]
    assert body["meta"]["mock"] is False
    assert body["error"] is None

    duplicate = client.post(
        "/api/session/event",
        json={
            "session_id": "compat-session-001",
            "event_id": "20000000-0000-0000-0000-000000000020",
            "event_type": "question",
            "module": "bazi",
            "user_id": "compat-user",
            "occurred_at": "2026-09-20T10:00:00+08:00",
            "payload": {
                "question": "今年适合换工作吗？",
                "source_ref": "source:compat-bazi",
            },
        },
    )
    assert duplicate.status_code == 200
    assert duplicate.json()["result"]["duplicate"] is True
    assert duplicate.json()["result"]["event_count"] == 1

    events = client.get(
        "/api/v1/sessions/compat-session-001/events",
        headers=headers("compat-user"),
    )
    assert events.status_code == 200
    event = events.json()["result"][0]
    assert event["source_module"] == "frontend"
    assert event["event_type"] == "frontend.question.asked"
    assert event["system"] == "bazi"
    assert event["payload"]["frontend_module"] == "bazi"
    assert event["payload"]["frontend_event_type"] == "question"
    assert event["inference_eligible"] is False


def test_upstream_note_contract_supports_create_update_and_delete(client: TestClient) -> None:
    created = client.post(
        "/api/user/notes",
        json={
            "user_id": "compat-note-user",
            "title": "职业规划",
            "content": "先整理行业和岗位信息。",
            "tags": ["career", "planning"],
            "source_ref": "source:compat-note",
            "action": "create",
        },
    )
    assert created.status_code == 200
    created_body = created.json()
    note = created_body["result"]
    assert note["title"] == "职业规划"
    assert note["content"] == "先整理行业和岗位信息。"
    assert note["tags"] == ["career", "planning"]
    assert note["source_ref"] == "source:compat-note"
    assert created_body["source_refs"] == [
        {"source_id": "source:compat-note", "title": "source:compat-note"}
    ]

    updated = client.post(
        "/api/user/notes",
        json={
            "user_id": "compat-note-user",
            "note_id": note["note_id"],
            "title": "职业规划",
            "content": "先整理行业、岗位和技能差距。",
            "tags": ["career"],
            "source_ref": "source:compat-note",
            "action": "update",
        },
    )
    assert updated.status_code == 200
    assert updated.json()["result"]["content"] == "先整理行业、岗位和技能差距。"

    stored = client.get(
        "/api/v1/me/notes",
        headers=headers("compat-note-user"),
    )
    assert stored.status_code == 200
    assert stored.json()["result"][0]["body"] == "先整理行业、岗位和技能差距。"

    deleted = client.post(
        "/api/user/notes",
        json={
            "user_id": "compat-note-user",
            "note_id": note["note_id"],
            "action": "delete",
        },
    )
    assert deleted.status_code == 200
    assert deleted.json()["result"] == {
        "deleted": True,
        "note_id": note["note_id"],
    }

    stored_after_delete = client.get(
        "/api/v1/me/notes",
        headers=headers("compat-note-user"),
    )
    assert stored_after_delete.status_code == 200
    assert stored_after_delete.json()["result"] == []


def test_compatibility_routes_reject_user_mismatch(client: TestClient) -> None:
    response = client.post(
        "/api/user/notes",
        headers=headers("header-user"),
        json={
            "user_id": "body-user",
            "title": "冲突测试",
            "content": "不应写入。",
            "action": "create",
        },
    )

    assert response.status_code == 403
    body = response.json()
    assert body["result"] is None
    assert body["error"]["code"] == "USER_MISMATCH"
    assert body["meta"]["mock"] is False

def test_compatibility_validation_error_uses_frontend_envelope(
    client: TestClient,
) -> None:
    response = client.post(
        "/api/session/event",
        json={"event_type": "question", "module": "bazi"},
    )

    assert response.status_code == 400
    body = response.json()
    assert body["result"] is None
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert body["meta"]["mock"] is False

def test_compatibility_routes_canonicalize_url_source_refs(
    client: TestClient,
) -> None:
    event = client.post(
        "/api/session/event",
        json={
            "session_id": "compat-url-source-001",
            "event_type": "knowledge_read",
            "module": "knowledge",
            "user_id": "compat-url-source-user",
            "payload": {"source_ref": "https://example.com/source/#section"},
        },
    )
    event.raise_for_status()
    source_id = event.json()["source_refs"][0]["source_id"]
    assert source_id.startswith("source:")

    note = client.post(
        "/api/user/notes",
        json={
            "user_id": "compat-url-source-user",
            "title": "URL source",
            "content": "Stable source mapping",
            "source_ref": "https://example.com/source/#section",
            "action": "create",
        },
    )
    note.raise_for_status()
    assert note.json()["result"]["source_ref"] == source_id
