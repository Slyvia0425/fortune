from collections.abc import Iterable
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.entities import EventRecord, RecommendationRecord
from app.schemas.recommendation import (
    NextActionRequest,
    RecommendationCandidate,
    RecommendationItem,
    RecommendationResult,
)
from app.services.embeddings import cosine_similarity, get_embedding_provider
from app.services.cases import CASE_EVENT_TYPES
from app.services.feedback import feedback_signals_for_candidates
from app.services.llm import get_explanation_provider
from app.services.scoring import (
    RECOMMENDATION_MODEL_VERSION,
    RECOMMENDATION_WEIGHTS,
    weighted_score,
)
from app.services.sessions import get_session_or_404

MIN_RECOMMENDATION_COVERAGE = 0.35


def recommend_next_actions(
    db: Session,
    user_id: str,
    payload: NextActionRequest,
) -> tuple[RecommendationResult, list[str], list[str], str]:
    get_session_or_404(db, user_id, payload.session_id)

    feedback_signals = feedback_signals_for_candidates(
        db=db,
        user_id=user_id,
        item_ids=[candidate.item_id for candidate in payload.candidates],
        source_ids=[
            candidate.source_id
            for candidate in payload.candidates
            if candidate.source_id is not None
        ],
    )
    current_topic = payload.current_topic
    embedding_provider = get_embedding_provider() if current_topic else None
    query_embedding = (
        embedding_provider.embed(current_topic)
        if embedding_provider is not None and current_topic is not None
        else None
    )
    explanation_provider = get_explanation_provider()
    warnings: list[str] = []

    scored: list[
        tuple[float, RecommendationCandidate, dict[str, float], dict[str, float], str]
    ] = []
    for candidate in payload.candidates:
        features = {name: getattr(candidate.features, name) for name in RECOMMENDATION_WEIGHTS}
        if (
            features["semantic_similarity"] is None
            and query_embedding
            and embedding_provider is not None
            and candidate.text
        ):
            features["semantic_similarity"] = max(
                0.0,
                cosine_similarity(query_embedding, embedding_provider.embed(candidate.text)),
            )
        if features["historical_feedback"] is None:
            features["historical_feedback"] = _candidate_feedback_signal(
                candidate, feedback_signals
            )

        score, effective_weights, available_weight = weighted_score(
            features, RECOMMENDATION_WEIGHTS
        )
        if available_weight < MIN_RECOMMENDATION_COVERAGE:
            warnings.append(f"INSUFFICIENT_FEATURES:{candidate.candidate_id}")
            continue
        reason_features = {name: value for name, value in features.items() if value is not None}
        reason = explanation_provider.explain_recommendation(
            {
                "candidate_id": candidate.candidate_id,
                "item_id": candidate.item_id,
                "title": candidate.title,
                "features": reason_features,
                "source_refs": candidate.source_refs,
            }
        )
        scored.append((score, candidate, reason_features, effective_weights, reason))

    scored.sort(key=lambda item: (-item[0], item[1].candidate_id))
    selected = scored[: payload.top_k]
    result_items: list[RecommendationItem] = []
    source_refs: set[str] = set()

    for score, candidate, features, effective_weights, reason in selected:
        recommendation_id = str(uuid4())
        candidate_refs = list(dict.fromkeys(candidate.source_refs))
        if candidate.source_id:
            source_refs.add(candidate.source_id)
        source_refs.update(candidate_refs)
        db.add(
            RecommendationRecord(
                id=recommendation_id,
                user_id=user_id,
                session_id=payload.session_id,
                item_type=candidate.item_type,
                item_id=candidate.item_id,
                source_id=candidate.source_id,
                title=candidate.title,
                score=score,
                features=features,
                reason=reason,
                model_version=f"{RECOMMENDATION_MODEL_VERSION}+{explanation_provider.name}",
                source_refs=candidate_refs,
            )
        )
        result_items.append(
            RecommendationItem(
                recommendation_id=recommendation_id,
                candidate_id=candidate.candidate_id,
                item_type=candidate.item_type,
                item_id=candidate.item_id,
                source_id=candidate.source_id,
                title=candidate.title,
                score=score,
                features={key: round(value, 6) for key, value in features.items()},
                effective_weights=effective_weights,
                reason=reason,
                source_refs=candidate_refs,
                metadata=candidate.metadata,
            )
        )

    db.commit()
    event_count = db.scalar(
        select(func.count(EventRecord.id)).where(
            EventRecord.session_id == payload.session_id,
            EventRecord.event_type.in_(CASE_EVENT_TYPES),
        )
    )
    cold_start = int(event_count or 0) <= 1 and not feedback_signals
    if not payload.candidates:
        warnings.append("NO_CANDIDATES_PROVIDED")
    result = RecommendationResult(
        items=result_items,
        top_k=payload.top_k,
        cold_start=cold_start,
        model_version=f"{RECOMMENDATION_MODEL_VERSION}+{explanation_provider.name}",
        scoring_weights=RECOMMENDATION_WEIGHTS,
    )
    return result, sorted(source_refs), warnings, result.model_version


def _candidate_feedback_signal(
    candidate: RecommendationCandidate,
    signals: dict[str, float],
) -> float | None:
    values = _existing_values(
        signals,
        [f"item:{candidate.item_id}", f"source:{candidate.source_id}"],
    )
    if not values:
        return None
    return sum(values) / len(values)


def _existing_values(mapping: dict[str, float], keys: Iterable[str | None]) -> list[float]:
    return [mapping[key] for key in keys if key and key in mapping]
