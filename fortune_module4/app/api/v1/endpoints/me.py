from fastapi import APIRouter, Query, Response, status

from app.api.deps import CurrentUserId, DatabaseSession
from app.core.errors import AppError
from app.schemas.common import Envelope, success_envelope
from app.schemas.personal import (
    AgentAnalysisOut,
    AgentAnalysisRequest,
    CollectionCreate,
    CollectionOut,
    CollectionUpdate,
    DeleteDataResult,
    ExportJobOut,
    NoteCreate,
    NoteOut,
    PersonProfileOut,
    PersonProfileUpdate,
    PersonProfileUpsert,
    PrivacyOut,
    PrivacyUpdate,
    TagCreate,
    TagOut,
    TagUpdate,
)
from app.services.analysis import analyze_personal_question
from app.services.exports import delete_user_data, export_user_data
from app.services.personal import (
    collection_to_schema,
    create_collection,
    create_tag,
    delete_collection,
    delete_note,
    delete_person_profile,
    delete_tag,
    list_collections,
    list_notes,
    list_person_profiles,
    list_tags,
    note_to_schema,
    person_profile_to_schema,
    rename_tag,
    tag_to_schema,
    tag_usage_counts,
    update_collection,
    update_person_profile,
    upsert_person_profile,
    upsert_note,
)
from app.services.privacy import (
    get_or_create_privacy,
    privacy_to_schema,
    update_privacy,
)

router = APIRouter(prefix="/me", tags=["personal"])


@router.get("/profiles", response_model=Envelope[list[PersonProfileOut]])
def get_person_profiles(
    db: DatabaseSession,
    user_id: CurrentUserId,
) -> Envelope[list[PersonProfileOut]]:
    records = [
        person_profile_to_schema(record) for record in list_person_profiles(db, user_id)
    ]
    return success_envelope(records, system="personal")


@router.post("/profiles", response_model=Envelope[PersonProfileOut])
def save_person_profile(
    payload: PersonProfileUpsert,
    db: DatabaseSession,
    user_id: CurrentUserId,
) -> Envelope[PersonProfileOut]:
    record = upsert_person_profile(db, user_id, payload)
    return success_envelope(person_profile_to_schema(record), system="personal")


@router.patch("/profiles/{profile_id}", response_model=Envelope[PersonProfileOut])
def patch_person_profile(
    profile_id: str,
    payload: PersonProfileUpdate,
    db: DatabaseSession,
    user_id: CurrentUserId,
) -> Envelope[PersonProfileOut]:
    record = update_person_profile(db, user_id, profile_id, payload)
    return success_envelope(person_profile_to_schema(record), system="personal")


