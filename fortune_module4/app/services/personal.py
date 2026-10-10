from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ConflictError, NotFoundError
from app.models.entities import CollectionRecord, NoteRecord, PersonProfileRecord, TagRecord
from app.schemas.personal import (
    CollectionCreate,
    CollectionOut,
    CollectionUpdate,
    NoteCreate,
    NoteOut,
    PersonProfileOut,
    PersonProfileUpdate,
    PersonProfileUpsert,
    TagCreate,
    TagOut,
    TagUpdate,
)


def list_collections(db: Session, user_id: str) -> list[CollectionRecord]:
    return list(
        db.scalars(
            select(CollectionRecord)
            .where(CollectionRecord.user_id == user_id)
            .order_by(CollectionRecord.created_at.desc())
        ).all()
    )


def create_collection(
    db: Session,
    user_id: str,
    payload: CollectionCreate,
) -> CollectionRecord:
    if payload.source_id:
        existing = db.scalar(
            select(CollectionRecord).where(
                CollectionRecord.user_id == user_id,
                CollectionRecord.item_type == payload.item_type,
                CollectionRecord.source_id == payload.source_id,
            )
        )
        if existing is not None:
            return existing

    record = CollectionRecord(
        id=str(uuid4()),
        user_id=user_id,
        item_type=payload.item_type,
        source_id=payload.source_id,
        snapshot_id=payload.snapshot_id,
        title=payload.title,
        source_metadata=payload.source_metadata,
    )
    db.add(record)
    _ensure_tags(db, user_id, _collection_tags(record))
    db.commit()
    db.refresh(record)
    return record


def delete_collection(db: Session, user_id: str, collection_id: str) -> None:
    record = db.scalar(
        select(CollectionRecord).where(
            CollectionRecord.id == collection_id,
            CollectionRecord.user_id == user_id,
        )
    )
    if record is None:
        raise NotFoundError("Collection not found", {"collection_id": collection_id})
    db.delete(record)
    db.commit()


def update_collection(
    db: Session,
    user_id: str,
    collection_id: str,
    payload: CollectionUpdate,
) -> CollectionRecord:
    record = db.scalar(
        select(CollectionRecord).where(
            CollectionRecord.id == collection_id,
            CollectionRecord.user_id == user_id,
        )
    )
    if record is None:
        raise NotFoundError("Collection not found", {"collection_id": collection_id})

    metadata = dict(record.source_metadata or {})
    if payload.source_metadata is not None:
        metadata.update(payload.source_metadata)
    if payload.tags is not None:
        metadata["tags"] = _normalize_tags(payload.tags)
    if payload.category is not None:
        category = payload.category.strip()
        if category:
            metadata["category"] = category
        else:
            metadata.pop("category", None)
    record.source_metadata = metadata
    if payload.title is not None:
        record.title = payload.title.strip() or None
    if payload.tags is not None:
        _ensure_tags(db, user_id, _normalize_tags(payload.tags))
    db.commit()
    db.refresh(record)
    return record


def list_notes(db: Session, user_id: str) -> list[NoteRecord]:
    return list(
        db.scalars(
            select(NoteRecord)
            .where(NoteRecord.user_id == user_id)
            .order_by(NoteRecord.updated_at.desc())
        ).all()
    )


