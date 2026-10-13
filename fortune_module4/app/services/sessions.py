from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ConflictError, NotFoundError
from app.models.entities import EventRecord, SessionRecord
from app.schemas.session import SessionCreateRequest, SessionListItem, SessionOut
from app.services.event_policy import is_conversation_message


def create_or_resume_session(
    db: Session,
    user_id: str,
    payload: SessionCreateRequest,
) -> tuple[SessionRecord, bool]:
    if payload.session_id:
        existing = db.get(SessionRecord, payload.session_id)
        if existing is not None:
            if existing.user_id != user_id:
                raise ConflictError("Session id is already in use")
            return existing, True

    session_id = payload.session_id or str(uuid4())
    record = SessionRecord(
        id=session_id,
        user_id=user_id,
        system=payload.system,
        status="active",
        title=payload.title,
        metadata_json=payload.metadata,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record, False


def get_session_or_404(db: Session, user_id: str, session_id: str) -> SessionRecord:
    record = db.scalar(
        select(SessionRecord).where(
            SessionRecord.id == session_id,
            SessionRecord.user_id == user_id,
        )
    )
    if record is None:
        raise NotFoundError("Session not found", {"session_id": session_id})
    return record


def list_sessions_with_activity(
    db: Session,
    user_id: str,
    *,
    limit: int = 50,
) -> list[SessionListItem]:
    records = list(
        db.scalars(
            select(SessionRecord)
            .where(SessionRecord.user_id == user_id)
            .order_by(SessionRecord.started_at.desc(), SessionRecord.id.desc())
            .limit(limit)
        ).all()
    )

    items: list[SessionListItem] = []
    for record in records:
        events = list(
            db.scalars(
                select(EventRecord)
                .where(EventRecord.session_id == record.id)
                .order_by(
                    EventRecord.sequence_no.asc(),
                    EventRecord.occurred_at.asc(),
                    EventRecord.created_at.asc(),
                )
            ).all()
        )
        conversation_messages = [
            event for event in events if is_conversation_message(event.event_type)
        ]
        preview: str | None = None
        if conversation_messages:
            content = conversation_messages[-1].payload.get("content")
            if isinstance(content, str) and content.strip():
                preview = content.strip()[:160]

        items.append(
            SessionListItem(
                **session_to_schema(record).model_dump(),
                event_count=len(events),
                conversation_count=len(conversation_messages),
                last_event_at=events[-1].occurred_at if events else None,
                last_message_preview=preview,
            )
        )
    return items


def get_or_create_session_for_event(
    db: Session,
    user_id: str,
    session_id: str,
    system: str,
) -> SessionRecord:
    record = db.scalar(
        select(SessionRecord).where(
            SessionRecord.id == session_id,
            SessionRecord.user_id == user_id,
        )
    )
    if record is not None:
        return record

    other_user_session = db.get(SessionRecord, session_id)
    if other_user_session is not None:
        raise ConflictError("Session id belongs to another user")

    record = SessionRecord(
        id=session_id,
        user_id=user_id,
        system=system,
        status="active",
        metadata_json={"created_by": "event_ingestion"},
    )
    db.add(record)
    db.flush()
    return record


def session_to_schema(record: SessionRecord) -> SessionOut:
    return SessionOut(
        session_id=record.id,
        user_id=record.user_id,
        system=record.system,
        status=record.status,
        title=record.title,
        metadata=record.metadata_json,
        started_at=record.started_at,
        ended_at=record.ended_at,
    )
