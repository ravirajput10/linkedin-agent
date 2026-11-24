"""Each user's campaign must act through that user's own Unipile account.

The failure these guard against is silent and severe: before per-user
resolution, a second user's campaign would like, comment and send invitations
through whatever ``UNIPILE_ACCOUNT_ID`` the server happened to hold — engaging
strangers as the wrong member, with nothing raising an error.
"""

from __future__ import annotations

import contextlib
from datetime import UTC, datetime

import pytest
from sqlalchemy.orm import Session

from app.config import PlatformAdapterName, settings
from app.database.models import Campaign, UserPlatformAccount
from app.enums import CampaignStatus, PlatformAccountStatus, PlatformProvider
from app.errors import AppError, ConflictError
from app.integrations.platform import factory
from app.services import campaign_service, integration_service

pytestmark = pytest.mark.integration


@pytest.fixture
def unipile_mode(monkeypatch):
    """Run as if Unipile were the active adapter, without any network."""
    monkeypatch.setattr(settings, "platform_adapter", PlatformAdapterName.UNIPILE)
    monkeypatch.setattr(settings, "unipile_dsn", "api39.unipile.com:16977")
    monkeypatch.setattr(settings, "unipile_api_key", "test-key")
    monkeypatch.setattr(settings, "unipile_account_id", "SERVER_WIDE_ACCOUNT")
    factory.reset_platform_adapter_cache()
    # The platform fixture installs a global override; clear it so resolution
    # actually runs rather than short-circuiting.
    factory.set_platform_adapter_override(None)
    yield
    factory.reset_platform_adapter_cache()


def link_account(db: Session, user, account_id: str) -> UserPlatformAccount:
    account = UserPlatformAccount(
        user_id=user.id,
        provider=PlatformProvider.LINKEDIN,
        status=PlatformAccountStatus.CONNECTED,
        account_id=account_id,
        connected_at=datetime.now(UTC),
    )
    db.add(account)
    db.flush()
    return account


def make_campaign(db: Session, owner, name: str) -> Campaign:
    campaign = Campaign(
        name=name,
        instruction=f"Find people for {name}.",
        owner_id=owner.id,
        status=CampaignStatus.DRAFT,
        dry_run=True,
    )
    db.add(campaign)
    db.flush()
    return campaign


# -------------------------------------------------------- the core property --


@pytest.mark.anyio
async def test_each_campaign_resolves_its_own_owners_account(
    db: Session, make_user, unipile_mode
) -> None:
    alice = make_user("alice-adapter@example.com")
    bob = make_user("bob-adapter@example.com")
    link_account(db, alice, "ACCOUNT_ALICE")
    link_account(db, bob, "ACCOUNT_BOB")

    alice_campaign = make_campaign(db, alice, "Alice run")
    bob_campaign = make_campaign(db, bob, "Bob run")

    alice_adapter = await factory.adapter_for_campaign(db, alice_campaign.id)
    bob_adapter = await factory.adapter_for_campaign(db, bob_campaign.id)

    assert alice_adapter._account_id == "ACCOUNT_ALICE"
    assert bob_adapter._account_id == "ACCOUNT_BOB"
    assert alice_adapter is not bob_adapter

    # The decisive assertion: neither campaign can transmit through the
    # server-wide account, which is what used to happen for every user.
    assert alice_adapter._account_id != "SERVER_WIDE_ACCOUNT"
    assert bob_adapter._account_id != "SERVER_WIDE_ACCOUNT"

    await factory.close_account_adapters()


@pytest.mark.anyio
async def test_a_campaign_whose_owner_has_no_account_is_refused(
    db: Session, make_user, unipile_mode
) -> None:
    orphan = make_user("unconnected@example.com")
    campaign = make_campaign(db, orphan, "No connection")

    with pytest.raises(AppError) as excinfo:
        await factory.adapter_for_campaign(db, campaign.id)

    assert excinfo.value.http_status == 409
    assert "has not connected a LinkedIn account" in excinfo.value.message


