from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AppError, ConflictError
from app.models.base import utc_now
from app.models.entities import EventRecord
from app.schemas.event import EventIngestRequest, EventOut
from app.services.cases import maybe_create_case_profile
from app.services.event_policy import participates_in_inference
from app.services.sessions import get_or_create_session_for_event


def ingest_event(
    db: Session,
    user_id: str,
    payload: EventIngestRequest,
    idempotency_key: str | None,
) -> tuple[EventRecord, bool, str | None]:
    if payload.user_id and payload.user_id != user_id:
        raise AppError(
            "USER_MISMATCH",
            "The event user_id does not match the authenticated user",
            status_code=403,
            details={"authenticated_user_id": user_id},
        )

    candidate_key = idempotency_key or payload.event_id
    if candidate_key:
        duplicate = _find_duplicate(db, user_id, candidate_key, payload.event_id)
        if duplicate is not None:
            return duplicate, True, candidate_key

    session = get_or_create_session_for_event(
        db=db,
        user_id=user_id,
        session_id=payload.session_id,
        system=payload.system,
    )
    sequence_no = payload.sequence_no or _next_sequence_no(db, payload.session_id)
    occurred_at = _ensure_timezone(payload.occurred_at) if payload.occurred_at else utc_now()

    event = EventRecord(
        id=payload.event_id or str(uuid4()),
        session_id=payload.session_id,
        user_id=user_id,
        source_module=payload.source_module,
        event_type=payload.event_type,
        inference_eligible=participates_in_inference(payload.event_type),
        sequence_no=sequence_no,
        occurred_at=occurred_at,
        system=payload.system,
        payload=payload.payload,
        source_refs=payload.source_refs,
        schema_version=payload.schema_version,
        idempotency_key=candidate_key,
    )
    db.add(event)

    try:
        db.flush()
        maybe_create_case_profile(db, user_id=user_id, event=event)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if candidate_key:
            duplicate = _find_duplicate(db, user_id, candidate_key, payload.event_id)
            if duplicate is not None:
                return duplicate, True, candidate_key
        raise ConflictError("Event could not be stored", {"reason": str(exc.orig)}) from exc

    db.refresh(event)
    if session.status == "ended":
        session.status = "active"
        session.ended_at = None
        db.add(session)
        db.commit()
    return event, False, candidate_key


def list_session_events(
    db: Session,
    session_id: str,
    *,
    inference_only: bool = False,
) -> list[EventRecord]:
    conditions = [EventRecord.session_id == session_id]
    if inference_only:
        conditions.append(EventRecord.inference_eligible.is_(True))
    return list(
        db.scalars(
            select(EventRecord)
            .where(*conditions)
            .order_by(
                EventRecord.sequence_no.asc(),
                EventRecord.occurred_at.asc(),
                EventRecord.created_at.asc(),
            )
        ).all()
    )


def event_to_schema(record: EventRecord) -> EventOut:
    return EventOut(
        event_id=record.id,
        session_id=record.session_id,
        user_id=record.user_id,
        source_module=record.source_module,
        event_type=record.event_type,
        inference_eligible=record.inference_eligible,
        sequence_no=record.sequence_no,
        occurred_at=record.occurred_at,
        system=record.system,
        payload=record.payload,
        source_refs=record.source_refs,
        schema_version=record.schema_version,
        created_at=record.created_at,
    )


def _find_duplicate(
    db: Session,
    user_id: str,
    idempotency_key: str,
    event_id: str | None,
) -> EventRecord | None:
    conditions = (EventRecord.user_id == user_id) & (
        (EventRecord.idempotency_key == idempotency_key)
        | (EventRecord.id == event_id if event_id else False)
    )
    return db.scalar(select(EventRecord).where(conditions))


def _next_sequence_no(db: Session, session_id: str) -> int:
    current = db.scalar(
        select(func.max(EventRecord.sequence_no)).where(EventRecord.session_id == session_id)
    )
    return int(current or 0) + 1


def _ensure_timezone(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value
