import hashlib
import math
import re
from abc import ABC, abstractmethod
from functools import lru_cache
from typing import Any

from app.core.config import get_settings


class EmbeddingProvider(ABC):
    @property
    @abstractmethod
    def name(self) -> str:
        raise NotImplementedError

    @property
    @abstractmethod
    def dimension(self) -> int:
        raise NotImplementedError

    @abstractmethod
    def embed(self, text: str) -> list[float]:
        raise NotImplementedError


class HashEmbeddingProvider(EmbeddingProvider):
    """Deterministic local fallback that keeps the API runnable without model downloads."""

    def __init__(self, dimension: int) -> None:
        self._dimension = dimension

    @property
    def name(self) -> str:
        return "hash-embedding-v1"

    @property
    def dimension(self) -> int:
        return self._dimension

    def embed(self, text: str) -> list[float]:
        vector = [0.0] * self._dimension
        tokens = self._tokenize(text)
        if not tokens:
            return vector

        for token in tokens:
            digest = hashlib.sha256(token.encode("utf-8")).digest()
            index = int.from_bytes(digest[:8], "big") % self._dimension
            sign = 1.0 if digest[8] % 2 == 0 else -1.0
            vector[index] += sign

        norm = math.sqrt(sum(value * value for value in vector))
        if norm == 0:
            return vector
        return [value / norm for value in vector]

    @staticmethod
    def _tokenize(text: str) -> list[str]:
        normalized = " ".join(text.lower().split())
        words = re.findall(r"[\w\u4e00-\u9fff]+", normalized)
        tokens = list(words)
        for word in words:
            if len(word) > 1:
                tokens.extend(word[index : index + 2] for index in range(len(word) - 1))
        return tokens


class SentenceTransformerProvider(EmbeddingProvider):
    def __init__(self, model_name: str) -> None:
        try:
            from sentence_transformers import (  # type: ignore[import-not-found,unused-ignore]
                SentenceTransformer,
            )
        except ImportError as exc:
            raise RuntimeError(
                "sentence-transformers is not installed. Install the 'ml' extra first."
            ) from exc
        self._model: Any = SentenceTransformer(model_name)
        dimension = self._model.get_sentence_embedding_dimension()
        if dimension is None:
            raise RuntimeError("SentenceTransformer model did not report an embedding dimension.")
        self._dimension = int(dimension)
        self._model_name = model_name

    @property
    def name(self) -> str:
        return self._model_name

    @property
    def dimension(self) -> int:
        return self._dimension

    def embed(self, text: str) -> list[float]:
        vector = self._model.encode(text, normalize_embeddings=True)
        return [float(value) for value in vector]


class OpenAIEmbeddingProvider(EmbeddingProvider):
    """OpenAI-compatible embedding endpoint, including Qwen-compatible services."""

    def __init__(self, *, base_url: str, api_key: str, model_name: str, dimension: int) -> None:
        normalized = base_url.rstrip("/")
        if normalized.endswith("/chat/completions"):
            normalized = normalized.removesuffix("/chat/completions")
        self._url = normalized if normalized.endswith("/embeddings") else normalized + "/embeddings"
        self._api_key, self._model_name, self._dimension = api_key, model_name, dimension

    @property
    def name(self) -> str:
        return self._model_name

    @property
    def dimension(self) -> int:
        return self._dimension

    @property
    def endpoint_identity(self) -> str:
        from urllib.parse import urlsplit

        parsed = urlsplit(self._url)
        port = f":{parsed.port}" if parsed.port else ""
        return f"{parsed.scheme}://{parsed.hostname}{port}{parsed.path}"

    def embed(self, text: str) -> list[float]:
        return self.embed_many([text])[0]

    def embed_many(self, texts: list[str]) -> list[list[float]]:
        import httpx

        response = httpx.post(
            self._url,
            headers={"authorization": f"Bearer {self._api_key}"},
            json={"model": self._model_name, "input": texts, "dimensions": self._dimension},
            timeout=60.0,
        )
        response.raise_for_status()
        payload = response.json()
        self.last_response_metadata = {
            "model": payload.get("model"),
            "usage": payload.get("usage") or {},
        }
        data = payload.get("data")
        if not isinstance(data, list) or len(data) != len(texts):
            raise RuntimeError("Embedding provider returned an unexpected item count")
        indices = [item.get("index") if isinstance(item, dict) else None for item in data]
        if any(type(index) is not int for index in indices) or sorted(indices) != list(
            range(len(texts))
        ):
            raise RuntimeError("Embedding provider returned duplicate, missing or invalid indices")
        returned_model = payload.get("model")
        if returned_model is not None and returned_model != self._model_name:
            raise RuntimeError("Embedding provider returned a different model")
        return [
            validate_embedding(item.get("embedding"), self._dimension)
            for item in sorted(data, key=lambda value: value["index"])
        ]


def validate_embedding(vector: Any, dimension: int) -> list[float]:
    """Reject malformed embeddings rather than padding, truncating or normalizing them."""
    if (
        not isinstance(vector, list)
        or len(vector) != dimension
        or any(type(value) not in (int, float) or not math.isfinite(value) for value in vector)
    ):
        raise RuntimeError("Embedding contains invalid values or wrong dimension")
    values = [float(value) for value in vector]
    norm = math.sqrt(sum(value * value for value in values))
    if not math.isfinite(norm) or norm == 0:
        raise RuntimeError("Embedding has zero or non-finite norm")
    return values


@lru_cache(maxsize=1)
def get_embedding_provider() -> EmbeddingProvider:
    settings = get_settings()
    provider = settings.embedding_provider.strip().lower()
    if provider in {"hash", "local-hash"}:
        return HashEmbeddingProvider(settings.embedding_dim)
    if provider in {"sentence-transformers", "bge", "bge-m3"}:
        return SentenceTransformerProvider(settings.embedding_model)
    if provider in {"openai", "openai-compatible", "qwen"}:
        base_url = settings.openai_embedding_base_url or settings.llm_base_url
        if not base_url and settings.dashscope_workspace_id:
            base_url = (
                f"https://{settings.dashscope_workspace_id}.{settings.dashscope_region}.maas.aliyuncs.com/"
                "compatible-mode/v1"
            )
        api_key = (
            settings.openai_embedding_api_key or settings.dashscope_api_key or settings.llm_api_key
        )
        if not base_url or not api_key:
            raise ValueError("OPENAI_EMBEDDING_BASE_URL and OPENAI_EMBEDDING_API_KEY are required")
        return OpenAIEmbeddingProvider(
            base_url=base_url,
            api_key=api_key.get_secret_value(),
            model_name=settings.openai_embedding_model,
            dimension=settings.embedding_dim,
        )
    raise ValueError(f"Unsupported EMBEDDING_PROVIDER: {settings.embedding_provider}")


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    numerator = sum(a * b for a, b in zip(left, right, strict=True))
    left_norm = math.sqrt(sum(value * value for value in left))
    right_norm = math.sqrt(sum(value * value for value in right))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return max(-1.0, min(1.0, numerator / (left_norm * right_norm)))
