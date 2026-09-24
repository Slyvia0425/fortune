from typing import Annotated

from fastapi import APIRouter, Header, Response, status

from app.api.deps import DatabaseSession
from app.core.errors import AppError
from app.core.config import get_settings
from app.schemas.auth import (
    AuthResult,
    LoginRequest,
    PasswordResetConfirm,
    PasswordResetRequest,
    PasswordResetRequested,
    RegisterRequest,
    UserOut,
)
from app.schemas.common import Envelope, success_envelope
from app.services.auth import (
    login_user,
    register_user,
    request_password_reset,
    reset_password,
    revoke_session,
    session_user,
    user_schema,
)

router = APIRouter(prefix="/auth", tags=["authentication"])


def bearer_token(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise AppError("UNAUTHORIZED", "Authentication required", status_code=401)
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise AppError("UNAUTHORIZED", "Authentication required", status_code=401)
    return token


@router.post("/register", response_model=Envelope[AuthResult], status_code=201)
def register(payload: RegisterRequest, db: DatabaseSession) -> Envelope[AuthResult]:
    return success_envelope(register_user(db, payload), system="auth")


@router.post("/login", response_model=Envelope[AuthResult])
def login(payload: LoginRequest, db: DatabaseSession) -> Envelope[AuthResult]:
    return success_envelope(login_user(db, payload.email, payload.password), system="auth")


@router.get("/me", response_model=Envelope[UserOut])
def me(
    db: DatabaseSession,
    authorization: Annotated[str | None, Header()] = None,
) -> Envelope[UserOut]:
    user = session_user(db, bearer_token(authorization))
    if not user:
        raise AppError("UNAUTHORIZED", "Session is invalid or expired", status_code=401)
    return success_envelope(user_schema(user), system="auth")


@router.post("/logout", status_code=204)
def logout(
    db: DatabaseSession,
    authorization: Annotated[str | None, Header()] = None,
) -> Response:
    revoke_session(db, bearer_token(authorization))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/forgot-password", response_model=Envelope[PasswordResetRequested])
def forgot_password(
    payload: PasswordResetRequest,
    db: DatabaseSession,
) -> Envelope[PasswordResetRequested]:
    token = request_password_reset(db, payload.email)
    debug_token = token if get_settings().debug else None
    return success_envelope(
        PasswordResetRequested(debug_token=debug_token),
        system="auth",
        warnings=["开发模式会返回调试令牌；生产环境必须通过邮件服务发送。"] if debug_token else [],
    )


@router.post("/reset-password", status_code=204)
def confirm_password_reset(payload: PasswordResetConfirm, db: DatabaseSession) -> Response:
    reset_password(db, payload.token, payload.password)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
