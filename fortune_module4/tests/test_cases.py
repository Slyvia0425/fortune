from fastapi.testclient import TestClient

from tests.conftest import headers
from tests.test_events import create_session


def test_similar_cases_use_only_consented_anonymized_profiles(client: TestClient) -> None:
    user_id = "case-owner"
    privacy = client.put(
        "/api/v1/me/privacy",
        headers=headers(user_id),
        json={
            "consent_scopes": ["session_storage", "anonymous_case_matching"],
            "retention_policy": "standard",
            "allow_anonymous_cases": True,
            "allow_shared_training": False,
        },
    )
    assert privacy.status_code == 200

    session_id = create_session(client, user_id)
    chart_event = client.post(
        "/api/v1/events/ingest",
        headers={**headers(user_id), "X-Idempotency-Key": "chart-event-1"},
        json={
            "session_id": session_id,
            "source_module": "module1",
            "event_type": "module1.chart.completed",
            "sequence_no": 1,
            "system": "bazi",
            "payload": {
                "chart_id": "chart-001",
                "chart_features": {
                    "day_master": "wood",
                    "five_elements": {"wood": 0.4, "fire": 0.3},
                    "strength": "balanced",
                },
            },
            "source_refs": ["source:bazi-reference"],
        },
    )
    assert chart_event.status_code == 200

    response = client.post(
        "/api/v1/cases/similar",
        headers=headers("another-user"),
        json={
            "features": {
                "chart_structure": {
                    "day_master": "wood",
                    "five_elements": {"wood": 0.4, "fire": 0.3},
                    "strength": "balanced",
                }
            },
            "top_k": 3,
            "threshold": 0.6,
        },
    )
    assert response.status_code == 200
    items = response.json()["result"]["items"]
    assert len(items) == 1
    assert "user_id" not in items[0]
    assert items[0]["score"] == 1.0
    assert "chart structure similarity" in items[0]["explanation"]


def test_similar_cases_exclude_profiles_without_consent(client: TestClient) -> None:
    user_id = "no-consent-user"
    session_id = create_session(client, user_id)
    event = client.post(
        "/api/v1/events/ingest",
        headers={**headers(user_id), "X-Idempotency-Key": "no-consent-chart"},
        json={
            "session_id": session_id,
            "source_module": "module1",
            "event_type": "module1.chart.completed",
            "sequence_no": 1,
            "system": "bazi",
            "payload": {
                "chart_id": "chart-private",
                "chart_features": {"day_master": "fire", "strength": "strong"},
            },
        },
    )
    assert event.status_code == 200

    response = client.post(
        "/api/v1/cases/similar",
        headers=headers("query-user"),
        json={"features": {"chart_structure": {"day_master": "fire", "strength": "strong"}}},
    )
    assert response.status_code == 200
    assert response.json()["result"]["items"] == []


def test_similar_cases_ignore_conversation_history(client: TestClient) -> None:
    user_id = "conversation-history-user"
    privacy = client.put(
        "/api/v1/me/privacy",
        headers=headers(user_id),
        json={
            "consent_scopes": ["session_storage", "anonymous_case_matching"],
            "retention_policy": "standard",
            "allow_anonymous_cases": True,
            "allow_shared_training": False,
        },
    )
    assert privacy.status_code == 200

    session_id = create_session(client, user_id)
    response = client.post(
        "/api/session/event",
        headers=headers(user_id),
        json={
            "session_id": session_id,
            "event_type": "conversation.message",
            "module": "bazi",
            "source_module": "module2a",
            "sequence_no": 1,
            "payload": {
                "role": "user",
                "content": "这段普通对话不能进入相似案例。",
                "chart_id": "conversation-chart",
                "chart_features": {"day_master": "wood", "strength": "balanced"},
            },
        },
    )
    assert response.status_code == 200

    cases = client.post(
        "/api/v1/cases/similar",
        headers=headers("query-user"),
        json={
            "features": {
                "chart_structure": {"day_master": "wood", "strength": "balanced"}
            }
        },
    )
    assert cases.status_code == 200
    assert cases.json()["result"]["items"] == []
