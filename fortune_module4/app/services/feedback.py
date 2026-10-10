from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import AppError, NotFoundError
from app.models.base import utc_now
from app.models.entities import EventRecord, FeedbackRecord
from app.schemas.feedback import FeedbackCreate, FeedbackOut
from app.services.sessions import get_session_or_404


def create_feedback(
    db: Session,
    user_id: str,
    payload: FeedbackCreate,
) -> FeedbackRecord:
    session = None
    if payload.session_id:
        session = get_session_or_404(db, user_id, payload.session_id)
    if payload.event_id:
        event = db.scalar(
            select(EventRecord).where(
                EventRecord.id == payload.event_id,
                EventRecord.user_id == user_id,
            )
        )
        if event is None:
            raise NotFoundError("Event not found", {"event_id": payload.event_id})

    if payload.feedback_type in {"correction", "report"} and not payload.text:
        raise AppError(
            "FEEDBACK_TEXT_REQUIRED",
            "Correction and report feedback require text",
            details={"feedback_type": payload.feedback_type},
        )

    feedback_id = str(uuid4())
    record = FeedbackRecord(
        id=feedback_id,
        user_id=user_id,
        session_id=payload.session_id,
        event_id=payload.event_id,
        item_id=payload.item_id,
        source_id=payload.source_id,
        feedback_type=payload.feedback_type,
        rating=payload.rating,
        text=payload.text,
        payload=payload.payload,
        source_refs=payload.source_refs,
    )
    db.add(record)

    if session is not None:
        feedback_event = _create_feedback_event(
            db=db,
            user_id=user_id,
            session_id=session.id,
            system=session.system,
            feedback_id=feedback_id,
            payload=payload,
        )
        db.add(feedback_event)
        if not record.event_id:
            record.event_id = feedback_event.id

    db.commit()
    db.refresh(record)
    return record


def _create_feedback_event(
    *,
    db: Session,
    user_id: str,
    session_id: str,
    system: str,
    feedback_id: str,
    payload: FeedbackCreate,
) -> EventRecord:
    current_sequence = db.scalar(
        select(func.max(EventRecord.sequence_no)).where(EventRecord.session_id == session_id)
    )
    event_payload = {
        "feedback_id": feedback_id,
        "feedback_type": payload.feedback_type,
        "rating": payload.rating,
        "text": payload.text,
        "item_id": payload.item_id,
        "source_id": payload.source_id,
        "related_event_id": payload.event_id,
        **payload.payload,
    }
    return EventRecord(
        id=str(uuid4()),
        session_id=session_id,
        user_id=user_id,
        source_module="frontend",
        event_type="feedback.submitted",
        inference_eligible=True,
        sequence_no=int(current_sequence or 0) + 1,
        occurred_at=utc_now(),
        system=system,
        payload={key: value for key, value in event_payload.items() if value is not None},
        source_refs=list(dict.fromkeys(payload.source_refs)),
        schema_version="1.0",
        idempotency_key=f"feedback:{feedback_id}",
    )


def feedback_to_schema(record: FeedbackRecord) -> FeedbackOut:
    return FeedbackOut(
        feedback_id=record.id,
        user_id=record.user_id,
        session_id=record.session_id,
        event_id=record.event_id,
        item_id=record.item_id,
        source_id=record.source_id,
        feedback_type=record.feedback_type,
        rating=record.rating,
        text=record.text,
        payload=record.payload,
        source_refs=record.source_refs,
        created_at=record.created_at,
    )


def feedback_signals_for_candidates(
    db: Session,
    user_id: str,
    item_ids: list[str],
    source_ids: list[str],
) -> dict[str, float]:
    if not item_ids and not source_ids:
        return {}

    conditions = []
    if item_ids:
        conditions.append(FeedbackRecord.item_id.in_(item_ids))
    if source_ids:
        conditions.append(FeedbackRecord.source_id.in_(source_ids))

    records = list(
        db.scalars(
            select(FeedbackRecord).where(
                FeedbackRecord.user_id == user_id,
                *conditions,
            )
        ).all()
    )
    grouped: dict[str, list[float]] = {}
    for record in records:
        signal = _feedback_signal(record)
        if signal is None:
            continue
        if record.item_id:
            grouped.setdefault(f"item:{record.item_id}", []).append(signal)
        if record.source_id:
            grouped.setdefault(f"source:{record.source_id}", []).append(signal)
    return {key: sum(values) / len(values) for key, values in grouped.items()}


def _feedback_signal(record: FeedbackRecord) -> float | None:
    if record.feedback_type == "rating" and record.rating is not None:
        return max(0.0, min(1.0, record.rating / 5.0))
    if record.feedback_type in {"correction", "report"}:
        return 0.0
    if record.feedback_type in {"collection", "collect", "useful", "click"}:
        return 0.8
    if record.feedback_type in {"not_useful", "dislike"}:
        return 0.1
    return None
