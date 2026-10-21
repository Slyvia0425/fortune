from fastapi.testclient import TestClient

from tests.conftest import headers
from tests.test_events import create_session


def test_recommendation_ranking_and_missing_feature_renormalization(
    client: TestClient,
) -> None:
    session_id = create_session(client)
    response = client.post(
        "/api/v1/recommendations/next",
        headers=headers(),
        json={
            "session_id": session_id,
            "current_topic": "career wealth",
            "top_k": 2,
            "candidates": [
                {
                    "candidate_id": "candidate-high",
                    "item_type": "knowledge_item",
                    "item_id": "knowledge-1",
                    "source_id": "source:career",
                    "title": "Career guidance",
                    "features": {
                        "semantic_similarity": 0.9,
                        "knowledge_graph_relation": 0.8,
                        "sequence_transition": 0.7,
                        "historical_feedback": 0.6,
                        "content_freshness": 0.5,
                    },
                    "source_refs": ["source:career"],
                },
                {
                    "candidate_id": "candidate-sparse",
                    "item_type": "knowledge_item",
                    "item_id": "knowledge-2",
                    "title": "Related topic",
                    "features": {"content_freshness": 0.9},
                },
            ],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["error"] is None
    assert body["result"]["items"][0]["candidate_id"] == "candidate-high"
    assert len(body["result"]["items"]) == 1
    assert "INSUFFICIENT_FEATURES:candidate-sparse" in body["warnings"]


def test_feedback_changes_next_recommendation(client: TestClient) -> None:
    session_id = create_session(client)
    feedback = client.post(
        "/api/v1/feedback",
        headers=headers(),
        json={
            "session_id": session_id,
            "item_id": "knowledge-2",
            "source_id": "source:useful",
            "feedback_type": "collection",
        },
    )
    assert feedback.status_code == 200

    response = client.post(
        "/api/v1/recommendations/next",
        headers=headers(),
        json={
            "session_id": session_id,
            "top_k": 1,
            "candidates": [
                {
                    "candidate_id": "without-feedback-signal",
                    "item_id": "knowledge-1",
                    "features": {"semantic_similarity": 0.74},
                },
                {
                    "candidate_id": "with-feedback-signal",
                    "item_id": "knowledge-2",
                    "source_id": "source:useful",
                    "features": {"semantic_similarity": 0.74},
                },
            ],
        },
    )
    assert response.status_code == 200
    assert response.json()["result"]["items"][0]["candidate_id"] == "with-feedback-signal"


def test_recommendation_cold_start_ignores_conversation_history(
    client: TestClient,
) -> None:
    session_id = create_session(client)
    for sequence_no in (1, 2):
        response = client.post(
            "/api/v1/events/ingest",
            headers={**headers(), "X-Idempotency-Key": f"history-{sequence_no}"},
            json={
                "session_id": session_id,
                "source_module": "module2a",
                "event_type": "conversation.message",
                "sequence_no": sequence_no,
                "system": "divination",
                "payload": {"role": "user", "content": f"普通对话 {sequence_no}"},
            },
        )
        assert response.status_code == 200

    completion = client.post(
        "/api/v1/events/ingest",
        headers={**headers(), "X-Idempotency-Key": "recommendation-completion"},
        json={
            "session_id": session_id,
            "source_module": "module2a",
            "event_type": "module2a.divination.completed",
            "sequence_no": 3,
            "system": "divination",
            "payload": {"divination_id": "div-recommendation-1"},
        },
    )
    assert completion.status_code == 200

    response = client.post(
        "/api/v1/recommendations/next",
        headers=headers(),
        json={
            "session_id": session_id,
            "top_k": 1,
            "candidates": [
                {
                    "candidate_id": "eligible-only",
                    "item_id": "knowledge-eligible",
                    "features": {"semantic_similarity": 0.8},
                }
            ],
        },
    )
    assert response.status_code == 200
    assert response.json()["result"]["cold_start"] is True


def test_upstream_chat_events_do_not_change_recommendation_cold_start(
    client: TestClient,
) -> None:
    session_id = create_session(client)
    archived = client.post(
        "/api/v1/events/ingest",
        headers={**headers(), "X-Idempotency-Key": "upstream-chat-archive"},
        json={
            "session_id": session_id,
            "source_module": "module2a",
            "event_type": "module2a.chat.user_message",
            "system": "divination",
            "payload": {"role": "user", "content": "我想问工作", "inference_eligible": False},
        },
    )
    assert archived.status_code == 200

    response = client.post(
        "/api/v1/recommendations/next",
        headers=headers(),
        json={"session_id": session_id, "top_k": 1, "candidates": []},
    )
    assert response.status_code == 200
    assert response.json()["result"]["cold_start"] is True


def test_feedback_creates_a_whitelisted_feedback_event(client: TestClient) -> None:
    session_id = create_session(client)
    feedback = client.post(
        "/api/v1/feedback",
        headers=headers(),
        json={
            "session_id": session_id,
            "item_id": "knowledge-3",
            "feedback_type": "useful",
        },
    )
    assert feedback.status_code == 200

    events = client.get(
        f"/api/v1/sessions/{session_id}/events?inference_only=true",
        headers=headers(),
    )
    assert events.status_code == 200
    event = events.json()["result"][0]
    assert event["event_type"] == "feedback.submitted"
    assert event["inference_eligible"] is True
    assert event["payload"]["feedback_id"] == feedback.json()["result"]["feedback_id"]
