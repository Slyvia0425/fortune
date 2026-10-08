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


def test_chat_archive_events_do_not_change_recommendation_cold_start(client: TestClient) -> None:
    session_id = create_session(client)
    archived = client.post(
        "/api/v1/events/ingest",
        headers=headers(),
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
