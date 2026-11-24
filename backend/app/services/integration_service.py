"""Linking a user's own LinkedIn account through Unipile's hosted auth wizard.

The member never gives us their LinkedIn password. We ask Unipile for a
single-use link, send the member there, and Unipile hosts the whole sign-in —
credentials, two-factor, checkpoints. When it finishes, Unipile calls our
webhook with an opaque ``account_id``, which is all we store. That id is only
usable alongside our server-side API key, which never leaves the environment.

The ``name`` we hand Unipile is echoed back on the callback. We put a one-time
random token there, so the same value both routes the callback to the right
user and proves the callback is genuine.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database.models import User, UserPlatformAccount
from app.enums import PlatformAccountStatus, PlatformProvider
from app.errors import AppError, ErrorCode, NotFoundError, ValidationError
from app.logging import get_logger
from app.security import generate_token, hash_token

logger = get_logger(__name__)

#: Unipile callback statuses that mean "the member finished successfully".
SUCCESS_STATUSES = frozenset({"CREATION_SUCCESS", "RECONNECTED"})


class AccountLinkingUnavailableError(AppError):
    """Linking is switched off because its configuration is incomplete."""

    code = ErrorCode.CAPABILITY_UNSUPPORTED
    http_status = 503


# ------------------------------------------------------------------ lookup --


def get_account(
    session: Session,
    user_id: int,
    provider: PlatformProvider = PlatformProvider.LINKEDIN,
) -> UserPlatformAccount | None:
    return session.scalar(
        select(UserPlatformAccount).where(
            UserPlatformAccount.user_id == user_id,
            UserPlatformAccount.provider == provider,
        )
    )


def get_or_create_account(
    session: Session,
    user: User,
    provider: PlatformProvider = PlatformProvider.LINKEDIN,
) -> UserPlatformAccount:
    account = get_account(session, user.id, provider)
    if account is None:
        account = UserPlatformAccount(
            user_id=user.id, provider=provider, status=PlatformAccountStatus.PENDING
        )
        session.add(account)
        session.flush()
    return account


def connected_account_id(
    session: Session,
    user_id: int,
    provider: PlatformProvider = PlatformProvider.LINKEDIN,
) -> str | None:
    """The Unipile account id to act through for this user, if any.

    This is the hook the per-user adapter will resolve against once the
    platform factory stops serving one global account.
    """
    account = get_account(session, user_id, provider)
    return account.account_id if account and account.is_usable else None


# -------------------------------------------------------------- hosted auth --


def _require_configuration() -> None:
    if settings.account_linking_enabled:
        return
    missing = [
        name
        for name, value in (
            ("UNIPILE_DSN", settings.unipile_dsn),
            ("UNIPILE_API_KEY", settings.unipile_api_key),
        )
        if not value
    ]
    raise AccountLinkingUnavailableError(
        f"LinkedIn account linking is not configured on this server: {', '.join(missing)} not set.",
        details={"missing": missing},
    )


def _webhook_url() -> str:
    base = settings.public_api_base_url.rstrip("/")
    return f"{base}{settings.api_prefix}/integrations/unipile/webhook/{settings.unipile_webhook_secret}"


def _redirect_urls() -> tuple[str, str]:
    base = settings.app_base_url.rstrip("/")
    return f"{base}/profile?linkedin=connected", f"{base}/profile?linkedin=failed"


async def create_hosted_auth_link(
    session: Session,
    user: User,
    *,
    reconnect: bool = False,
    provider: PlatformProvider = PlatformProvider.LINKEDIN,
) -> tuple[UserPlatformAccount, str]:
    """Ask Unipile for a one-time link and record the token that matches it back.

    Links are single-use and short-lived — Unipile also expires them on its own
    daily restart — so one is minted per click rather than cached.
    """
    _require_configuration()

    account = get_or_create_account(session, user, provider)
    if reconnect and not account.account_id:
        reconnect = False  # nothing to reconnect to; treat as a fresh link

    raw_token = generate_token(32)
    now = datetime.now(UTC)
    expires_at = now + timedelta(minutes=settings.unipile_hosted_auth_expiry_minutes)

    success_url, failure_url = _redirect_urls()
    payload = {
        "type": "reconnect" if reconnect else "create",
        "providers": [provider.value],
        "api_url": settings.unipile_base_url,
        "expiresOn": expires_at.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
        # Echoed back on the callback. Random, so it also authenticates it.
        "name": raw_token,
        "success_redirect_url": success_url,
        "failure_redirect_url": failure_url,
    }
    # Optional to Unipile. Without a public address we reconcile by reading the
    # account back instead; see ``reconcile``.
    if settings.unipile_webhook_enabled:
        payload["notify_url"] = _webhook_url()
    if reconnect and account.account_id:
        payload["reconnect_account"] = account.account_id

    try:
        async with httpx.AsyncClient(
            base_url=f"{settings.unipile_base_url}/api/v1",
            timeout=httpx.Timeout(settings.unipile_timeout_seconds),
            headers={
                "X-API-KEY": settings.unipile_api_key,
                "accept": "application/json",
                "Content-Type": "application/json",
            },
        ) as client:
            response = await client.post("/hosted/accounts/link", json=payload)
            response.raise_for_status()
            body = response.json()
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text[:300].strip()
        logger.warning(
            "Unipile refused a hosted-auth link for user %s: %s %s",
            user.id,
            exc.response.status_code,
            detail,
        )
        if exc.response.status_code in (401, 403):
            msg = "Unipile rejected the request: invalid or expired UNIPILE_API_KEY."
        elif exc.response.status_code == 502:
            msg = (
                f"Unipile returned 502 Bad Gateway ({settings.unipile_base_url}). "
                "Your Unipile instance may be stopped or UNIPILE_DSN needs updating."
            )
        elif detail:
            msg = f"Unipile error ({exc.response.status_code}): {detail}"
        else:
            msg = "Could not start LinkedIn connection. Please try again shortly."

        raise AppError(
            msg,
            code=ErrorCode.AI_PROVIDER_ERROR,
            http_status=502,
            details={"status": exc.response.status_code, "detail": detail},
        ) from exc
    except httpx.HTTPError as exc:
        raise AppError(
            "Could not reach Unipile to start the LinkedIn connection.",
            code=ErrorCode.AI_PROVIDER_ERROR,
            http_status=502,
        ) from exc

    url = body.get("url") if isinstance(body, dict) else None
    if not url:
        raise AppError(
            "Unipile did not return a connection link.",
            code=ErrorCode.AI_PROVIDER_ERROR,
            http_status=502,
        )

    account.link_token = hash_token(raw_token)
    account.link_requested_at = now
    account.link_expires_at = expires_at
    account.last_error = None
    if account.status is not PlatformAccountStatus.CONNECTED:
        account.status = PlatformAccountStatus.PENDING
    session.flush()

    logger.info("Issued a %s hosted-auth link for user %s", payload["type"], user.id)
    return account, url


# ---------------------------------------------------------------- callback --


def handle_callback(session: Session, payload: dict) -> UserPlatformAccount | None:
    """Apply a Unipile notify_url callback.

    Returns None when the payload matches no outstanding link. The caller still
    answers 200 — retrying would not help Unipile, and a distinguishable error
    would tell a prober whether a token guess was close.
    """
    name = str(payload.get("name") or "").strip()
    status = str(payload.get("status") or "").strip().upper()
    account_id = str(payload.get("account_id") or "").strip() or None

    if not name:
        logger.warning("Unipile callback carried no name; ignoring")
        return None

    account = session.scalar(
        select(UserPlatformAccount).where(UserPlatformAccount.link_token == hash_token(name))
    )
    if account is None:
        logger.warning("Unipile callback did not match any outstanding link")
        return None

    now = datetime.now(UTC)
    account.last_checked_at = now

    if status in SUCCESS_STATUSES and account_id:
        account.account_id = account_id
        account.status = PlatformAccountStatus.CONNECTED
        account.connected_at = now
        account.disconnected_at = None
        account.last_error = None
        # The token is single-use: retire it so a replayed callback cannot
        # rebind the account later.
        account.link_token = None
        account.link_expires_at = None
        logger.info("LinkedIn connected for user %s (status=%s)", account.user_id, status)
    else:
        account.status = (
            PlatformAccountStatus.ERROR if account.account_id else PlatformAccountStatus.PENDING
        )
        account.last_error = f"Unipile reported {status or 'an unknown status'} while connecting."
        account.link_token = None
        logger.warning("LinkedIn connection failed for user %s: %s", account.user_id, status)

    session.flush()
    return account


def mark_disconnected(
    session: Session, account_id: str, reason: str | None = None
) -> UserPlatformAccount | None:
    """Handle Unipile reporting an account as logged out or credentials expired."""
    account = session.scalar(
        select(UserPlatformAccount).where(UserPlatformAccount.account_id == account_id)
    )
    if account is None:
        return None

    account.status = PlatformAccountStatus.ERROR
    account.last_checked_at = datetime.now(UTC)
    account.last_error = (
        reason or "LinkedIn signed this session out. Reconnect to resume your campaigns."
    )
    session.flush()
    logger.warning("LinkedIn session dropped for user %s", account.user_id)
    return account


# -------------------------------------------------------------- disconnect --


async def disconnect(
    session: Session,
    user: User,
    provider: PlatformProvider = PlatformProvider.LINKEDIN,
) -> UserPlatformAccount:
    """Forget the link locally and ask Unipile to drop the account.

    The local row is cleared even when the remote delete fails: the user asked
    to disconnect, and leaving them "connected" because a third party was
    unreachable would be the wrong answer.
    """
    account = get_account(session, user.id, provider)
    if account is None:
        raise NotFoundError("No LinkedIn account is linked to this profile.")

    remote_id = account.account_id
    if remote_id and settings.unipile_base_url and settings.unipile_api_key:
        try:
            async with httpx.AsyncClient(
                base_url=f"{settings.unipile_base_url}/api/v1",
                timeout=httpx.Timeout(settings.unipile_timeout_seconds),
                headers={
                    "X-API-KEY": settings.unipile_api_key,
                    "accept": "application/json",
                },
            ) as client:
                response = await client.delete(f"/accounts/{remote_id}")
                if response.status_code not in (200, 202, 204, 404):
                    logger.warning(
                        "Unipile returned %s deleting account %s",
                        response.status_code,
                        remote_id,
                    )
        except httpx.HTTPError:
            logger.warning("Could not reach Unipile to delete account %s", remote_id, exc_info=True)

    account.account_id = None
    account.status = PlatformAccountStatus.DISCONNECTED
    account.disconnected_at = datetime.now(UTC)
    account.link_token = None
    account.link_expires_at = None
    account.last_error = None
    session.flush()

    logger.info("LinkedIn disconnected for user %s", user.id)
    return account


def require_connected_account(session: Session, user_id: int) -> str:
    """The account id to act through, or a clear instruction to connect one."""
    account_id = connected_account_id(session, user_id)
    if not account_id:
        raise ValidationError(
            "Connect your LinkedIn account before running a campaign. "
            "You can do that from your profile page."
        )
    return account_id


# -------------------------------------------------------------- reconcile --

#: Unipile reports per-source health here. Anything else means the member's
#: LinkedIn session needs attention.
HEALTHY_SOURCE_STATUSES = frozenset({"OK", "CONNECTED", "RUNNING"})


async def _unipile_get(path: str) -> Any:
    async with httpx.AsyncClient(
        base_url=f"{settings.unipile_base_url}/api/v1",
        timeout=httpx.Timeout(settings.unipile_timeout_seconds),
        headers={"X-API-KEY": settings.unipile_api_key, "accept": "application/json"},
    ) as client:
        response = await client.get(path)
        response.raise_for_status()
        return response.json()


def _source_problem(account_payload: dict) -> str | None:
    """Read ``sources[].status``; return a human reason when it is unhealthy."""
    sources = account_payload.get("sources")
    if not isinstance(sources, list) or not sources:
        return None
    for source in sources:
        status = str((source or {}).get("status") or "").strip().upper()
        if status and status not in HEALTHY_SOURCE_STATUSES:
            return {
                "CREDENTIALS": "LinkedIn signed this session out. Reconnect to resume.",
                "STOPPED": "Unipile stopped this connection. Reconnect to resume.",
                "PERMISSIONS": "LinkedIn refused a permission this connection needs.",
                "ERROR": "Unipile reports an error on this connection. Reconnect to resume.",
            }.get(status, f"Unipile reports this connection as {status}.")
    return None


async def reconcile(
    session: Session,
    user: User,
    provider: PlatformProvider = PlatformProvider.LINKEDIN,
    account_id: str | None = None,
) -> UserPlatformAccount | None:
    """Read the truth back from Unipile instead of waiting to be told.

    Two jobs. For a link still outstanding, find the account whose ``name``
    matches the token we issued (or account_id passed back by the hosted wizard)
    and bind it — this is what makes the flow work without a publicly reachable webhook,
    and it also rescues a webhook that was missed during a deploy. For an account
    already bound, refresh its health so a session LinkedIn dropped shows up here
    rather than as a confusing mid-campaign failure.
    """
    account = get_account(session, user.id, provider)
    if account is None or not settings.account_linking_enabled:
        return account

    try:
        # 1. If explicit account_id is supplied and account is not yet bound (or reconnecting)
        if account_id and not account.account_id:
            try:
                payload = await _unipile_get(f"/accounts/{account_id}")
                if isinstance(payload, dict) and payload.get("id") == account_id:
                    problem = _source_problem(payload)
                    now = datetime.now(UTC)
                    account.last_checked_at = now

                    # Ensure no other user already owns this account
                    already_bound = session.scalar(
                        select(UserPlatformAccount).where(
                            UserPlatformAccount.account_id == account_id,
                            UserPlatformAccount.user_id != user.id,
                        )
                    )
                    if not already_bound:
                        account.account_id = account_id
                        if problem:
                            account.status = PlatformAccountStatus.ERROR
                            account.last_error = problem
                        else:
                            account.status = PlatformAccountStatus.CONNECTED
                            account.connected_at = now
                            account.disconnected_at = None
                            account.last_error = None
                        account.link_token = None
                        account.link_expires_at = None
                        session.flush()
                        logger.info(
                            "Bound LinkedIn account %s to user %s via explicit account_id",
                            account_id,
                            user.id,
                        )
                        return account
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 404:
                    account.account_id = None
                    account.status = PlatformAccountStatus.DISCONNECTED
                    account.last_error = "This connection no longer exists at Unipile."
                    session.flush()
                    return account
                raise

        # 2. If account is already bound, refresh its health
        if account.account_id:
            try:
                payload = await _unipile_get(f"/accounts/{account.account_id}")
                problem = _source_problem(payload if isinstance(payload, dict) else {})
                account.last_checked_at = datetime.now(UTC)
                if problem:
                    account.status = PlatformAccountStatus.ERROR
                    account.last_error = problem
                elif account.status in (PlatformAccountStatus.ERROR, PlatformAccountStatus.PENDING):
                    account.status = PlatformAccountStatus.CONNECTED
                    account.last_error = None
                session.flush()
                return account
            except httpx.HTTPStatusError as exc:
                account.last_checked_at = datetime.now(UTC)
                if exc.response.status_code in (401, 403):
                    account.status = PlatformAccountStatus.ERROR
                    account.last_error = "Unipile API key is invalid or expired. Check UNIPILE_API_KEY in .env."
                    session.flush()
                    return account
                if exc.response.status_code == 404:
                    account.status = PlatformAccountStatus.ERROR
                    account.last_error = "LinkedIn session not found at Unipile. Please reconnect."
                    session.flush()
                    return account
                account.status = PlatformAccountStatus.ERROR
                account.last_error = f"Unipile returned status {exc.response.status_code}."
                session.flush()
                return account
            except Exception as exc:
                logger.error("Error refreshing Unipile account %s: %s", account.account_id, exc)
                account.last_checked_at = datetime.now(UTC)
                account.status = PlatformAccountStatus.ERROR
                account.last_error = f"Failed to reach Unipile: {exc}"
                session.flush()
                return account

        if not account.link_token and not account.link_requested_at:
            return account

        # 3. Reconcile from Unipile accounts list
        payload = await _unipile_get("/accounts")
        items = payload.get("items") if isinstance(payload, dict) else payload
        if not isinstance(items, list):
            return account

        digest = account.link_token
        matched_item = None

        # 3a. Match by link token if Unipile preserved it in name
        if digest:
            for item in items:
                if not isinstance(item, dict):
                    continue
                name = str(item.get("name") or "")
                if name and hash_token(name) == digest:
                    matched_item = item
                    break

        # 3b. Unipile replaces item['name'] with the member's real LinkedIn name (e.g. "RAVI RAJPUT").
        # Match by most recently created LinkedIn account matching this user's link request window.
        if matched_item is None and account.link_requested_at:
            bound_account_ids = set(
                session.scalars(
                    select(UserPlatformAccount.account_id).where(
                        UserPlatformAccount.account_id.is_not(None),
                        UserPlatformAccount.user_id != user.id,
                    )
                ).all()
            )
            candidate_items = []
            for item in items:
                if not isinstance(item, dict):
                    continue
                item_id = str(item.get("id") or "")
                if not item_id or item_id in bound_account_ids:
                    continue
                if str(item.get("type") or "").upper() != provider.value:
                    continue
                created_str = item.get("created_at")
                if created_str:
                    try:
                        created_dt = datetime.fromisoformat(created_str.replace("Z", "+00:00"))
                        if created_dt >= account.link_requested_at - timedelta(minutes=10):
                            candidate_items.append((created_dt, item))
                    except Exception:
                        candidate_items.append((datetime.min.replace(tzinfo=UTC), item))
                else:
                    candidate_items.append((datetime.min.replace(tzinfo=UTC), item))

            if candidate_items:
                candidate_items.sort(key=lambda x: x[0], reverse=True)
                matched_item = candidate_items[0][1]

        if matched_item:
            account.account_id = str(matched_item.get("id") or "") or None
            if account.account_id:
                now = datetime.now(UTC)
                account.status = PlatformAccountStatus.CONNECTED
                account.connected_at = account.connected_at or now
                account.last_checked_at = now
                account.disconnected_at = None
                account.last_error = _source_problem(matched_item)
                if account.last_error:
                    account.status = PlatformAccountStatus.ERROR
                # Single-use, as in the webhook path.
                account.link_token = None
                account.link_expires_at = None
                session.flush()
                logger.info(
                    "Reconciled LinkedIn connection %s for user %s from Unipile",
                    account.account_id,
                    user.id,
                )
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404 and account.account_id:
            # Deleted on Unipile's side: stop claiming it works.
            account.account_id = None
            account.status = PlatformAccountStatus.DISCONNECTED
            account.last_error = "This connection no longer exists at Unipile."
            session.flush()
        else:
            logger.warning("Unipile reconcile failed for user %s", user.id, exc_info=True)
    except httpx.HTTPError:
        logger.warning("Could not reach Unipile to reconcile user %s", user.id, exc_info=True)

    return account
