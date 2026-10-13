from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class EventIngestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: str | None = Field(default=None, min_length=1, max_length=36)
    session_id: str = Field(min_length=1, max_length=36)
    user_id: str | None = Field(default=None, min_length=1, max_length=128)
    source_module: str = Field(min_length=1, max_length=64)
    event_type: str = Field(min_length=1, max_length=128)
    sequence_no: int | None = Field(default=None, ge=1)
    occurred_at: datetime | None = None
    system: str = Field(min_length=1, max_length=32)
    payload: dict[str, Any] = Field(default_factory=dict)
    source_refs: list[str] = Field(default_factory=list)
    schema_version: str = Field(default="1.0", max_length=32)


class EventOut(BaseModel):
    event_id: str
    session_id: str
    user_id: str
    source_module: str
    event_type: str
    inference_eligible: bool
    sequence_no: int
    occurred_at: datetime
    system: str
    payload: dict[str, Any]
    source_refs: list[str]
    schema_version: str
    created_at: datetime


class EventIngestResult(BaseModel):
    event: EventOut
    duplicate: bool
    idempotency_key: str | None