@router.delete("/profiles/{profile_id}", status_code=204)
def remove_person_profile(
    profile_id: str,
    db: DatabaseSession,
    user_id: CurrentUserId,
) -> Response:
    delete_person_profile(db, user_id, profile_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/analyze", response_model=Envelope[AgentAnalysisOut])
def analyze_question(
    payload: AgentAnalysisRequest,
    db: DatabaseSession,
    user_id: CurrentUserId,
) -> Envelope[AgentAnalysisOut]:
    result = analyze_personal_question(db, user_id, payload)
    return success_envelope(
        result,
        system="personal-analysis-v1",
        source_refs=result.source_refs,
    )


@router.get("/collections", response_model=Envelope[list[CollectionOut]])
def get_collections(
    db: DatabaseSession,
    user_id: CurrentUserId,
) -> Envelope[list[CollectionOut]]:
    records = [collection_to_schema(record) for record in list_collections(db, user_id)]
    return success_envelope(records, system="personal")


@router.post("/collections", response_model=Envelope[CollectionOut], status_code=201)
def add_collection(
    payload: CollectionCreate,
    db: DatabaseSession,
    user_id: CurrentUserId,
) -> Envelope[CollectionOut]:
    record = create_collection(db, user_id, payload)
    schema = collection_to_schema(record)
    return success_envelope(
        schema,
        system="personal",
        source_refs=[record.source_id] if record.source_id else [],
    )


@router.delete("/collections/{collection_id}", status_code=204)
def remove_collection(
    collection_id: str,
    db: DatabaseSession,
    user_id: CurrentUserId,
) -> Response:
    delete_collection(db, user_id, collection_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/collections/{collection_id}", response_model=Envelope[CollectionOut])
def patch_collection(
    collection_id: str,
    payload: CollectionUpdate,
    db: DatabaseSession,
    user_id: CurrentUserId,
) -> Envelope[CollectionOut]:
    record = update_collection(db, user_id, collection_id, payload)
    return success_envelope(
        collection_to_schema(record),
        system="personal",
        source_refs=[record.source_id] if record.source_id else [],
    )


@router.get("/notes", response_model=Envelope[list[NoteOut]])
def get_notes(
    db: DatabaseSession,
    user_id: CurrentUserId,
) -> Envelope[list[NoteOut]]:
    records = [note_to_schema(record) for record in list_notes(db, user_id)]
    return success_envelope(records, system="personal")


@router.post("/notes", response_model=Envelope[NoteOut])
def save_note(
    payload: NoteCreate,
    db: DatabaseSession,
    user_id: CurrentUserId,
) -> Envelope[NoteOut]:
    record = upsert_note(db, user_id, payload)
    return success_envelope(
        note_to_schema(record),
        system="personal",
        source_refs=record.source_refs,
    )


@router.delete("/notes/{note_id}", status_code=204)
def remove_note(
    note_id: str,
    db: DatabaseSession,
    user_id: CurrentUserId,
) -> Response:
    delete_note(db, user_id, note_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/tags", response_model=Envelope[list[TagOut]])
def get_tags(
    db: DatabaseSession,
    user_id: CurrentUserId,
) -> Envelope[list[TagOut]]:
    usage = tag_usage_counts(db, user_id)
    records = [
        tag_to_schema(record, usage.get(record.name, 0)) for record in list_tags(db, user_id)
    ]
    return success_envelope(records, system="personal")


@router.post("/tags", response_model=Envelope[TagOut], status_code=201)
def add_tag(
    payload: TagCreate,
    db: DatabaseSession,
    user_id: CurrentUserId,
) -> Envelope[TagOut]:
    record = create_tag(db, user_id, payload)
    return success_envelope(tag_to_schema(record), system="personal")


@router.delete("/tags/{tag_id}", status_code=204)
def remove_tag(
    tag_id: str,
    db: DatabaseSession,
    user_id: CurrentUserId,
) -> Response:
    delete_tag(db, user_id, tag_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/tags/{tag_id}", response_model=Envelope[TagOut])
def patch_tag(
    tag_id: str,
    payload: TagUpdate,
    db: DatabaseSession,
    user_id: CurrentUserId,
) -> Envelope[TagOut]:
    record = rename_tag(db, user_id, tag_id, payload)
    usage = tag_usage_counts(db, user_id)
    return success_envelope(
        tag_to_schema(record, usage.get(record.name, 0)),
        system="personal",
    )


@router.post("/exports", response_model=Envelope[ExportJobOut], status_code=201)
def create_export(
    db: DatabaseSession,
    user_id: CurrentUserId,
) -> Envelope[ExportJobOut]:
    record = export_user_data(db, user_id)
    return success_envelope(
        record,
        system="personal",
        source_refs=record.source_manifest,
    )


@router.delete("/data", response_model=Envelope[DeleteDataResult])
def delete_data(
    db: DatabaseSession,
    user_id: CurrentUserId,
    confirm: bool = Query(default=False),
) -> Envelope[DeleteDataResult]:
    if not confirm:
        raise AppError(
            "CONFIRMATION_REQUIRED",
            "Set confirm=true to delete all private Module 4 data",
        )
    result = delete_user_data(db, user_id)
    return success_envelope(result, system="personal")


@router.get("/privacy", response_model=Envelope[PrivacyOut])
def get_privacy(
    db: DatabaseSession,
    user_id: CurrentUserId,
) -> Envelope[PrivacyOut]:
    record = get_or_create_privacy(db, user_id)
    return success_envelope(privacy_to_schema(record), system="personal")


@router.put("/privacy", response_model=Envelope[PrivacyOut])
def put_privacy(
    payload: PrivacyUpdate,
    db: DatabaseSession,
    user_id: CurrentUserId,
) -> Envelope[PrivacyOut]:
    record = update_privacy(db, user_id, payload)
    return success_envelope(privacy_to_schema(record), system="personal")
