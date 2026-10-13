from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class SessionCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str | None = Field(default=None, min_length=1, max_length=36)
    system: str = Field(min_length=1, max_length=32)
    title: str | None = Field(default=None, max_length=255)
    metadata: dict[str, Any] = Field(default_factory=dict)


class SessionOut(BaseModel):
    session_id: str
    user_id: str
    system: str
    status: str
    title: str | None
    metadata: dict[str, Any]
    started_at: datetime
    ended_at: datetime | None


class SessionCreateResult(BaseModel):
    session: SessionOut
    resumed: bool


class SessionListItem(SessionOut):
    event_count: int
    conversation_count: int
    last_event_at: datetime | None
    last_message_preview: str | None
