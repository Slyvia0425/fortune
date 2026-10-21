from datetime import UTC, datetime
from typing import Any, Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import ErrorDetail

T = TypeVar("T")


class CompatSourceRef(BaseModel):
    source_id: str
    title: str
    edition: str | None = None
    chapter: str | None = None
    page: str | None = None
    url: str | None = None


class CompatMeta(BaseModel):
    mock: bool = False
    version: str = "1.0.0"
    generated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class CompatEnvelope(BaseModel, Generic[T]):
    model_config = ConfigDict(extra="forbid")

    result: T | None = None
    system: str
    source_refs: list[CompatSourceRef] = Field(default_factory=list)
    session_id: str | None = None
    warnings: list[str] = Field(default_factory=list)
    error: ErrorDetail | None = None
    meta: CompatMeta = Field(default_factory=CompatMeta)


class UpstreamSessionEventRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    session_id: str = Field(min_length=1, max_length=36)
    event_type: str = Field(min_length=1, max_length=128)
    module: str = Field(min_length=1, max_length=32)
    payload: dict[str, Any] = Field(default_factory=dict)
    occurred_at: datetime | None = None
    event_id: str | None = Field(default=None, max_length=36)
    user_id: str | None = Field(default=None, max_length=128)
    source_module: str | None = Field(default=None, max_length=64)
    sequence_no: int | None = Field(default=None, ge=1)
    system: str | None = Field(default=None, max_length=32)
    source_refs: list[str] = Field(default_factory=list)
    schema_version: str = Field(default="1.0", max_length=32)


class UpstreamNoteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    note_id: str | None = Field(default=None, max_length=36)
    user_id: str | None = Field(default=None, max_length=128)
    title: str = Field(default="", max_length=255)
    content: str = Field(default="", max_length=100_000)
    tags: list[str] = Field(default_factory=list, max_length=50)
    source_ref: str | None = Field(default=None, max_length=255)
    source_id: str | None = Field(default=None, max_length=255)
    collection_id: str | None = Field(default=None, max_length=36)
    source_refs: list[str] = Field(default_factory=list)
    action: Literal["create", "update", "delete"] = "create"


class CompatEventData(BaseModel):
    accepted: bool
    event_count: int
    event_id: str
    duplicate: bool
    idempotency_key: str | None
    inference_eligible: bool


class CompatNoteData(BaseModel):
    note_id: str
    title: str
    content: str
    tags: list[str]
    source_ref: str | None
    updated_at: datetime


class CompatDeleteData(BaseModel):
    deleted: bool
    note_id: str


def compat_source_refs(values: list[str]) -> list[CompatSourceRef]:
    return [CompatSourceRef(source_id=value, title=value) for value in values]


def compat_success(
    result: T,
    *,
    system: str,
    source_refs: list[str] | None = None,
    session_id: str | None = None,
    warnings: list[str] | None = None,
) -> CompatEnvelope[T]:
    return CompatEnvelope[T](
        result=result,
        system=system,
        source_refs=compat_source_refs(source_refs or []),
        session_id=session_id,
        warnings=warnings or [],
        error=None,
    )


def compat_failure(
    *,
    system: str,
    code: str,
    message: str,
    details: dict[str, Any] | None = None,
) -> CompatEnvelope[None]:
    return CompatEnvelope[None](
        result=None,
        system=system,
        error=ErrorDetail(code=code, message=message, details=details or {}),
    )
