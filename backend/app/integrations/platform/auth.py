"""Platform credential handling.

Tokens come from the environment or an injected secret store. They are never
written to source, never returned by the API, and never logged.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta

import httpx

from app.config import settings
from app.errors import ErrorCode, PlatformError
from app.logging import get_logger

logger = get_logger(__name__)

ACCESS_TOKEN_ENV = "LINKEDIN_ACCESS_TOKEN"
REFRESH_TOKEN_ENV = "LINKEDIN_REFRESH_TOKEN"
TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken"


class LinkedInCredentialStore:
    """Holds the access token in memory for the process lifetime.

    Replace :meth:`_load` with a call to your secret manager in production.
    """

    def __init__(self) -> None:
        self._access_token: str | None = None
        self._expires_at: datetime | None = None
        self._refresh_token: str | None = None

    def _load(self) -> None:
        self._access_token = os.getenv(ACCESS_TOKEN_ENV) or None
        self._refresh_token = os.getenv(REFRESH_TOKEN_ENV) or None

    @property
    def is_expired(self) -> bool:
        if self._expires_at is None:
            return False
        return datetime.now(UTC) >= self._expires_at - timedelta(minutes=5)

    async def get_access_token(self) -> str:
        if self._access_token is None:
            self._load()
        if self._access_token and self.is_expired and self._refresh_token:
            await self.refresh()
        if not self._access_token:
            raise PlatformError(
                f"No LinkedIn access token available. Set {ACCESS_TOKEN_ENV} in the "
                "environment or complete the OAuth flow.",
                code=ErrorCode.AUTHENTICATION_EXPIRED,
            )
        return self._access_token

    def store(self, access_token: str, expires_in: int, refresh_token: str | None = None) -> None:
        self._access_token = access_token
        self._expires_at = datetime.now(UTC) + timedelta(seconds=expires_in)
        if refresh_token:
            self._refresh_token = refresh_token
        logger.info("Stored LinkedIn access token (expires in %ss).", expires_in)

    async def exchange_code(self, code: str) -> None:
        await self._token_request(
            {
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": settings.linkedin_redirect_uri,
            }
        )

    async def refresh(self) -> None:
        if not self._refresh_token:
            raise PlatformError(
                "LinkedIn session expired and no refresh token is available.",
                code=ErrorCode.SESSION_EXPIRED,
            )
        await self._token_request(
            {"grant_type": "refresh_token", "refresh_token": self._refresh_token}
        )

    async def _token_request(self, payload: dict[str, str]) -> None:
        data = {
            **payload,
            "client_id": settings.linkedin_client_id,
            "client_secret": settings.linkedin_client_secret,
        }
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(TOKEN_URL, data=data)
                response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            # The body may echo the client secret back; never log it.
            raise PlatformError(
                f"LinkedIn token endpoint returned {exc.response.status_code}.",
                code=ErrorCode.AUTHENTICATION_EXPIRED,
            ) from exc
        except httpx.HTTPError as exc:
            raise PlatformError("LinkedIn token endpoint is unreachable.") from exc

        body = response.json()
        self.store(
            access_token=body["access_token"],
            expires_in=int(body.get("expires_in", 3600)),
            refresh_token=body.get("refresh_token"),
        )

    def clear(self) -> None:
        self._access_token = None
        self._refresh_token = None
        self._expires_at = None
