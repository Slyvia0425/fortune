"""Stage-four, auditable hybrid retrieval for the Liuyao review corpus.

This module indexes review material but never upgrades it to production evidence.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from pathlib import Path
from typing import Any

from app.core.config import get_settings
from app.services.embeddings import (
    EmbeddingProvider,
    HashEmbeddingProvider,
    OpenAIEmbeddingProvider,
    cosine_similarity,
    get_embedding_provider,
)

INDEX_VERSION = "liuyao-hybrid-index-v1"
TOKEN = re.compile(r"[\w\u4e00-\u9fff]+")


def _jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _tokens(text: str) -> list[str]:
    words = TOKEN.findall(text.lower())
    return words + [word[i : i + 2] for word in words for i in range(max(0, len(word) - 1))]


def _embed(text: str, dimension: int) -> list[float]:
    vector = [0.0] * dimension
    for token in _tokens(text):
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        vector[int.from_bytes(digest[:8], "big") % dimension] += 1.0 if digest[8] % 2 == 0 else -1.0
    norm = math.sqrt(sum(value * value for value in vector))
    return [value / norm for value in vector] if norm else vector


def _cosine(left: list[float], right: list[float]) -> float:
    return sum(a * b for a, b in zip(left, right, strict=True)) if len(left) == len(right) else 0.0


def build_index(
    stage2_dir: Path,
    stage3_dir: Path,
    *,
    dimension: int | None = None,
    embedding_provider: EmbeddingProvider | None = None,
) -> dict[str, Any]:
    """Materialize keyword, vector and structured views from immutable snapshots."""
    embedder = embedding_provider or (
        HashEmbeddingProvider(dimension) if dimension else get_embedding_provider()
    )
    stage2 = json.loads((stage2_dir / "manifest.json").read_text(encoding="utf-8"))
    stage3 = json.loads((stage3_dir / "manifest.json").read_text(encoding="utf-8"))
    documents: list[dict[str, Any]] = []
    for chunk in _jsonl(stage2_dir / "chunks.jsonl"):
        text = chunk["text"]
        documents.append(
            {
                "document_id": f"passage:{chunk['chunk_id']}",
                "evidence_type": "classical_passage",
                "source_id": chunk["source_id"],
                "passage_ids": chunk["passage_ids"],
                "chapter_id": chunk["chapter_id"],
                "text": text,
                "content_sha256": _hash(text),
                "keyword_terms": sorted(set(_tokens(text))),
                "quality_status": chunk["quality_status"],
                "retrieval_eligible": chunk["retrieval_eligible"],
            }
        )
    for rule in _jsonl(stage3_dir / "rules.jsonl"):
        text = "\n".join(
            str(rule.get(key, ""))
            for key in ("title", "conditions_prose", "action_prose", "exceptions_and_limits")
        )
        documents.append(
            {
                "document_id": f"rule:{rule['rule_id']}",
                "evidence_type": "liuyao_rule",
                "rule_id": rule["rule_id"],
                "rule_type": rule["rule_type"],
                "method_profile_id": rule["method_profile_id"],
                "passage_ids": rule["source_passage_ids"],
                "text": text,
                "content_sha256": _hash(text),
                "keyword_terms": sorted(set(_tokens(text))),
                "review_status": rule["review_status"],
                "production_eligible": rule["production_eligible"],
                "executable": rule["executable"],
            }
        )
    batch_size = get_settings().openai_embedding_batch_size
    for offset in range(0, len(documents), batch_size):
        batch = documents[offset : offset + batch_size]
        texts = [document["text"] for document in batch]
        if isinstance(embedder, OpenAIEmbeddingProvider):
            vectors = embedder.embed_many(texts)
        else:
            vectors = [embedder.embed(text) for text in texts]
        for document, vector in zip(batch, vectors, strict=True):
            document["vector"] = vector
    return {
        "index_version": INDEX_VERSION,
        "embedding_model": embedder.name,
        "embedding_dimension": embedder.dimension,
        "knowledge_release_id": f"stage2:{stage2['dataset_sha256']}",
        "rule_set_id": f"stage3:{stage3['proposal_sha256']}",
        "release_status": "review_only",
        "source_release_status": {
            "stage2": stage2["release_status"],
            "stage3": stage3["release_status"],
        },
        "documents": documents,
    }


def write_index(index: dict[str, Any], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(index, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    output.write_text(serialized, encoding="utf-8")
    manifest = {
        "schema_version": INDEX_VERSION,
        "release_status": index["release_status"],
        "production_retrieval_enabled": index["release_status"] == "published",
        "knowledge_release_id": index["knowledge_release_id"],
        "rule_set_id": index["rule_set_id"],
        "embedding_model": index["embedding_model"],
        "embedding_dimension": index["embedding_dimension"],
        "document_count": len(index["documents"]),
        "index_sha256": _hash(serialized),
    }
    (output.parent / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8"
    )


def retrieve(
    index: dict[str, Any],
    request: dict[str, Any],
    *,
    embedding_provider: EmbeddingProvider | None = None,
) -> dict[str, Any]:
    """Return an Evidence Pack. Production mode rejects review-only material."""
    query = str(request.get("question", "")).strip()
    if not query:
        raise ValueError("question is required")
    review_mode = bool(request.get("review_mode", False))
    wanted_method = request.get("method_profile_id")
    wanted_types = set(request.get("rule_types", []))
    if not review_mode and index["release_status"] != "published":
        return {
            "request_id": request.get("request_id"),
            "chart_hash": request.get("chart_hash"),
            "knowledge_release_id": index["knowledge_release_id"],
            "rule_set_id": index["rule_set_id"],
            "query_context": {"question": query, "candidate_ids": []},
            "facts": [],
            "supporting_evidence": [],
            "counter_evidence": [],
            "review_candidates": [],
            "gaps": ["NO_PUBLISHED_RETRIEVAL_MATERIAL"],
            "status": "evidence_insufficient",
            "retrieval_trace": [{"decision": "excluded", "reason": "REVIEW_ONLY_RELEASE"}],
        }
    query_terms = set(_tokens(query))
    embedder = embedding_provider or get_embedding_provider()
    if index["embedding_model"] == "hash-embedding-v1":
        embedder = HashEmbeddingProvider(int(index["embedding_dimension"]))
    elif embedder.name != index["embedding_model"]:
        raise ValueError("Embedding model does not match the frozen index")
    query_vector = embedder.embed(query)
    if len(query_vector) != int(index["embedding_dimension"]):
        raise ValueError("Embedding model does not match the frozen index dimension")
    trace: list[dict[str, Any]] = []
    ranked: list[dict[str, Any]] = []
    for document in index["documents"]:
        if not review_mode and not (
            document.get("production_eligible") is True
            and document.get("review_status") in {"approved", "published"}
            and document.get("source_quotes_verified") is True
            and document.get("evidence_type") != "liuyao_rule"
        ):
            trace.append(
                {
                    "document_id": document["document_id"],
                    "decision": "excluded",
                    "reason": "ENTITY_NOT_VERIFIED_USE_V2",
                }
            )
            continue
        if document["evidence_type"] == "liuyao_rule":
            if wanted_method and document["method_profile_id"] != wanted_method:
                trace.append(
                    {
                        "document_id": document["document_id"],
                        "decision": "excluded",
                        "reason": "METHOD_MISMATCH",
                    }
                )
                continue
            if wanted_types and document["rule_type"] not in wanted_types:
                trace.append(
                    {
                        "document_id": document["document_id"],
                        "decision": "excluded",
                        "reason": "RULE_TYPE_MISMATCH",
                    }
                )
                continue
        terms = set(document["keyword_terms"])
        lexical = len(query_terms & terms) / max(1, len(query_terms))
        semantic = cosine_similarity(query_vector, document["vector"])
        score = lexical * 0.55 + max(semantic, 0) * 0.45
        if score:
            ranked.append(
                {
                    **document,
                    "keyword_score": round(lexical, 6),
                    "vector_score": round(semantic, 6),
                    "score": round(score, 6),
                }
            )
    ranked.sort(key=lambda item: (-item["score"], item["document_id"]))
    candidates = ranked[:20]
    production_allowed = index["release_status"] == "published"
    supporting: list[dict[str, Any]] = []
    review_candidates: list[dict[str, Any]] = []
    for item in candidates:
        allowed = production_allowed and (
            item.get("retrieval_eligible") is True or item.get("production_eligible") is True
        )
        evidence = {
            key: item[key]
            for key in (
                "document_id",
                "evidence_type",
                "rule_id",
                "rule_type",
                "passage_ids",
                "content_sha256",
                "keyword_score",
                "vector_score",
                "score",
            )
            if key in item
        }
        if allowed:
            supporting.append(
                {**evidence, "condition_evaluation": "unknown", "quality_status": "published"}
            )
            trace.append(
                {
                    "document_id": item["document_id"],
                    "decision": "included",
                    "reason": "PUBLISHED_AND_ELIGIBLE",
                }
            )
        else:
            trace.append(
                {
                    "document_id": item["document_id"],
                    "decision": "excluded",
                    "reason": "REVIEW_ONLY_RELEASE",
                }
            )
            if review_mode:
                review_candidates.append(
                    {**evidence, "quality_status": "review_only", "not_for_interpretation": True}
                )
    return {
        "request_id": request.get("request_id"),
        "chart_hash": request.get("chart_hash"),
        "knowledge_release_id": index["knowledge_release_id"],
        "rule_set_id": index["rule_set_id"],
        "query_context": {"question": query, "candidate_ids": request.get("candidate_ids", [])},
        "facts": request.get("facts", []),
        "supporting_evidence": supporting,
        "counter_evidence": [],
        "gaps": (["NO_PUBLISHED_RETRIEVAL_MATERIAL"] if not supporting else []),
        "review_candidates": review_candidates,
        "retrieval_trace": trace,
        "status": "evidence_insufficient" if not supporting else "evidence_ready",
    }
