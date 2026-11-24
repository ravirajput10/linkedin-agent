"""The single place that decides which platform adapter is active.

Two kinds of adapter live here. Most are server-wide: the mock, Bright Data and
the LinkedIn OAuth adapter act the same whoever asks. Unipile is different — it
acts *as a particular member*, so an adapter built for one user must never be
handed to another. ``adapter_for_campaign`` resolves the right one from the
campaign's owner, and the agent layer goes through it rather than through
``get_platform_adapter``.
"""

from __future__ import annotations

import asyncio
from collections import OrderedDict
from functools import lru_cache

from sqlalchemy.orm import Session

from app.config import PlatformAdapterName, Settings, get_settings
from app.errors import AppError, ErrorCode, NotFoundError
from app.integrations.platform.base import SocialPlatformAdapter
from app.logging import get_logger

logger = get_logger(__name__)

_override: SocialPlatformAdapter | None = None

#: Ceiling on per-account adapters held open. Each carries an httpx client with
#: its own connection pool, so this is a memory and socket bound, not a
#: correctness one — evicting merely costs a reconnect on the next use.
MAX_CACHED_ACCOUNT_ADAPTERS = 32


def build_platform_adapter(
    settings: Settings, *, account_id: str | None = None
) -> SocialPlatformAdapter:
    """``account_id`` binds a Unipile adapter to one connected member."""
    match settings.platform_adapter:
        case PlatformAdapterName.MOCK:
            from app.integrations.platform.mock_adapter import MockSocialPlatformAdapter

            return MockSocialPlatformAdapter()
        case PlatformAdapterName.LINKEDIN:
            from app.integrations.platform.linkedin_adapter import LinkedInAdapter

            return LinkedInAdapter()
        case PlatformAdapterName.BRIGHTDATA:
            from app.integrations.platform.brightdata_adapter import BrightDataAdapter

            return BrightDataAdapter(settings)
        case PlatformAdapterName.UNIPILE:
            from app.integrations.platform.unipile_adapter import UnipileAdapter

            return UnipileAdapter(settings, account_id=account_id)
        case PlatformAdapterName.COMPOSITE:
            from app.integrations.platform.composite_adapter import build_composite

            return build_composite(settings, account_id=account_id)

    raise AppError(
        f"Unsupported platform adapter: {settings.platform_adapter}",
        code=ErrorCode.VALIDATION_ERROR,
        http_status=500,
    )


def requires_connected_account(settings: Settings | None = None) -> bool:
    """Whether the active configuration acts as a specific member.

    Only Unipile does. Everything else is server-wide, so a campaign can run
    without its owner having linked anything — which is what keeps the mock
    adapter usable in tests and in local development.
    """
    settings = settings or get_settings()
    if settings.platform_adapter is PlatformAdapterName.UNIPILE:
        return True
    if settings.platform_adapter is PlatformAdapterName.COMPOSITE:
        return PlatformAdapterName.UNIPILE in (
            settings.composite_read_adapter,
            settings.composite_write_adapter,
        )
    return False


# ----------------------------------------------------------- shared adapter --


@lru_cache(maxsize=1)
def _cached_adapter() -> SocialPlatformAdapter:
    adapter = build_platform_adapter(get_settings())
    logger.info("Platform adapter initialised: %s", adapter.platform)
    return adapter


def get_platform_adapter() -> SocialPlatformAdapter:
    """The server-wide adapter.

    Correct for reading configuration and for adapters with no per-member
    identity. The agent layer must NOT use this when
    ``requires_connected_account()`` is true: it would act as whichever account
    happens to be in the environment, which for a signed-in user is somebody
    else's LinkedIn.
    """
    return _override if _override is not None else _cached_adapter()


def set_platform_adapter_override(adapter: SocialPlatformAdapter | None) -> None:
    global _override
    _override = adapter


def reset_platform_adapter_cache() -> None:
    _cached_adapter.cache_clear()


# ------------------------------------------------------ per-account cache --

#: account id -> (adapter, the loop its httpx client is bound to)
_account_adapters: OrderedDict[str, tuple[SocialPlatformAdapter, object]] = OrderedDict()


def _current_loop() -> object | None:
    try:
        return asyncio.get_running_loop()
    except RuntimeError:
        return None


async def _close_quietly(adapter: SocialPlatformAdapter, loop: object) -> None:
    """Close an evicted adapter, but only from the loop that owns its client.

    An httpx client binds to the loop that first used it. Awaiting its close
    from a different loop raises, and Celery runs each task in a fresh loop, so
    an adapter left over from a previous task is simply dropped for the garbage
    collector rather than closed incorrectly.
    """
    if loop is not _current_loop():
        return
    try:
        await adapter.aclose()
    except Exception:
        logger.debug("Error closing an evicted platform adapter", exc_info=True)


async def get_adapter_for_account(account_id: str) -> SocialPlatformAdapter:
    """A Unipile adapter bound to one member, cached between calls."""
    if _override is not None:
        return _override

    loop = _current_loop()
    cached = _account_adapters.get(account_id)
    if cached is not None:
        adapter, cached_loop = cached
        if cached_loop is loop:
            _account_adapters.move_to_end(account_id)
            return adapter
        # Built under a different event loop; its connection pool cannot be
        # reused here. Drop it and build a fresh one.
        _account_adapters.pop(account_id, None)

    adapter = build_platform_adapter(get_settings(), account_id=account_id)
    _account_adapters[account_id] = (adapter, loop)
    _account_adapters.move_to_end(account_id)

    while len(_account_adapters) > MAX_CACHED_ACCOUNT_ADAPTERS:
        _, (evicted, evicted_loop) = _account_adapters.popitem(last=False)
        await _close_quietly(evicted, evicted_loop)

    logger.debug("Platform adapter built for account %s", account_id)
    return adapter


async def close_account_adapters() -> None:
    """Release every cached per-account adapter. Called on shutdown."""
    while _account_adapters:
        _, (adapter, loop) = _account_adapters.popitem()
        await _close_quietly(adapter, loop)


# ---------------------------------------------------------------- resolve --


async def adapter_for_owner(
    session: Session, owner_id: int | None, *, context: str
) -> SocialPlatformAdapter:
    """The adapter to act through on behalf of ``owner_id``.

    ``context`` only shapes the error message, so a refusal names what the user
    was trying to do.
    """
    if _override is not None:
        return _override
    if not requires_connected_account():
        return get_platform_adapter()

    from app.services import integration_service

    if owner_id is None:
        raise AppError(
            f"{context} has no owner, so there is no LinkedIn account to act through. "
            "Assign an owner before running it.",
            code=ErrorCode.AUTHENTICATION_EXPIRED,
            http_status=409,
        )

    account_id = integration_service.connected_account_id(session, owner_id)
    if not account_id:
        raise AppError(
            f"{context} cannot run: its owner has not connected a LinkedIn account. "
            "Connect one from the profile page first.",
            code=ErrorCode.AUTHENTICATION_EXPIRED,
            http_status=409,
            details={"owner_id": owner_id},
        )
    return await get_adapter_for_account(account_id)


async def adapter_for_campaign(session: Session, campaign_id: int) -> SocialPlatformAdapter:
    from app.database.models import Campaign

    campaign = session.get(Campaign, campaign_id)
    if campaign is None:
        raise NotFoundError(f"Campaign {campaign_id} not found.")
    return await adapter_for_owner(
        session, campaign.owner_id, context=f"Campaign '{campaign.name}'"
    )
