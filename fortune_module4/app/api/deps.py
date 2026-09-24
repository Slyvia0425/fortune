from typing import Annotated

from fastapi import Depends, Header
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.core.errors import AppError
from app.services.auth import session_user

DatabaseSession = Annotated[Session, Depends(get_db)]


def get_current_user_id(
    db: DatabaseSession,
    authorization: Annotated[str | None, Header()] = None,
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
    settings: Annotated[Settings, Depends(get_settings)] = None,  # type: ignore[assignment]
) -> str:
    if authorization and authorization.startswith("Bearer "):
        user = session_user(db, authorization.removeprefix("Bearer ").strip())
        if user:
            return user.id
        raise AppError("UNAUTHORIZED", "Session is invalid or expired", status_code=401)
    if settings.allow_legacy_user_header and x_user_id and x_user_id.strip():
        return x_user_id.strip()
    if settings.require_user_header:
        raise AppError(
            "UNAUTHORIZED",
            "X-User-Id is required",
            status_code=401,
        )
    return settings.dev_user_id


CurrentUserId = Annotated[str, Depends(get_current_user_id)]