def upsert_note(db: Session, user_id: str, payload: NoteCreate) -> NoteRecord:
    if payload.collection_id:
        collection = db.scalar(
            select(CollectionRecord).where(
                CollectionRecord.id == payload.collection_id,
                CollectionRecord.user_id == user_id,
            )
        )
        if collection is None:
            raise NotFoundError("Collection not found", {"collection_id": payload.collection_id})

    if payload.note_id:
        record = db.scalar(
            select(NoteRecord).where(
                NoteRecord.id == payload.note_id,
                NoteRecord.user_id == user_id,
            )
        )
        if record is None:
            other_user_note = db.get(NoteRecord, payload.note_id)
            if other_user_note is not None:
                raise NotFoundError("Note not found", {"note_id": payload.note_id})
            record = NoteRecord(id=payload.note_id, user_id=user_id, body=payload.body)
            db.add(record)
    else:
        record = NoteRecord(id=str(uuid4()), user_id=user_id, body=payload.body)
        db.add(record)

    record.source_id = payload.source_id
    record.collection_id = payload.collection_id
    record.title = payload.title
    record.body = payload.body
    record.tags = _normalize_tags(payload.tags)
    record.source_refs = list(dict.fromkeys(payload.source_refs))
    _ensure_tags(db, user_id, record.tags)
    db.commit()
    db.refresh(record)
    return record


def delete_note(db: Session, user_id: str, note_id: str) -> None:
    record = db.scalar(
        select(NoteRecord).where(NoteRecord.id == note_id, NoteRecord.user_id == user_id)
    )
    if record is None:
        raise NotFoundError("Note not found", {"note_id": note_id})
    db.delete(record)
    db.commit()


def list_tags(db: Session, user_id: str) -> list[TagRecord]:
    return list(
        db.scalars(
            select(TagRecord).where(TagRecord.user_id == user_id).order_by(TagRecord.name.asc())
        ).all()
    )


def create_tag(db: Session, user_id: str, payload: TagCreate) -> TagRecord:
    name = payload.name.strip()
    existing = db.scalar(
        select(TagRecord).where(TagRecord.user_id == user_id, TagRecord.name == name)
    )
    if existing is not None:
        return existing
    record = TagRecord(id=str(uuid4()), user_id=user_id, name=name)
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def rename_tag(
    db: Session,
    user_id: str,
    tag_id: str,
    payload: TagUpdate,
) -> TagRecord:
    record = db.scalar(
        select(TagRecord).where(TagRecord.id == tag_id, TagRecord.user_id == user_id)
    )
    if record is None:
        raise NotFoundError("Tag not found", {"tag_id": tag_id})
    new_name = payload.name.strip()
    duplicate = db.scalar(
        select(TagRecord).where(
            TagRecord.user_id == user_id,
            TagRecord.name == new_name,
            TagRecord.id != tag_id,
        )
    )
    if duplicate is not None:
        raise ConflictError("Tag name already exists", {"name": new_name})
    old_name = record.name
    record.name = new_name
    _replace_tag_name(db, user_id, old_name, new_name)
    db.commit()
    db.refresh(record)
    return record


def delete_tag(db: Session, user_id: str, tag_id: str) -> None:
    record = db.scalar(
        select(TagRecord).where(TagRecord.id == tag_id, TagRecord.user_id == user_id)
    )
    if record is None:
        raise NotFoundError("Tag not found", {"tag_id": tag_id})
    _remove_tag(db, user_id, record.name)
    db.delete(record)
    db.commit()


