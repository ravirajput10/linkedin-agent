from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.database.models import User
from app.errors import AppError, ErrorCode
from app.schemas.common import PageParams
from app.security import decode_token
from app.services import scoping

DbSession = Annotated[Session, Depends(get_db)]

#: ``auto_error=False`` so a missing header produces our own JSON error shape
#: rather than FastAPI's bare ``{"detail": ...}``.
bearer_scheme = HTTPBearer(auto_error=False, description="JWT access token")

BearerToken = Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)]


class NotAuthenticatedError(AppError):
    code = ErrorCode.AUTHENTICATION_EXPIRED
    http_status = 401


class ForbiddenError(AppError):
    code = ErrorCode.CONFLICT
    http_status = 403


def pagination(
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
) -> PageParams:
    return PageParams(page=page, page_size=page_size)


Pagination = Annotated[PageParams, Depends(pagination)]


def get_current_user(session: DbSession, credentials: BearerToken) -> User:
    """Resolve the bearer token to a live account.

    The account is re-read on every request rather than trusted from the token
    body, so deactivating a user takes effect immediately instead of whenever
    their access token happens to expire.
    """
    if credentials is None or not credentials.credentials:
        raise NotAuthenticatedError("Sign in to continue.")

    claims = decode_token(credentials.credentials, expected_type="access")
    user = session.get(User, claims.subject)
    if user is None:
        raise NotAuthenticatedError("This account no longer exists.")
    if not user.can_log_in:
        raise ForbiddenError(
            user.deactivated_reason or "This account has been deactivated."
        )
    return user


def get_current_admin(
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    if not current_user.is_admin:
        raise ForbiddenError("Administrator access is required.")
    return current_user


def get_optional_user(session: DbSession, credentials: BearerToken) -> User | None:
    """For endpoints that are public but richer when signed in."""
    from app.main import app

    if get_current_user in app.dependency_overrides:
        override = app.dependency_overrides[get_current_user]
        return override()

    if credentials is None or not credentials.credentials:
        return None
    try:
        return get_current_user(session, credentials)
    except AppError:
        return None


CurrentUser = Annotated[User, Depends(get_current_user)]
AdminUser = Annotated[User, Depends(get_current_admin)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]


def owner_scope(current_user: CurrentUser) -> int:
    """The owner id every agent-facing query filters on. See ``services.scoping``."""
    return scoping.scope_for(current_user)


#: Declare this on a route and pass it to ``scoping.restrict``.
OwnerScope = Annotated[int, Depends(owner_scope)]


def client_fingerprint(request: Request) -> tuple[str | None, str | None]:
    """``(user_agent, ip)`` recorded against an issued refresh token.
    Respects Cloudflare CF-Connecting-IP header if present.
    """
    cf_ip = request.headers.get("cf-connecting-ip")
    if cf_ip and cf_ip.strip():
        ip = cf_ip.strip()
    else:
        forwarded = request.headers.get("x-forwarded-for")
        ip = forwarded.split(",")[0].strip() if forwarded else (
            request.client.host if request.client else None
        )
    return request.headers.get("user-agent"), ip


class BotVerificationError(AppError):
    code = ErrorCode.VALIDATION_ERROR
    http_status = 403


async def verify_turnstile_challenge(request: Request, token: str | None = None) -> None:
    """Strict Zero-Bypass Cloudflare Turnstile token validation dependency (US-CF.3)."""
    from app.services.turnstile_service import get_turnstile_service

    if not token or not token.strip():
        raise BotVerificationError("Cloudflare Turnstile challenge token is required.")

    _, remote_ip = client_fingerprint(request)
    service = get_turnstile_service()
    is_valid = await service.verify_token(token, remote_ip=remote_ip)
    if not is_valid:
        raise BotVerificationError("Bot verification failed. Please complete the security check.")
