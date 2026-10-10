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


@lru_cache(maxsize=1)
def get_embedding_provider() -> EmbeddingProvider:
    settings = get_settings()
    provider = settings.embedding_provider.strip().lower()
    if provider in {"hash", "local-hash"}:
        return HashEmbeddingProvider(settings.embedding_dim)
    if provider in {"sentence-transformers", "bge", "bge-m3"}:
        return SentenceTransformerProvider(settings.embedding_model)
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