def tag_usage_counts(db: Session, user_id: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    notes = db.scalars(select(NoteRecord).where(NoteRecord.user_id == user_id)).all()
    for note in notes:
        for tag in note.tags or []:
            counts[tag] = counts.get(tag, 0) + 1
    collections = db.scalars(
        select(CollectionRecord).where(CollectionRecord.user_id == user_id)
    ).all()
    for collection in collections:
        for tag in _collection_tags(collection):
            counts[tag] = counts.get(tag, 0) + 1
    return counts


def list_person_profiles(db: Session, user_id: str) -> list[PersonProfileRecord]:
    return list(
        db.scalars(
            select(PersonProfileRecord)
            .where(PersonProfileRecord.user_id == user_id)
            .order_by(PersonProfileRecord.updated_at.desc(), PersonProfileRecord.name.asc())
        ).all()
    )


def get_person_profile(
    db: Session,
    user_id: str,
    profile_id: str,
) -> PersonProfileRecord:
    record = db.scalar(
        select(PersonProfileRecord).where(
            PersonProfileRecord.id == profile_id,
            PersonProfileRecord.user_id == user_id,
        )
    )
    if record is None:
        raise NotFoundError("Person profile not found", {"profile_id": profile_id})
    return record


def upsert_person_profile(
    db: Session,
    user_id: str,
    payload: PersonProfileUpsert,
) -> PersonProfileRecord:
    name = payload.name.strip()
    if not name:
        raise ConflictError("Person name is required", {"name": payload.name})

    record: PersonProfileRecord | None = None
    if payload.profile_id:
        record = get_person_profile(db, user_id, payload.profile_id)
    else:
        record = db.scalar(
            select(PersonProfileRecord).where(
                PersonProfileRecord.user_id == user_id,
                PersonProfileRecord.name == name,
            )
        )

    if record is None:
        record = PersonProfileRecord(
            id=str(uuid4()),
            user_id=user_id,
            name=name,
            relation=_clean_optional(payload.relation) or "其他",
            gender=_clean_optional(payload.gender),
            calendar=_clean_optional(payload.calendar),
            birth_date=_clean_optional(payload.birth_date),
            birth_time=_clean_optional(payload.birth_time),
            birth_place=payload.birth_place,
            chart_snapshot=payload.chart_snapshot,
            tags=_normalize_tags(payload.tags),
            notes=_clean_optional(payload.notes),
        )
        db.add(record)
    else:
        record.name = name
        record.relation = _clean_optional(payload.relation) or record.relation or "其他"
        record.gender = _clean_optional(payload.gender) or record.gender
        record.calendar = _clean_optional(payload.calendar) or record.calendar
        record.birth_date = _clean_optional(payload.birth_date) or record.birth_date
        record.birth_time = _clean_optional(payload.birth_time) or record.birth_time
        if payload.birth_place:
            record.birth_place = payload.birth_place
        if payload.chart_snapshot:
            record.chart_snapshot = payload.chart_snapshot
        if payload.tags:
            record.tags = _normalize_tags(payload.tags)
        if payload.notes is not None:
            record.notes = _clean_optional(payload.notes)

    _ensure_tags(db, user_id, record.tags)
    db.commit()
    db.refresh(record)
    return record


def update_person_profile(
    db: Session,
    user_id: str,
    profile_id: str,
    payload: PersonProfileUpdate,
) -> PersonProfileRecord:
    record = get_person_profile(db, user_id, profile_id)
    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise ConflictError("Person name is required", {"name": payload.name})
        duplicate = db.scalar(
            select(PersonProfileRecord).where(
                PersonProfileRecord.user_id == user_id,
                PersonProfileRecord.name == name,
                PersonProfileRecord.id != profile_id,
            )
        )
        if duplicate is not None:
            raise ConflictError("Person name already exists", {"name": name})
        record.name = name
    if payload.relation is not None:
        record.relation = _clean_optional(payload.relation) or "其他"
    if payload.gender is not None:
        record.gender = _clean_optional(payload.gender)
    if payload.calendar is not None:
        record.calendar = _clean_optional(payload.calendar)
    if payload.birth_date is not None:
        record.birth_date = _clean_optional(payload.birth_date)
    if payload.birth_time is not None:
        record.birth_time = _clean_optional(payload.birth_time)
    if payload.birth_place is not None:
        record.birth_place = payload.birth_place
    if payload.chart_snapshot is not None:
        record.chart_snapshot = payload.chart_snapshot
    if payload.tags is not None:
        record.tags = _normalize_tags(payload.tags)
        _ensure_tags(db, user_id, record.tags)
    if payload.notes is not None:
        record.notes = _clean_optional(payload.notes)
    db.commit()
    db.refresh(record)
    return record


def delete_person_profile(db: Session, user_id: str, profile_id: str) -> None:
    record = get_person_profile(db, user_id, profile_id)
    db.delete(record)
    db.commit()


def collection_to_schema(record: CollectionRecord) -> CollectionOut:
    return CollectionOut(
        collection_id=record.id,
        user_id=record.user_id,
        item_type=record.item_type,
        source_id=record.source_id,
        snapshot_id=record.snapshot_id,
        title=record.title,
        source_metadata=record.source_metadata,
        tags=_collection_tags(record),
        category=_collection_category(record),
        created_at=record.created_at,
    )


def note_to_schema(record: NoteRecord) -> NoteOut:
    return NoteOut(
        note_id=record.id,
        user_id=record.user_id,
        source_id=record.source_id,
        collection_id=record.collection_id,
        title=record.title,
        body=record.body,
        tags=record.tags,
        source_refs=record.source_refs,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def tag_to_schema(record: TagRecord, usage_count: int = 0) -> TagOut:
    return TagOut(
        tag_id=record.id,
        name=record.name,
        usage_count=usage_count,
        created_at=record.created_at,
    )


def person_profile_to_schema(record: PersonProfileRecord) -> PersonProfileOut:
    return PersonProfileOut(
        profile_id=record.id,
        user_id=record.user_id,
        name=record.name,
        relation=record.relation,
        gender=record.gender,
        calendar=record.calendar,
        birth_date=record.birth_date,
        birth_time=record.birth_time,
        birth_place=record.birth_place or {},
        chart_snapshot=record.chart_snapshot or {},
        tags=_normalize_tags(record.tags or []),
        notes=record.notes,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def _clean_optional(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def _normalize_tags(tags: list[str]) -> list[str]:
    normalized = [tag.strip() for tag in tags if tag.strip()]
    return list(dict.fromkeys(normalized))


def _collection_tags(record: CollectionRecord) -> list[str]:
    raw = (record.source_metadata or {}).get("tags")
    if not isinstance(raw, list):
        return []
    return _normalize_tags([str(tag) for tag in raw])


def _collection_category(record: CollectionRecord) -> str | None:
    metadata = record.source_metadata or {}
    for key in ("category", "module"):
        value = metadata.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _replace_tag_name(db: Session, user_id: str, old_name: str, new_name: str) -> None:
    notes = db.scalars(select(NoteRecord).where(NoteRecord.user_id == user_id)).all()
    for note in notes:
        if old_name not in (note.tags or []):
            continue
        note.tags = _normalize_tags(
            [new_name if tag == old_name else tag for tag in note.tags]
        )
    collections = db.scalars(
        select(CollectionRecord).where(CollectionRecord.user_id == user_id)
    ).all()
    for collection in collections:
        tags = _collection_tags(collection)
        if old_name not in tags:
            continue
        metadata = dict(collection.source_metadata or {})
        metadata["tags"] = _normalize_tags(
            [new_name if tag == old_name else tag for tag in tags]
        )
        collection.source_metadata = metadata


def _remove_tag(db: Session, user_id: str, name: str) -> None:
    notes = db.scalars(select(NoteRecord).where(NoteRecord.user_id == user_id)).all()
    for note in notes:
        if name not in (note.tags or []):
            continue
        note.tags = _normalize_tags([tag for tag in note.tags if tag != name])
    collections = db.scalars(
        select(CollectionRecord).where(CollectionRecord.user_id == user_id)
    ).all()
    for collection in collections:
        tags = _collection_tags(collection)
        if name not in tags:
            continue
        metadata = dict(collection.source_metadata or {})
        metadata["tags"] = _normalize_tags([tag for tag in tags if tag != name])
        collection.source_metadata = metadata


def _ensure_tags(db: Session, user_id: str, tags: list[str]) -> None:
    if not tags:
        return
    existing = set(
        db.scalars(
            select(TagRecord.name).where(TagRecord.user_id == user_id, TagRecord.name.in_(tags))
        ).all()
    )
    for tag in tags:
        if tag not in existing:
            db.add(TagRecord(id=str(uuid4()), user_id=user_id, name=tag))
