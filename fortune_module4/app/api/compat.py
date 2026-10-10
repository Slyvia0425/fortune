from typing import Annotated, Any
from uuid import uuid4

from fastapi import APIRouter, Header
from fastapi.responses import JSONResponse

from app.api.deps import DatabaseSession
from app.core.config import get_settings
from app.core.errors import AppError
from app.schemas.compat import (
    CompatDeleteData,
    CompatEnvelope,
    CompatEventData,
    CompatNoteData,
    UpstreamNoteRequest,
    UpstreamSessionEventRequest,
    compat_failure,
    compat_success,
)
from app.schemas.event import EventIngestRequest
from app.schemas.personal import NoteCreate
from app.services.events import ingest_event, list_session_events
from app.services.personal import delete_note, note_to_schema, upsert_note
from app.services.source_ids import stable_source_id_from_url

router = APIRouter(tags=["compatibility"])

SYSTEM_BY_MODULE = {
    "bazi": "bazi",
    "divination": "divination",
    "guanyin": "sign",
    "knowledge": "knowledge",
}

EVENT_TYPE_MAP = {
    "question": "frontend.question.asked",
    "supplement": "frontend.supplement.added",
    "calculation": "frontend.calculation.completed",
    "interpretation": "frontend.interpretation.viewed",
    "visualization": "frontend.visualization.viewed",
    "knowledge_read": "knowledge.item.opened",
    "feedback": "feedback.submitted",
}


def _json_response(envelope: CompatEnvelope[Any]) -> JSONResponse:
    content = envelope.model_dump(mode="json")
    content["source_refs"] = [
        {key: value for key, value in source.items() if value is not None}
        for source in content["source_refs"]
    ]
    if content["result"] is not None:
        content["result"] = {
            key: value for key, value in content["result"].items() if value is not None
        }
    return JSONResponse(content=content)


def _error_response(
    exc: AppError,
    *,
    system: str,
) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=compat_failure(
            system=system,
            code=exc.code,
            message=exc.message,
            details=exc.details,
        ).model_dump(mode="json"),
    )


def _resolve_user_id(header_user_id: str | None, body_user_id: str | None) -> str:
    settings = get_settings()
    header_value = header_user_id.strip() if header_user_id else None
    body_value = body_user_id.strip() if body_user_id else None

    if header_value and body_value and header_value != body_value:
        raise AppError(
            "USER_MISMATCH",
            "The request user_id does not match X-User-Id",
            status_code=403,
        )
    if settings.require_user_header and not header_value:
        raise AppError("UNAUTHORIZED", "X-User-Id is required", status_code=401)
    return header_value or body_value or settings.dev_user_id


def _normalize_event_type(event_type: str) -> str:
    normalized = event_type.strip()
    if normalized in EVENT_TYPE_MAP:
        return EVENT_TYPE_MAP[normalized]
    if "." in normalized:
        return normalized
    return f"frontend.{normalized}"


def _canonical_source_ref(value: str) -> str:
    normalized = value.strip()
    if normalized.startswith(("http://", "https://")):
        return stable_source_id_from_url(normalized)
    return normalized


def _collect_source_refs(explicit: list[str], payload: dict[str, Any]) -> list[str]:
    values = [_canonical_source_ref(value) for value in explicit if value and value.strip()]
    for key in ("source_refs", "source_ids"):
        raw = payload.get(key)
        if isinstance(raw, list):
            values.extend(
                _canonical_source_ref(str(value)) for value in raw if str(value).strip()
            )
    for key in ("source_ref", "source_id"):
        raw = payload.get(key)
        if isinstance(raw, str) and raw.strip():
            values.append(_canonical_source_ref(raw))
    return list(dict.fromkeys(values))


@router.post("/api/session/event", response_model=CompatEnvelope[CompatEventData])
def compatibility_ingest_event(
    payload: UpstreamSessionEventRequest,
    db: DatabaseSession,
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
    idempotency_key: Annotated[str | None, Header(alias="X-Idempotency-Key")] = None,
) -> JSONResponse:
    try:
        user_id = _resolve_user_id(x_user_id, payload.user_id)
        module_name = payload.module.strip().lower()
        event_payload = dict(payload.payload)
        event_payload.setdefault("frontend_module", module_name)
        event_payload["frontend_event_type"] = payload.event_type
        request = EventIngestRequest(
            event_id=payload.event_id or str(uuid4()),
            session_id=payload.session_id,
            user_id=user_id,
            source_module=payload.source_module or "frontend",
            event_type=_normalize_event_type(payload.event_type),
            sequence_no=payload.sequence_no,
            occurred_at=payload.occurred_at,
            system=payload.system or SYSTEM_BY_MODULE.get(module_name, "unknown"),
            payload=event_payload,
            source_refs=_collect_source_refs(payload.source_refs, payload.payload),
            schema_version=payload.schema_version,
        )
        record, duplicate, effective_key = ingest_event(
            db=db,
            user_id=user_id,
            payload=request,
            idempotency_key=idempotency_key,
        )
        event_count = len(list_session_events(db, record.session_id))
        result = CompatEventData(
            accepted=True,
            event_count=event_count,
            event_id=record.id,
            duplicate=duplicate,
            idempotency_key=effective_key,
            inference_eligible=record.inference_eligible,
        )
        return _json_response(
            compat_success(
                result,
                system="session-event-v1",
                session_id=record.session_id,
                source_refs=record.source_refs,
            )
        )
    except AppError as exc:
        return _error_response(exc, system="session-event-v1")


@router.post("/api/user/notes", response_model=CompatEnvelope[CompatNoteData | CompatDeleteData])
def compatibility_save_note(
    payload: UpstreamNoteRequest,
    db: DatabaseSession,
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
) -> JSONResponse:
    try:
        user_id = _resolve_user_id(x_user_id, payload.user_id)

        if payload.action == "delete":
            if not payload.note_id:
                raise AppError(
                    "VALIDATION_ERROR",
                    "Deleting a note requires note_id",
                    status_code=422,
                )
            delete_note(db, user_id, payload.note_id)
            return _json_response(
                compat_success(
                    CompatDeleteData(deleted=True, note_id=payload.note_id),
                    system="user-notes-v1",
                )
            )

        title = payload.title.strip()
        content = payload.content.strip()
        if not title or not content:
            raise AppError(
                "VALIDATION_ERROR",
                "Creating or updating a note requires title and content",
                status_code=422,
            )

        source_value = (payload.source_id or payload.source_ref or "").strip()
        source_id = _canonical_source_ref(source_value) if source_value else None
        note_refs = list(
            dict.fromkeys(
                [
                    ref.strip()
                    for ref in payload.source_refs
                    if ref and ref.strip()
                ]
                + ([source_id] if source_id else [])
            )
        )
        record = upsert_note(
            db,
            user_id,
            NoteCreate(
                note_id=payload.note_id,
                source_id=source_id,
                collection_id=payload.collection_id,
                title=title,
                body=content,
                tags=[tag.strip() for tag in payload.tags if tag.strip()],
                source_refs=note_refs,
            ),
        )
        note = note_to_schema(record)
        result = CompatNoteData(
            note_id=note.note_id,
            title=note.title or title,
            content=note.body,
            tags=note.tags,
            source_ref=note.source_id,
            updated_at=note.updated_at,
        )
        return _json_response(
            compat_success(
                result,
                system="user-notes-v1",
                source_refs=note.source_refs,
            )
        )
    except AppError as exc:
        return _error_response(exc, system="user-notes-v1")