@pytest.mark.anyio
async def test_an_unowned_campaign_is_refused(db: Session, unipile_mode) -> None:
    """A campaign from before accounts existed must not borrow the server's."""
    campaign = Campaign(
        name="Unowned",
        instruction="Legacy campaign.",
        owner_id=None,
        status=CampaignStatus.DRAFT,
    )
    db.add(campaign)
    db.flush()

    with pytest.raises(AppError) as excinfo:
        await factory.adapter_for_campaign(db, campaign.id)
    assert "no owner" in excinfo.value.message


@pytest.mark.anyio
async def test_a_disconnected_account_does_not_resolve(
    db: Session, make_user, unipile_mode
) -> None:
    user = make_user("dropped@example.com")
    account = link_account(db, user, "ACCOUNT_DROPPED")
    campaign = make_campaign(db, user, "Dropped session")

    # LinkedIn signs the session out.
    account.status = PlatformAccountStatus.ERROR
    db.flush()

    with pytest.raises(AppError):
        await factory.adapter_for_campaign(db, campaign.id)

    # Reconnecting restores it.
    account.status = PlatformAccountStatus.CONNECTED
    db.flush()
    adapter = await factory.adapter_for_campaign(db, campaign.id)
    assert adapter._account_id == "ACCOUNT_DROPPED"
    await factory.close_account_adapters()


# ------------------------------------------------------------------ cache --


@pytest.mark.anyio
async def test_the_same_account_reuses_one_adapter(
    db: Session, make_user, unipile_mode
) -> None:
    user = make_user("cached@example.com")
    link_account(db, user, "ACCOUNT_CACHED")
    first = make_campaign(db, user, "First")
    second = make_campaign(db, user, "Second")

    a = await factory.adapter_for_campaign(db, first.id)
    b = await factory.adapter_for_campaign(db, second.id)
    assert a is b, "one account should not open a second connection pool"

    await factory.close_account_adapters()


@pytest.mark.anyio
async def test_the_cache_is_bounded_and_closes_what_it_evicts(unipile_mode) -> None:
    closed: list[str] = []

    class _Tracking:
        def __init__(self, account_id: str) -> None:
            self._account_id = account_id

        async def aclose(self) -> None:
            closed.append(self._account_id)

    limit = factory.MAX_CACHED_ACCOUNT_ADAPTERS
    original = factory.build_platform_adapter
    factory.build_platform_adapter = lambda s, *, account_id=None: _Tracking(account_id)
    try:
        for index in range(limit + 3):
            await factory.get_adapter_for_account(f"ACCOUNT_{index}")

        assert len(factory._account_adapters) == limit, "cache grew past its bound"
        # The three oldest were evicted, and their clients were closed rather
        # than leaked.
        assert closed == ["ACCOUNT_0", "ACCOUNT_1", "ACCOUNT_2"]
    finally:
        factory.build_platform_adapter = original
        await factory.close_account_adapters()


# ----------------------------------------------------------- start guard --


def test_start_is_refused_without_a_connected_account(
    db: Session, make_user, unipile_mode
) -> None:
    user = make_user("nostart@example.com")
    campaign = campaign_service.create_campaign(
        db,
        campaign_service.CampaignCreate(
            name="Blocked", instruction="Find people who post about Java."
        ),
        owner=user,
    )

    with pytest.raises(ConflictError) as excinfo:
        campaign_service.start_campaign(db, campaign.id, owner_id=user.id)
    assert "Connect your LinkedIn account" in excinfo.value.message

    # Still DRAFT: a refused start must not half-apply.
    db.refresh(campaign)
    assert campaign.status is CampaignStatus.DRAFT


def test_start_succeeds_once_an_account_is_connected(
    db: Session, make_user, unipile_mode
) -> None:
    user = make_user("canstart@example.com")
    link_account(db, user, "ACCOUNT_READY")
    campaign = campaign_service.create_campaign(
        db,
        campaign_service.CampaignCreate(
            name="Allowed", instruction="Find people who post about Java."
        ),
        owner=user,
    )

    started = campaign_service.start_campaign(db, campaign.id, owner_id=user.id)
    assert started.status is CampaignStatus.RUNNING


