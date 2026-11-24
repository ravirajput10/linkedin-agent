"""Linking a user's own LinkedIn account.

Everything under ``/integrations/linkedin`` is scoped to the signed-in user.
The webhook is deliberately outside that: Unipile calls it server-to-server
with no session, so it authenticates on the secret in its path plus the
one-time token echoed in the body.
"""

from __future__ import annotations

from fastapi import APIRouter, Request, Response, status

from app.api.deps import CurrentUser, DbSession
from app.config import settings as app_settings
from app.enums import PlatformProvider
from app.logging import get_logger
from app.schemas.common import MessageResponse
from app.schemas.integration import (
    ConnectAccountRequest,
    HostedAuthLink,
    PlatformAccountRead,
    RefreshAccountRequest,
)
from app.services import integration_service

logger = get_logger(__name__)

router = APIRouter(prefix="/integrations", tags=["integrations"])


def _read(account) -> PlatformAccountRead:
    if account is None:
        return PlatformAccountRead(
            provider=PlatformProvider.LINKEDIN,
            status="NOT_CONNECTED",
            connected=False,
            linking_enabled=app_settings.account_linking_enabled,
        )
    return PlatformAccountRead(
        provider=account.provider,
        status=account.status.value,
        connected=account.is_usable,
        connected_at=account.connected_at,
        disconnected_at=account.disconnected_at,
        last_error=account.last_error,
        linking_enabled=app_settings.account_linking_enabled,
    )


@router.get("/linkedin", response_model=PlatformAccountRead)
def get_linkedin_connection(
    session: DbSession, current_user: CurrentUser
) -> PlatformAccountRead:
    """Whether this user has a usable LinkedIn connection. Never returns the id."""
    return _read(integration_service.get_account(session, current_user.id))


@router.post("/linkedin/connect", response_model=HostedAuthLink)
async def connect_linkedin(
    session: DbSession,
    current_user: CurrentUser,
    payload: ConnectAccountRequest | None = None,
) -> HostedAuthLink:
    """Mint a single-use Unipile hosted-auth link for this user.

    The browser is sent to the returned URL; the member signs in to LinkedIn on
    Unipile's page, and Unipile calls our webhook when it completes.
    """
    account, url = await integration_service.create_hosted_auth_link(
        session, current_user, reconnect=bool(payload and payload.reconnect)
    )
    expires_at = account.link_expires_at
    session.commit()
    return HostedAuthLink(url=url, expires_at=expires_at)


@router.post("/linkedin/refresh", response_model=PlatformAccountRead)
async def refresh_linkedin(
    session: DbSession,
    current_user: CurrentUser,
    payload: RefreshAccountRequest | None = None,
) -> PlatformAccountRead:
    """Read the connection's real state back from Unipile.

    Called when the member returns from the hosted wizard, which is what binds
    the account on a server with no public webhook address, and whenever the UI
    wants to confirm a session is still alive.
    """
    account_id = payload.account_id if payload else None
    account = await integration_service.reconcile(
        session, current_user, account_id=account_id
    )
    result = _read(account)
    session.commit()
    return result


@router.delete("/linkedin", response_model=PlatformAccountRead)
async def disconnect_linkedin(
    session: DbSession, current_user: CurrentUser
) -> PlatformAccountRead:
    account = await integration_service.disconnect(session, current_user)
    result = _read(account)
    session.commit()
    return result


# ----------------------------------------------------------------- webhook --


@router.post(
    "/unipile/webhook/{secret}",
    include_in_schema=False,
    status_code=status.HTTP_200_OK,
)
async def unipile_webhook(
    session: DbSession, secret: str, request: Request
) -> Response:
    """Unipile's ``notify_url``. No session: it is called server-to-server.

    Answers 200 to everything it can parse. Unipile retries on a non-2xx, and
    nothing it could retry would fix a payload we do not recognise; a
    distinguishable error would also tell a prober whether a guess was close.
    """
    configured = app_settings.unipile_webhook_secret
    if not configured or secret != configured:
        logger.warning("Rejected a Unipile webhook with a bad path secret")
        return Response(status_code=status.HTTP_404_NOT_FOUND)

    try:
        payload = await request.json()
    except Exception:
        logger.warning("Unipile webhook body was not JSON")
        return Response(status_code=status.HTTP_200_OK)

    if not isinstance(payload, dict):
        return Response(status_code=status.HTTP_200_OK)

    # Two shapes arrive here: the hosted-auth completion (carries `name`) and
    # account lifecycle events (carry `account_id` and no `name`).
    if payload.get("name"):
        integration_service.handle_callback(session, payload)
    elif payload.get("account_id"):
        integration_service.mark_disconnected(
            session,
            str(payload["account_id"]),
            reason=str(payload.get("message") or "") or None,
        )
    session.commit()
    return Response(status_code=status.HTTP_200_OK)


@router.get("/status", response_model=MessageResponse, include_in_schema=False)
def linking_status(current_user: CurrentUser) -> MessageResponse:
    """Why the Connect button is disabled, for support questions."""
    if not app_settings.account_linking_enabled:
        return MessageResponse(
            message="LinkedIn account linking is not configured on this server.",
            detail="Set UNIPILE_DSN and UNIPILE_API_KEY.",
        )
    if app_settings.unipile_webhook_enabled:
        return MessageResponse(
            message="LinkedIn account linking is configured, with webhook delivery."
        )
    return MessageResponse(
        message="LinkedIn account linking is configured; connections are reconciled by polling.",
        detail=(
            "Set PUBLIC_API_BASE_URL and UNIPILE_WEBHOOK_SECRET for immediate "
            "webhook delivery instead."
        ),
    )
