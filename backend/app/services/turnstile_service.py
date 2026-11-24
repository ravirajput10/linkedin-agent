from __future__ import annotations

import httpx
from pydantic import BaseModel

from app.config import get_settings
from app.errors import AppError, ErrorCode
from app.logging import get_logger

logger = get_logger(__name__)


class TurnstileVerifyResponse(BaseModel):
    success: bool
    challenge_ts: str | None = None
    hostname: str | None = None
    error_codes: list[str] = []
    action: str | None = None
    cdata: str | None = None


class CloudflareTurnstileService:
    """Service to verify Cloudflare Turnstile CAPTCHA/bot challenge tokens (US-CF.2).

    All configuration (secret key, site key, verification URL) is loaded
    strictly from the application environment (.env file).
    """

    def __init__(self, secret_key: str | None = None, verify_url: str | None = None):
        settings = get_settings()
        self.secret_key = (secret_key or settings.cloudflare_turnstile_secret_key).strip()
        self.verify_url = (verify_url or settings.cloudflare_turnstile_verify_url).strip()

    async def verify_token(self, token: str | None, remote_ip: str | None = None) -> bool:
        """Verifies a Turnstile response token with Cloudflare's siteverify API.

        Strict Zero-Bypass: A valid token and configured secret key are required.
        """
        if not token or not token.strip():
            logger.warning("Turnstile verification failed: missing token")
            return False

        if not self.secret_key:
            logger.error("Turnstile verification failed: secret key is not configured in .env")
            return False

        # Call Cloudflare siteverify endpoint using credentials from .env
        data = {
            "secret": self.secret_key,
            "response": token.strip(),
        }
        if remote_ip:
            data["remoteip"] = remote_ip

        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                res = await client.post(self.verify_url, data=data)
                if res.status_code != 200:
                    logger.error(
                        "Cloudflare Turnstile verification HTTP error: status=%s body=%s",
                        res.status_code,
                        res.text,
                    )
                    return False

                payload = res.json()
                is_valid = bool(payload.get("success", False))
                if not is_valid:
                    logger.warning(
                        "Cloudflare Turnstile rejected token: errors=%s",
                        payload.get("error-codes", []),
                    )
                return is_valid
        except httpx.RequestError as exc:
            logger.error("Cloudflare Turnstile verification network connection failed: %s", exc)
            return False


_turnstile_service: CloudflareTurnstileService | None = None


def get_turnstile_service() -> CloudflareTurnstileService:
    global _turnstile_service
    if _turnstile_service is None:
        _turnstile_service = CloudflareTurnstileService()
    return _turnstile_service
