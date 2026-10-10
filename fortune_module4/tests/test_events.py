from fastapi.testclient import TestClient

from tests.conftest import headers


def create_session(client: TestClient, user_id: str = "user-a") -> str:
    response = client.post(
        "/api/v1/sessions",
        headers=headers(user_id),
        json={"system": "divination", "title": "integration session"},
    )
    assert response.status_code == 200
    return response.json()["result"]["session"]["session_id"]


def event_payload(session_id: str, sequence_no: int) -> dict[str, object]:
    return {
        "event_id": f"00000000-0000-0000-0000-{sequence_no:012d}",
        "session_id": session_id,
        "source_module": "module2a",
        "event_type": "module2a.divination.completed",
        "sequence_no": sequence_no,
        "occurred_at": f"2026-09-18T10:3{sequence_no}:00+08:00",
        "system": "divination",
        "payload": {
            "divination_id": f"div-{sequence_no}",
            "method": "meihua",
            "primary_hexagram": {"number": 1, "name": "qian"},
            "moving_lines": [2],
            "rule_version": "rules-1.0",
            "deterministic_hash": f"sha256:div-{sequence_no}",
        },
        "source_refs": ["source:zhouyi"],
        "schema_version": "1.0",
    }


def test_event_ingestion_is_idempotent_and_ordered(client: TestClient) -> None:
    session_id = create_session(client)
    first = event_payload(session_id, 1)
    second = event_payload(session_id, 2)

    response = client.post(
        "/api/v1/events/ingest",
        headers={**headers(), "X-Idempotency-Key": "event-key-1"},
        json=first,
    )
    assert response.status_code == 200
    assert response.json()["result"]["duplicate"] is False
    assert response.json()["result"]["event"]["inference_eligible"] is True

    response = client.post(
        "/api/v1/events/ingest",
        headers={**headers(), "X-Idempotency-Key": "event-key-2"},
        json=second,
    )
    assert response.status_code == 200

    duplicate = client.post(
        "/api/v1/events/ingest",
        headers={**headers(), "X-Idempotency-Key": "event-key-1"},
        json=first,
    )
    assert duplicate.status_code == 200
    assert duplicate.json()["result"]["duplicate"] is True

    events = client.get(f"/api/v1/sessions/{session_id}/events", headers=headers())
    assert events.status_code == 200
    sequence_numbers = [item["sequence_no"] for item in events.json()["result"]]
    assert sequence_numbers == [1, 2]


def test_conversation_history_is_archived_but_excluded_from_inference(
    client: TestClient,
) -> None:
    session_id = create_session(client)

    for sequence_no, role, content in (
        (1, "user", "我想问未来三个月的工作安排。"),
        (2, "assistant", "请提供两个正整数用于起卦。"),
    ):
        response = client.post(
            "/api/session/event",
            json={
                "session_id": session_id,
                "event_type": "conversation.message",
                "module": "divination",
                "source_module": "module2a",
                "sequence_no": sequence_no,
                "user_id": "user-a",
                "payload": {"role": role, "content": content},
            },
        )
        assert response.status_code == 200
        assert response.json()["result"]["inference_eligible"] is False

    completion = client.post(
        "/api/v1/events/ingest",
        headers={**headers(), "X-Idempotency-Key": "conversation-completion"},
        json=event_payload(session_id, 3),
    )
    assert completion.status_code == 200
    assert completion.json()["result"]["event"]["inference_eligible"] is True

    history = client.get(f"/api/v1/sessions/{session_id}/events", headers=headers())
    assert history.status_code == 200
    assert [event["event_type"] for event in history.json()["result"]] == [
        "conversation.message",
        "conversation.message",
        "module2a.divination.completed",
    ]

    inference_events = client.get(
        f"/api/v1/sessions/{session_id}/events?inference_only=true",
        headers=headers(),
    )
    assert inference_events.status_code == 200
    assert [event["event_type"] for event in inference_events.json()["result"]] == [
        "module2a.divination.completed"
    ]


def test_session_events_are_isolated_by_user(client: TestClient) -> None:
    session_id = create_session(client, "user-a")
    response = client.get(
        f"/api/v1/sessions/{session_id}/events",
        headers=headers("user-b"),
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_session_history_list_returns_activity_and_preview(client: TestClient) -> None:
    session_id = create_session(client)
    for sequence_no, role, content in (
        (1, "user", "我想问未来三个月的工作安排。"),
        (2, "assistant", "请提供两个正整数用于起卦。"),
    ):
        event_type = (
            "conversation.message" if sequence_no == 1 else "module2a.chat.assistant_message"
        )
        response = client.post(
            "/api/session/event",
            json={
                "session_id": session_id,
                "event_type": event_type,
                "module": "divination",
                "source_module": "module2a",
                "sequence_no": sequence_no,
                "user_id": "user-a",
                "payload": {"role": role, "content": content},
            },
        )
        assert response.status_code == 200

    completion = client.post(
        "/api/v1/events/ingest",
        headers={**headers(), "X-Idempotency-Key": "history-list-completion"},
        json=event_payload(session_id, 3),
    )
    assert completion.status_code == 200

    sessions = client.get("/api/v1/sessions", headers=headers())
    assert sessions.status_code == 200
    item = next(
        session for session in sessions.json()["result"] if session["session_id"] == session_id
    )
    assert item["event_count"] == 3
    assert item["conversation_count"] == 2
    assert item["last_message_preview"] == "请提供两个正整数用于起卦。"
    assert item["last_event_at"] is not None
