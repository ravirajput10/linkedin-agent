from __future__ import annotations

import pytest

from app.enums import CapabilitySupport, ConnectionStatus, PlatformCapability
from app.errors import CapabilityUnsupportedError, PlatformError
from app.integrations.platform.base import SearchCriteria
from app.integrations.platform.linkedin_adapter import LinkedInAdapter
from app.integrations.platform.mock_adapter import MockSocialPlatformAdapter


@pytest.fixture
def adapter() -> MockSocialPlatformAdapter:
    return MockSocialPlatformAdapter()


async def test_search_ranks_by_matched_criteria(adapter) -> None:
    result = await adapter.search_people(
        SearchCriteria(job_titles=["CTO"], locations=["India"], keywords=["Java"], limit=5)
    )
    assert result.people
    top = result.people[0]
    assert top.matched_criteria
    assert "Matched" in (top.discovery_reason or "")


async def test_search_pagination(adapter) -> None:
    first = await adapter.search_people(SearchCriteria(limit=3))
    assert len(first.people) == 3
    assert first.next_cursor is not None

    second = await adapter.search_people(SearchCriteria(limit=3, cursor=first.next_cursor))
    assert {p.external_id for p in first.people}.isdisjoint({p.external_id for p in second.people})


async def test_profile_not_found_is_structured(adapter) -> None:
    with pytest.raises(PlatformError) as exc:
        await adapter.get_profile("does-not-exist")
    assert exc.value.code.value == "PROFILE_NOT_FOUND"


async def test_posts_include_platform_chrome_for_the_filter_to_reject(adapter) -> None:
    posts = await adapter.get_posts("mock-p-001", limit=20)
    assert any(not p.is_authored_post for p in posts), "expected ads/job cards in the feed"
    assert any(p.is_authored_post for p in posts)


async def test_like_is_idempotent_at_the_platform_level(adapter) -> None:
    first = await adapter.like_post("mock-post-001-a")
    assert first.success and not first.already_done

    second = await adapter.like_post("mock-post-001-a")
    assert second.success and second.already_done


async def test_connection_request_transitions_status(adapter) -> None:
    assert await adapter.get_connection_status("mock-p-002") is ConnectionStatus.NOT_CONNECTED

    outcome = await adapter.send_connection("mock-p-002", "Hi Rahul, enjoyed your Conway post.")
    assert outcome.success

    assert await adapter.get_connection_status("mock-p-002") is ConnectionStatus.PENDING
    repeat = await adapter.send_connection("mock-p-002", "again")
    assert repeat.already_done


async def test_connection_note_length_is_enforced(adapter) -> None:
    with pytest.raises(PlatformError, match="300 character"):
        await adapter.send_connection("mock-p-004", "x" * 301)


async def test_comment_returns_an_external_id(adapter) -> None:
    outcome = await adapter.comment_on_post("mock-post-002-a", "A specific observation.")
    assert outcome.success
    assert outcome.external_id
    assert adapter.comments["mock-post-002-a"] == ["A specific observation."]


async def test_injected_failures_surface_as_platform_errors() -> None:
    flaky = MockSocialPlatformAdapter(failure_rate=1.0)
    with pytest.raises(PlatformError):
        await flaky.search_people(SearchCriteria(limit=1))


def test_mock_adapter_supports_every_capability(adapter) -> None:
    assert all(
        support is CapabilitySupport.SUPPORTED for support in adapter.capabilities.values()
    )


# ---------------------------------------------------------------- linkedin --


def test_linkedin_declares_capabilities_honestly() -> None:
    adapter = LinkedInAdapter()
    assert adapter.capabilities[PlatformCapability.SEARCH] is CapabilitySupport.UNSUPPORTED
    assert adapter.capabilities[PlatformCapability.CONNECTION] is CapabilitySupport.MANUAL_REQUIRED
    assert adapter.capability_note(PlatformCapability.CONNECTION)


async def test_linkedin_refuses_unsupported_operations_with_an_explanation() -> None:
    adapter = LinkedInAdapter()
    with pytest.raises(PlatformError) as exc:
        await adapter.search_people(SearchCriteria(limit=1))
    assert exc.value.code.value == "CAPABILITY_UNSUPPORTED"
    assert "partner programme" in exc.value.message


def test_require_raises_for_an_unsupported_capability(adapter) -> None:
    class Limited(MockSocialPlatformAdapter):
        @property
        def capabilities(self):
            return {PlatformCapability.SEARCH: CapabilitySupport.UNSUPPORTED}

    with pytest.raises(CapabilityUnsupportedError):
        Limited().require(PlatformCapability.SEARCH)
