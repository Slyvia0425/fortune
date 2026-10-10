import hashlib
import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.entities import CaseProfileRecord, EventRecord
from app.schemas.case import CaseFeatures, SimilarCaseItem, SimilarCaseResult
from app.services.embeddings import get_embedding_provider
from app.services.event_policy import CASE_EVENT_TYPES
from app.services.llm import get_explanation_provider
from app.services.privacy import get_or_create_privacy
from app.services.scoring import (
    CASE_ALGORITHM_VERSION,
    CASE_SIMILARITY_WEIGHTS,
    structured_similarity,
    weighted_score,
)


def maybe_create_case_profile(db: Session, user_id: str, event: EventRecord) -> None:
    if not event.inference_eligible or event.event_type not in CASE_EVENT_TYPES:
        return

    privacy = get_or_create_privacy(db, user_id)
    if not privacy.allow_anonymous_cases:
        return

    anonymized_key, features = _extract_anonymized_features(event)
    if not features or not anonymized_key:
        return

    existing = db.scalar(
        select(CaseProfileRecord).where(CaseProfileRecord.anonymized_key == anonymized_key)
    )
    if existing is not None:
        return

    embedding_text = json.dumps(features, ensure_ascii=False, sort_keys=True)
    record = CaseProfileRecord(
        id=_stable_uuid(anonymized_key),
        user_id=user_id,
        session_id=event.session_id,
        anonymized_key=anonymized_key,
        features=features,
        embedding=get_embedding_provider().embed(embedding_text),
        is_shared=True,
    )
    db.add(record)


def find_similar_cases(
    db: Session,
    features: CaseFeatures,
    *,
    top_k: int,
    threshold: float | None = None,
) -> SimilarCaseResult:
    effective_threshold = (
        get_settings().case_similarity_threshold if threshold is None else threshold
    )
    current_features = features.model_dump()
    profile_records = list(
        db.scalars(select(CaseProfileRecord).where(CaseProfileRecord.is_shared.is_(True))).all()
    )

    items: list[SimilarCaseItem] = []
    for profile in profile_records:
        feature_scores, effective_weights = _case_feature_scores(current_features, profile.features)
        if not feature_scores:
            continue
        score, _, _ = weighted_score(feature_scores, CASE_SIMILARITY_WEIGHTS)
        if score < effective_threshold:
            continue
        similarities, differences = _describe_case_match(feature_scores)
        items.append(
            SimilarCaseItem(
                case_key=profile.anonymized_key,
                score=score,
                feature_scores=feature_scores,
                effective_weights=effective_weights,
                similarities=similarities,
                key_differences=differences,
                anonymized_features=profile.features,
            )
        )

    items.sort(key=lambda item: (-item.score, item.case_key))
    selected_items = items[:top_k]
    explanation_provider = get_explanation_provider()
    for item in selected_items:
        item.explanation = explanation_provider.explain_similar_case(
            {
                "score": item.score,
                "similarities": item.similarities,
                "key_differences": item.key_differences,
                "anonymized_features": item.anonymized_features,
            }
        )
    return SimilarCaseResult(
        items=selected_items,
        threshold=effective_threshold,
        algorithm_version=CASE_ALGORITHM_VERSION,
    )


def _extract_anonymized_features(event: EventRecord) -> tuple[str | None, dict[str, Any]]:
    payload = event.payload
    if event.event_type == "module1.chart.completed":
        identifier = payload.get("chart_id")
        chart_source = payload.get("chart_features") or payload.get("features") or {}
        allowed_fields = {
            key: chart_source.get(key) if isinstance(chart_source, dict) else None
            for key in (
                "day_master",
                "five_elements",
                "strength",
                "pattern",
                "useful_god",
                "luck_cycle",
                "annual_cycle",
            )
        }
        features = {"chart_structure": _without_empty(allowed_fields)}
    elif event.event_type == "module2a.divination.completed":
        identifier = payload.get("divination_id")
        intent_value = payload.get("intent")
        topic_source: dict[str, Any] = intent_value if isinstance(intent_value, dict) else {}
        features = {
            "hexagram_path": _without_empty(
                {
                    "method": payload.get("method"),
                    "primary_hexagram": payload.get("primary_hexagram"),
                    "changed_hexagram": payload.get("changed_hexagram"),
                    "moving_lines": payload.get("moving_lines"),
                    "sign_collection": payload.get("sign_collection"),
                    "sign_no": payload.get("sign_no"),
                }
            ),
            "topic_symbol": _without_empty(
                {
                    "topic": topic_source.get("topic"),
                    "symbols": topic_source.get("symbols"),
                }
            ),
        }
    else:
        return None, {}

    if not isinstance(identifier, str) or not identifier:
        return None, {}
    material = f"{event.event_type}\n{identifier}".encode()
    return hashlib.sha256(material).hexdigest(), features


def _case_feature_scores(
    current: dict[str, Any],
    candidate: dict[str, Any],
) -> tuple[dict[str, float], dict[str, float]]:
    feature_scores: dict[str, float] = {}
    mappings = {
        "chart_structure_similarity": "chart_structure",
        "hexagram_path_similarity": "hexagram_path",
        "topic_symbol_similarity": "topic_symbol",
        "session_sequence_similarity": "session_sequence",
    }
    for score_name, feature_name in mappings.items():
        similarity = structured_similarity(current.get(feature_name), candidate.get(feature_name))
        if similarity is not None:
            feature_scores[score_name] = similarity

    _, effective_weights, _ = weighted_score(feature_scores, CASE_SIMILARITY_WEIGHTS)
    return feature_scores, effective_weights


def _describe_case_match(feature_scores: dict[str, float]) -> tuple[list[str], list[str]]:
    labels = {
        "chart_structure_similarity": "chart structure",
        "hexagram_path_similarity": "hexagram path",
        "topic_symbol_similarity": "topic and symbols",
        "session_sequence_similarity": "session sequence",
    }
    ordered = sorted(feature_scores.items(), key=lambda item: item[1], reverse=True)
    similarities = [
        f"{labels.get(name, name)} similarity is {value:.2f}" for name, value in ordered[:2]
    ]
    if len(ordered) > 1:
        name, value = ordered[-1]
        differences = [f"{labels.get(name, name)} differs most ({value:.2f})"]
    else:
        differences = ["Additional feature blocks were unavailable for comparison"]
    return similarities, differences


def _without_empty(values: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in values.items() if value not in (None, "", [], {})}


def _stable_uuid(value: str) -> str:
    digest = hashlib.sha256(value.encode()).hexdigest()
    return f"{digest[:8]}-{digest[8:12]}-{digest[12:16]}-{digest[16:20]}-{digest[20:32]}"