def test_the_guard_does_not_apply_to_adapters_without_a_member_identity(
    db: Session, make_user
) -> None:
    """The mock adapter has no per-member concept, so no connection is needed.

    This is what keeps local development and the test suite working without
    anyone linking a LinkedIn account.
    """
    assert settings.platform_adapter is PlatformAdapterName.MOCK
    assert factory.requires_connected_account() is False

    user = make_user("mockmode@example.com")
    campaign = campaign_service.create_campaign(
        db,
        campaign_service.CampaignCreate(
            name="Mock mode", instruction="Find people who post about Java."
        ),
        owner=user,
    )
    assert (
        campaign_service.start_campaign(db, campaign.id, owner_id=user.id).status
        is CampaignStatus.RUNNING
    )


def test_integration_service_only_reports_usable_accounts(
    db: Session, make_user
) -> None:
    user = make_user("usable@example.com")
    assert integration_service.connected_account_id(db, user.id) is None

    account = link_account(db, user, "ACCOUNT_USABLE")
    assert integration_service.connected_account_id(db, user.id) == "ACCOUNT_USABLE"

    for bad in (
        PlatformAccountStatus.PENDING,
        PlatformAccountStatus.DISCONNECTED,
        PlatformAccountStatus.ERROR,
    ):
        account.status = bad
        db.flush()
        assert integration_service.connected_account_id(db, user.id) is None


# --------------------------------------------- the run path, not just start --


@pytest.mark.anyio
async def test_running_a_campaign_refuses_rather_than_using_the_server_account(
    db: Session, make_user, llm, unipile_mode
) -> None:
    """``/campaigns/{id}/run`` dispatches without going through start_campaign.

    So the controller itself must refuse too, otherwise the start guard is
    bypassable and the run quietly falls back to the server-wide account.
    """
    from app.agents.agent_controller import AgentController

    user = make_user("runguard@example.com")
    campaign = make_campaign(db, user, "Run without a connection")
    campaign.status = CampaignStatus.RUNNING
    db.flush()

    with pytest.raises(AppError) as excinfo:
        await AgentController(db).run_campaign(campaign.id)
    assert "has not connected a LinkedIn account" in excinfo.value.message


@pytest.mark.anyio
async def test_running_a_campaign_uses_the_owners_account(
    db: Session, make_user, llm, unipile_mode
) -> None:
    user = make_user("runok@example.com")
    link_account(db, user, "ACCOUNT_RUNNER")
    campaign = make_campaign(db, user, "Run with a connection")
    campaign.status = CampaignStatus.RUNNING
    db.flush()

    controller = AgentControllerProbe(db)
    # The run may fail further on (there is no network here); all this test
    # asserts is which account it resolved before getting there.
    with contextlib.suppress(Exception):
        await controller.run_campaign(campaign.id)
    assert controller.adapter is not None
    assert controller.adapter._account_id == "ACCOUNT_RUNNER"

    await factory.close_account_adapters()


class AgentControllerProbe:
    """Thin wrapper so the resolved adapter can be inspected after a run."""

    def __init__(self, session: Session) -> None:
        from app.agents.agent_controller import AgentController

        self._inner = AgentController(session)

    @property
    def adapter(self):
        return self._inner.adapter

    async def run_campaign(self, campaign_id: int):
        return await self._inner.run_campaign(campaign_id)


@pytest.mark.anyio
async def test_a_workflow_engine_without_an_adapter_refuses_in_unipile_mode(
    db: Session, unipile_mode
) -> None:
    """Guards the silent-fallback path inside the engine itself."""
    from app.agents.workflow_engine import WorkflowEngine

    with pytest.raises(AppError) as excinfo:
        WorkflowEngine(db)
    assert "owner's adapter" in excinfo.value.message
