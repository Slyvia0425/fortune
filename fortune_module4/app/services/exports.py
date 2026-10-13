from datetime import UTC, datetime
from typing import Any, cast
from uuid import uuid4

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.entities import (
    CaseProfileRecord,
    CollectionRecord,
    EventRecord,
    ExportJobRecord,
    FeedbackRecord,
    NoteRecord,
    PersonProfileRecord,
    PrivacySettingsRecord,
    RecommendationRecord,
    SessionRecord,
    TagRecord,
)
from app.schemas.personal import DeleteDataResult, ExportJobOut
from app.services.serialization import model_list_to_dict


def export_user_data(db: Session, user_id: str) -> ExportJobOut:
    payload = {
        "schema_version": "1.0",
        "generated_at": datetime.now(UTC).isoformat(),
        "user_id": user_id,
        "sessions": model_list_to_dict(_all_for_user(db, SessionRecord, user_id)),
        "events": model_list_to_dict(_all_for_user(db, EventRecord, user_id)),
        "recommendations": model_list_to_dict(_all_for_user(db, RecommendationRecord, user_id)),
        "feedback": model_list_to_dict(_all_for_user(db, FeedbackRecord, user_id)),
        "case_profiles": model_list_to_dict(_all_for_user(db, CaseProfileRecord, user_id)),
        "collections": model_list_to_dict(_all_for_user(db, CollectionRecord, user_id)),
        "notes": model_list_to_dict(_all_for_user(db, NoteRecord, user_id)),
        "tags": model_list_to_dict(_all_for_user(db, TagRecord, user_id)),
        "person_profiles": model_list_to_dict(
            _all_for_user(db, PersonProfileRecord, user_id)
        ),
    }
    source_manifest = sorted(_collect_source_refs(payload))
    payload["source_manifest"] = source_manifest

    record = ExportJobRecord(
        id=str(uuid4()),
        user_id=user_id,
        status="completed",
        payload=payload,
        completed_at=datetime.now(UTC),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return ExportJobOut(
        export_id=record.id,
        user_id=record.user_id,
        status=record.status,
        created_at=record.created_at,
        completed_at=record.completed_at,
        source_manifest=source_manifest,
        data=payload,
    )


def delete_user_data(db: Session, user_id: str) -> DeleteDataResult:
    models: list[Any] = [
        EventRecord,
        RecommendationRecord,
        FeedbackRecord,
        CaseProfileRecord,
        NoteRecord,
        PersonProfileRecord,
        CollectionRecord,
        TagRecord,
        ExportJobRecord,
        PrivacySettingsRecord,
        SessionRecord,
    ]
    deleted_counts: dict[str, int] = {}
    for model in models:
        result = cast(Any, db.execute(delete(model).where(model.user_id == user_id)))
        deleted_counts[model.__tablename__] = int(result.rowcount or 0)
    db.commit()
    return DeleteDataResult(
        user_id=user_id,
        status="deleted",
        deleted_at=datetime.now(UTC),
        deleted_counts=deleted_counts,
    )


def _all_for_user(db: Session, model: Any, user_id: str) -> list[Any]:
    return list(db.scalars(select(model).where(model.user_id == user_id)).all())


def _collect_source_refs(value: object) -> set[str]:
    refs: set[str] = set()
    if isinstance(value, dict):
        for key, item in value.items():
            if key in {"source_id", "source_refs"}:
                if isinstance(item, str):
                    refs.add(item)
                elif isinstance(item, list):
                    refs.update(str(entry) for entry in item if entry)
            else:
                refs.update(_collect_source_refs(item))
    elif isinstance(value, list):
        for item in value:
            refs.update(_collect_source_refs(item))
    return refs
