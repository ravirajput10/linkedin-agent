"""JWT access and refresh tokens.

Access tokens are stateless and short-lived. Refresh tokens are long-lived, so
their digests are also recorded in ``refresh_tokens``; logout and admin
deactivation revoke the row, which is what makes a refresh fail immediately
rather than at expiry.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

import jwt

from app.config import settings
from app.errors import AppError, ErrorCode

TokenType = Literal["access", "refresh"]


class InvalidTokenError(AppError):
    code = ErrorCode.SESSION_EXPIRED
    http_status = 401


@dataclass(frozen=True, slots=True)
class TokenClaims:
    subject: int
    token_type: TokenType
    jti: str
    expires_at: datetime
    role: str | None = None


def _encode(
    subject: int, token_type: TokenType, expires_delta: timedelta, **extra: Any
) -> tuple[str, str, datetime]:
    now = datetime.now(UTC)
    expires_at = now + expires_delta
    jti = uuid.uuid4().hex
    payload: dict[str, Any] = {
        "sub": str(subject),
        "type": token_type,
        "jti": jti,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
        **{key: value for key, value in extra.items() if value is not None},
    }
    encoded = jwt.encode(payload, settings.token_signing_key, algorithm=settings.jwt_algorithm)
    return encoded, jti, expires_at


def create_access_token(user_id: int, *, role: str) -> tuple[str, datetime]:
    token, _, expires_at = _encode(
        user_id,
        "access",
        timedelta(minutes=settings.access_token_expire_minutes),
        role=role,
    )
    return token, expires_at


def create_refresh_token(user_id: int) -> tuple[str, str, datetime]:
    """Returns ``(token, jti, expires_at)``; the caller persists the digest."""
    return _encode(user_id, "refresh", timedelta(days=settings.refresh_token_expire_days))


def create_oauth_state() -> str:
    """A signed, expiring ``state`` for the LinkedIn OAuth redirect.

    The signature stops a forged or stale value. It does not prove the callback
    reached the browser that started the flow; the frontend checks that by
    comparing against the copy it kept in ``sessionStorage``.
    """
    now = datetime.now(UTC)
    payload = {
        "type": "oauth_state",
        "nonce": uuid.uuid4().hex,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.oauth_state_expire_minutes)).timestamp()),
    }
    return jwt.encode(payload, settings.token_signing_key, algorithm=settings.jwt_algorithm)


def verify_oauth_state(state: str | None) -> None:
    if not state:
        raise InvalidTokenError("Sign-in with LinkedIn was not started from this app.")
    try:
        payload = jwt.decode(state, settings.token_signing_key, algorithms=[settings.jwt_algorithm])
    except jwt.ExpiredSignatureError as exc:
        raise InvalidTokenError("Sign-in with LinkedIn took too long. Start again.") from exc
    except jwt.PyJWTError as exc:
        raise InvalidTokenError("Sign-in with LinkedIn was not started from this app.") from exc
    if payload.get("type") != "oauth_state":
        raise InvalidTokenError("Sign-in with LinkedIn was not started from this app.")


def decode_token(token: str, *, expected_type: TokenType) -> TokenClaims:
    try:
        payload = jwt.decode(
            token, settings.token_signing_key, algorithms=[settings.jwt_algorithm]
        )
    except jwt.ExpiredSignatureError as exc:
        raise InvalidTokenError("Session expired. Sign in again.") from exc
    except jwt.PyJWTError as exc:
        raise InvalidTokenError("Invalid authentication token.") from exc

    if payload.get("type") != expected_type:
        raise InvalidTokenError(f"Expected a {expected_type} token.")

    try:
        subject = int(payload["sub"])
    except (KeyError, TypeError, ValueError) as exc:
        raise InvalidTokenError("Authentication token is missing its subject.") from exc

    return TokenClaims(
        subject=subject,
        token_type=expected_type,
        jti=str(payload.get("jti", "")),
        expires_at=datetime.fromtimestamp(payload["exp"], tz=UTC),
        role=payload.get("role"),
    )
