import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AppError, ConflictError
from app.models.entities import AuthSessionRecord, PasswordResetTokenRecord, UserRecord
from app.schemas.auth import AuthResult, RegisterRequest, UserOut

SCRYPT_N = 2**14
SCRYPT_R = 8
SCRYPT_P = 1


def _password_hash(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(
        password.encode(), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=32
    )
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${salt.hex()}${digest.hex()}"


def _password_matches(password: str, encoded: str) -> bool:
    try:
        algorithm, n, r, p, salt, expected = encoded.split("$", 5)
        if algorithm != "scrypt":
            return False
        digest = hashlib.scrypt(
            password.encode(),
            salt=bytes.fromhex(salt),
            n=int(n),
            r=int(r),
            p=int(p),
            dklen=32,
        )
        return hmac.compare_digest(digest.hex(), expected)
    except (ValueError, TypeError):
        return False


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def user_schema(user: UserRecord) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        status=user.status,
        created_at=user.created_at,
    )


def _create_session(db: Session, user: UserRecord) -> AuthResult:
    token = secrets.token_urlsafe(48)
    expires_at = datetime.now(UTC) + timedelta(days=get_settings().auth_session_days)
    db.add(
        AuthSessionRecord(
            id=str(uuid4()),
            user_id=user.id,
            token_hash=_token_hash(token),
            expires_at=expires_at,
        )
    )
    db.commit()
    return AuthResult(user=user_schema(user), session_token=token, expires_at=expires_at)


def register_user(db: Session, payload: RegisterRequest) -> AuthResult:
    email = payload.email.strip().lower()
    if db.scalar(select(UserRecord.id).where(UserRecord.email == email)):
        raise ConflictError("该邮箱已经注册")
    user = UserRecord(
        id=str(uuid4()),
        email=email,
        password_hash=_password_hash(payload.password),
        display_name=payload.display_name.strip(),
        status="active",
    )
    db.add(user)
    db.flush()
    return _create_session(db, user)


def login_user(db: Session, email: str, password: str) -> AuthResult:
    user = db.scalar(select(UserRecord).where(UserRecord.email == email.strip().lower()))
    if not user or not _password_matches(password, user.password_hash):
        raise AppError("INVALID_CREDENTIALS", "邮箱或密码不正确", status_code=401)
    if user.status != "active":
        raise AppError("ACCOUNT_DISABLED", "该账户当前不可用", status_code=403)
    return _create_session(db, user)


def session_user(db: Session, token: str) -> UserRecord | None:
    now = datetime.now(UTC)
    record = db.scalar(
        select(AuthSessionRecord).where(
            AuthSessionRecord.token_hash == _token_hash(token),
            AuthSessionRecord.expires_at > now,
        )
    )
    if not record:
        return None
    user = db.get(UserRecord, record.user_id)
    if not user or user.status != "active":
        return None
    record.last_seen_at = now
    db.commit()
    return user


def revoke_session(db: Session, token: str) -> None:
    record = db.scalar(
        select(AuthSessionRecord).where(AuthSessionRecord.token_hash == _token_hash(token))
    )
    if record:
        db.delete(record)
        db.commit()


def request_password_reset(db: Session, email: str) -> str | None:
    user = db.scalar(select(UserRecord).where(UserRecord.email == email.strip().lower()))
    if not user:
        return None
    token = secrets.token_urlsafe(48)
    db.add(
        PasswordResetTokenRecord(
            id=str(uuid4()),
            user_id=user.id,
            token_hash=_token_hash(token),
            expires_at=datetime.now(UTC) + timedelta(minutes=30),
        )
    )
    db.commit()
    return token


def reset_password(db: Session, token: str, password: str) -> None:
    record = db.scalar(
        select(PasswordResetTokenRecord).where(
            PasswordResetTokenRecord.token_hash == _token_hash(token),
            PasswordResetTokenRecord.expires_at > datetime.now(UTC),
            PasswordResetTokenRecord.used_at.is_(None),
        )
    )
    if not record:
        raise AppError("INVALID_RESET_TOKEN", "重置链接无效或已过期", status_code=400)
    user = db.get(UserRecord, record.user_id)
    if not user:
        raise AppError("INVALID_RESET_TOKEN", "重置链接无效或已过期", status_code=400)
    user.password_hash = _password_hash(password)
    record.used_at = datetime.now(UTC)
    db.execute(delete(AuthSessionRecord).where(AuthSessionRecord.user_id == user.id))
    db.commit()
