import httpx
import pytest

from app.services import embeddings


def test_embedding_http_uses_remaining_budget_and_never_starts_after_deadline(monkeypatch):
    now = [100.0]
    monkeypatch.setattr(embeddings.time, "monotonic", lambda: now[0])
    calls = []

    def post(url, **kwargs):
        calls.append(kwargs["timeout"])
        return httpx.Response(
            200,
            request=httpx.Request("POST", url),
            json={"model": "test", "data": [{"index": 0, "embedding": [1.0, 0.0]}]},
        )

    monkeypatch.setattr(httpx, "post", post)
    provider = embeddings.OpenAIEmbeddingProvider(
        base_url="https://example.invalid/v1", api_key="test", model_name="test", dimension=2
    )
    assert embeddings.embedding_request_timeout() == 60
    with embeddings.retrieval_deadline(20):
        now[0] = 105
        assert provider.embed("月破") == [1.0, 0.0]
        assert calls == [15]
        now[0] = 121
        with pytest.raises(TimeoutError, match="RETRIEVAL_DEADLINE"):
            provider.embed("不应发出请求")
        assert calls == [15]
    assert embeddings.embedding_request_timeout() == 60


def test_nested_retrieval_deadline_cannot_extend_parent(monkeypatch):
    monkeypatch.setattr(embeddings.time, "monotonic", lambda: 100.0)
    with embeddings.retrieval_deadline(10), embeddings.retrieval_deadline(20):
        assert embeddings.embedding_request_timeout() == 10
