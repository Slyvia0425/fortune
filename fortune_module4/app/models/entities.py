from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from app.core.config import get_settings
from app.models.base import Base, TimestampMixin, utc_now
from app.models.types import EmbeddingVector

settings = get_settings()


class UserRecord(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(512), nullable=False)
    display_name: Mapped[str] = mapped_column(String(80), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="active", index=True, nullable=False)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AuthSessionRecord(Base):
    __tablename__ = "auth_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class PasswordResetTokenRecord(Base):
    __tablename__ = "password_reset_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class SessionRecord(Base, TimestampMixin):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(128), index=True, nullable=False)
    system: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class EventRecord(Base):
    __tablename__ = "session_events"
    __table_args__ = (
        UniqueConstraint("user_id", "idempotency_key", name="uq_event_user_idempotency"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        ForeignKey("sessions.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[str] = mapped_column(String(128), index=True, nullable=False)
    source_module: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    event_type: Mapped[str] = mapped_column(String(128), index=True, nullable=False)
    sequence_no: Mapped[int] = mapped_column(Integer, nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    system: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    source_refs: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    schema_version: Mapped[str] = mapped_column(String(32), default="1.0", nullable=False)
    idempotency_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )


class RecommendationRecord(Base):
    __tablename__ = "recommendations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(128), index=True, nullable=False)
    session_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    item_type: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    item_id: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    source_id: Mapped[str | None] = mapped_column(String(255), index=True, nullable=True)
    title: Mapped[str | None] = mapped_column(String(512), nullable=True)
    score: Mapped[float] = mapped_column(Float, nullable=False)
    features: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    model_version: Mapped[str] = mapped_column(String(128), nullable=False)
    source_refs: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )


class FeedbackRecord(Base):
    __tablename__ = "feedback"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(128), index=True, nullable=False)
    session_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    event_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    item_id: Mapped[str | None] = mapped_column(String(255), index=True, nullable=True)
    source_id: Mapped[str | None] = mapped_column(String(255), index=True, nullable=True)
    feedback_type: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    rating: Mapped[float | None] = mapped_column(Float, nullable=True)
    text: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    source_refs: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )


class CaseProfileRecord(Base):
    __tablename__ = "case_profiles"
    __table_args__ = (UniqueConstraint("anonymized_key", name="uq_case_profile_anonymized_key"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(128), index=True, nullable=False)
    session_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    anonymized_key: Mapped[str] = mapped_column(String(128), nullable=False)
    features: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    embedding: Mapped[list[float] | None] = mapped_column(
        EmbeddingVector(settings.embedding_dim), nullable=True
    )
    is_shared: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )


class CollectionRecord(Base):
    __tablename__ = "collections"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(128), index=True, nullable=False)
    item_type: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    source_id: Mapped[str | None] = mapped_column(String(255), index=True, nullable=True)
    snapshot_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    title: Mapped[str | None] = mapped_column(String(512), nullable=True)
    source_metadata: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )


class NoteRecord(Base, TimestampMixin):
    __tablename__ = "notes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(128), index=True, nullable=False)
    source_id: Mapped[str | None] = mapped_column(String(255), index=True, nullable=True)
    collection_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    source_refs: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)


class TagRecord(Base):
    __tablename__ = "tags"
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_tag_user_name"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(128), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )


class PersonProfileRecord(Base, TimestampMixin):
    __tablename__ = "person_profiles"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_person_profile_user_name"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(128), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    relation: Mapped[str | None] = mapped_column(String(64), nullable=True)
    gender: Mapped[str | None] = mapped_column(String(32), nullable=True)
    calendar: Mapped[str | None] = mapped_column(String(16), nullable=True)
    birth_date: Mapped[str | None] = mapped_column(String(32), nullable=True)
    birth_time: Mapped[str | None] = mapped_column(String(16), nullable=True)
    birth_place: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    chart_snapshot: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class PrivacySettingsRecord(Base, TimestampMixin):
    __tablename__ = "privacy_settings"

    user_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    consent_scopes: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    retention_policy: Mapped[str] = mapped_column(String(64), default="standard", nullable=False)
    allow_anonymous_cases: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    allow_shared_training: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    export_requested_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    delete_requested_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class ExportJobRecord(Base):
    __tablename__ = "export_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(128), index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="completed", nullable=False)
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
