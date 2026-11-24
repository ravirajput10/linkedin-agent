"""Bright Data, Unipile and composite adapters, against mocked HTTP.

The fixtures mirror each vendor's published response schema. They pin the field
mapping — the part most likely to be wrong — so a vendor rename shows up as a
failing test rather than a silently empty column.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from app.config import PlatformAdapterName, Settings
from app.enums import CapabilitySupport, ConnectionStatus, PlatformCapability, PostType
from app.errors import PlatformError
from app.integrations.platform.base import SearchCriteria

# --------------------------------------------------------------- fixtures --

BRIGHTDATA_PROFILE = {
    "id": "ananya-rao-123",
    "linkedin_num_id": "48219371",
    "url": "https://www.linkedin.com/in/ananya-rao-123/",
    "name": "Ananya Rao",
    "position": "CTO",
    "current_company_name": "Finflow",
    "city": "Bengaluru, India",
    "about": "Payment infrastructure. Java, Spring Boot, Kafka, applied AI.",
    "avatar": "https://media.example.invalid/ananya.jpg",
    "industry": "SaaS",
}

BRIGHTDATA_POSTS = [
    {
        "id": "urn:li:activity:7100000000000000001",
        "url": "https://www.linkedin.com/posts/activity-7100000000000000001",
        "post_text": (
            "We moved settlement off a shared Postgres table onto Kafka with "
            "per-tenant partitions and p99 dropped because row-lock contention "
            "disappeared during the end-of-day batch."
        ),
        "date_posted": "2026-09-28T09:12:00.000Z",
        "num_likes": "214",
        "num_comments": 31,
    },
    {
        "id": "urn:li:activity:7100000000000000002",
        "post_text": "Short.",
        "date_posted": "2026-09-20T07:00:00Z",
        "num_likes": 4,
    },
]

UNIPILE_PROFILE = {
    "provider_id": "ACoAAB1234567",
    "public_identifier": "ananya-rao-123",
    "first_name": "Ananya",
    "last_name": "Rao",
    "headline": "CTO at Finflow",
    "location": "Bengaluru, India",
    "network_distance": "DISTANCE_2",
    "profile_picture_url": "https://media.example.invalid/ananya.jpg",
}

UNIPILE_POSTS = {
    "items": [
        {
            "provider": "LINKEDIN",
            "id": "post-1",
            "social_id": "urn:li:activity:7100000000000000001",
            "share_url": "https://www.linkedin.com/feed/update/urn:li:activity:7100000000000000001",
            "text": "Virtual threads made the connection pool the real bottleneck.",
            "parsed_datetime": "2026-09-28T09:12:00Z",
            "reaction_counter": 389,
            "comment_counter": 47,
            "author": {"id": "ACoAAB1234567", "name": "Ananya Rao"},
            "attachments": [{"type": "img"}],
        }
    ],
    "cursor": "next-page-token",
}


def mock_transport(handler) -> httpx.MockTransport:
    return httpx.MockTransport(handler)


def brightdata_settings(**overrides: Any) -> Settings:
    return Settings(
        platform_adapter=PlatformAdapterName.BRIGHTDATA,
        brightdata_api_token="test-token",
        brightdata_dataset_people_search="gd_search",
        **overrides,
    )


def unipile_settings(**overrides: Any) -> Settings:
    return Settings(
        platform_adapter=PlatformAdapterName.UNIPILE,
        unipile_dsn="api8.unipile.com:13843",
        unipile_api_key="test-key",
        unipile_account_id="acct_1",
        **overrides,
    )


# ------------------------------------------------------------- brightdata --


def build_brightdata(handler):
    from app.integrations.platform.brightdata_adapter import BrightDataAdapter

    adapter = BrightDataAdapter(brightdata_settings())
    adapter._client = httpx.AsyncClient(
        base_url="https://api.brightdata.com",
        transport=mock_transport(handler),
        headers={"Authorization": "Bearer test-token"},
    )
    return adapter


def test_brightdata_requires_a_token() -> None:
    from app.integrations.platform.brightdata_adapter import BrightDataAdapter

    with pytest.raises(PlatformError, match="BRIGHTDATA_API_TOKEN"):
        BrightDataAdapter(Settings(brightdata_api_token=""))


def test_brightdata_profile_mapping() -> None:
    from app.integrations.platform.brightdata_adapter import map_profile

    profile = map_profile(BRIGHTDATA_PROFILE)
    assert profile.external_id == "48219371"
    assert profile.full_name == "Ananya Rao"
    assert profile.job_title == "CTO"
    assert profile.company == "Finflow"
    assert profile.location == "Bengaluru, India"
    assert profile.profile_url.endswith("/in/ananya-rao-123/")
    # A data provider cannot see the user's own connection graph.
    assert profile.connection_status is ConnectionStatus.UNKNOWN


def test_brightdata_post_mapping_coerces_vendor_types() -> None:
    from app.integrations.platform.brightdata_adapter import map_post

    post = map_post(BRIGHTDATA_POSTS[0], "48219371")
    assert post.external_id == "urn:li:activity:7100000000000000001"
    assert "per-tenant partitions" in post.content
    assert post.like_count == 214, "counts arrive as strings"
    assert post.comment_count == 31
    assert post.published_at is not None and post.published_at.year == 2026
    assert post.post_type is PostType.TEXT


def test_brightdata_mapping_survives_missing_fields() -> None:
    from app.integrations.platform.brightdata_adapter import map_post, map_profile

    profile = map_profile({"url": "https://www.linkedin.com/in/x/", "name": "X"})
    assert profile.full_name == "X"
    assert profile.company is None

    post = map_post({"id": "p1"}, "author-1")
    assert post.content == ""
    assert post.like_count is None


async def test_brightdata_get_profile_uses_the_sync_endpoint() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=[BRIGHTDATA_PROFILE])

    adapter = build_brightdata(handler)
    profile = await adapter.get_profile("ananya-rao-123")

    assert profile.full_name == "Ananya Rao"
    assert seen[0].url.path == "/datasets/v3/scrape"
    assert seen[0].url.params["dataset_id"] == "gd_l1viktl72bvl7bjuj0"
    assert json.loads(seen[0].content)[0]["url"].endswith("/in/ananya-rao-123")
    await adapter.aclose()


async def test_brightdata_posts_use_discovery_mode() -> None:
    """Posts-by-profile is a discovery job, not a fetch.

    The posts dataset rejects a profile URL outright unless the request is
    marked discover_new/profile_url: "Value should match pattern
    .*linkedin.com/(pulse|posts|feed/update).*"
    """
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if request.url.path == "/datasets/v3/trigger":
            return httpx.Response(200, json={"snapshot_id": "snap_1"})
        if request.url.path == "/datasets/v3/progress/snap_1":
            running = sum(1 for c in calls if "progress" in c.url.path) == 1
            return httpx.Response(200, json={"status": "running" if running else "ready"})
        return httpx.Response(200, json=BRIGHTDATA_POSTS)

    adapter = build_brightdata(handler)
    adapter._settings = brightdata_settings(brightdata_poll_interval_seconds=0.0)

    posts = await adapter.get_posts("ananya-rao-123", limit=5)
    assert len(posts) == 2

    trigger = calls[0]
    assert trigger.url.path == "/datasets/v3/trigger"
    assert trigger.url.params["type"] == "discover_new"
    assert trigger.url.params["discover_by"] == "profile_url"
    assert json.loads(trigger.content)[0] == {"url": "https://www.linkedin.com/in/ananya-rao-123"}

    # and it genuinely polls rather than assuming the first answer
    assert sum(1 for c in calls if "progress" in c.url.path) == 2
    assert any("/datasets/v3/snapshot/snap_1" in c.url.path for c in calls)
    await adapter.aclose()


async def test_brightdata_posts_request_carries_no_date_fields() -> None:
    """The dataset rejects start_date/end_date/only_authored_posts.

    Date windowing is applied client-side instead, so the request body must stay
    bare.
    """
    bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/datasets/v3/trigger":
            bodies.append(json.loads(request.content)[0])
            return httpx.Response(200, json={"snapshot_id": "s"})
        if "progress" in request.url.path:
            return httpx.Response(200, json={"status": "ready"})
        return httpx.Response(200, json=BRIGHTDATA_POSTS)

    adapter = build_brightdata(handler)
    adapter._settings = brightdata_settings(brightdata_poll_interval_seconds=0.0)
    await adapter.get_posts("x", limit=5)

    assert set(bodies[0]) == {"url"}
    await adapter.aclose()


async def test_brightdata_drops_posts_older_than_the_lookback() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/datasets/v3/trigger":
            return httpx.Response(200, json={"snapshot_id": "s"})
        if "progress" in request.url.path:
            return httpx.Response(200, json={"status": "ready"})
        return httpx.Response(
            200,
            json=[
                {"id": "recent", "post_text": "x", "date_posted": "2026-09-28T00:00:00Z"},
                {"id": "ancient", "post_text": "y", "date_posted": "2019-01-01T00:00:00Z"},
            ],
        )

    adapter = build_brightdata(handler)
    adapter._settings = brightdata_settings(
        brightdata_poll_interval_seconds=0.0, brightdata_post_lookback_days=60
    )
    posts = await adapter.get_posts("x", limit=10)
    assert [p.external_id for p in posts] == ["recent"]
    await adapter.aclose()


async def test_brightdata_failed_job_raises() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/datasets/v3/scrape":
            return httpx.Response(202, json={"snapshot_id": "snap_2"})
        return httpx.Response(200, json={"status": "failed"})

    adapter = build_brightdata(handler)
    adapter._settings = brightdata_settings(brightdata_poll_interval_seconds=0.0)

    with pytest.raises(PlatformError, match="finished as failed"):
        await adapter.get_profile("someone")
    await adapter.aclose()


async def test_brightdata_surfaces_the_error_body() -> None:
    """'Customer is not active' must reach the user, not be swallowed."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, text="Customer is not active")

    adapter = build_brightdata(handler)
    with pytest.raises(PlatformError, match="Customer is not active"):
        await adapter.get_profile("someone")
    await adapter.aclose()


async def test_brightdata_posts_are_capped_and_newest_first() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/datasets/v3/trigger":
            return httpx.Response(200, json={"snapshot_id": "s"})
        if "progress" in request.url.path:
            return httpx.Response(200, json={"status": "ready"})
        return httpx.Response(200, json=BRIGHTDATA_POSTS)

    adapter = build_brightdata(handler)
    adapter._settings = brightdata_settings(brightdata_poll_interval_seconds=0.0)
    posts = await adapter.get_posts("x", limit=1)
    assert len(posts) == 1
    assert posts[0].external_id.endswith("001"), "newest first"
    await adapter.aclose()


def test_brightdata_cannot_engage() -> None:
    from app.integrations.platform.brightdata_adapter import BrightDataAdapter

    adapter = BrightDataAdapter(brightdata_settings())
    caps = adapter.capabilities
    assert caps[PlatformCapability.POST_READ] is CapabilitySupport.SUPPORTED
    for capability in (
        PlatformCapability.LIKE,
        PlatformCapability.COMMENT,
        PlatformCapability.CONNECTION,
    ):
        assert caps[capability] is CapabilitySupport.UNSUPPORTED
        with pytest.raises(PlatformError, match="cannot act on your LinkedIn account"):
            adapter.require(capability)


def test_brightdata_search_needs_a_configured_dataset() -> None:
    from app.integrations.platform.brightdata_adapter import BrightDataAdapter

    adapter = BrightDataAdapter(
        Settings(brightdata_api_token="t", brightdata_dataset_people_search="")
    )
    assert adapter.capabilities[PlatformCapability.SEARCH] is CapabilitySupport.UNSUPPORTED


# ---------------------------------------------------------------- unipile --


def build_unipile(handler, **overrides: Any):
    from app.integrations.platform.unipile_adapter import UnipileAdapter

    adapter = UnipileAdapter(unipile_settings(**overrides))
    adapter._client = httpx.AsyncClient(
        base_url="https://api8.unipile.com:13843/api/v1",
        transport=mock_transport(handler),
        headers={"X-API-KEY": "test-key"},
    )
    return adapter


def test_unipile_requires_full_configuration() -> None:
    from app.integrations.platform.unipile_adapter import UnipileAdapter

    with pytest.raises(PlatformError, match="UNIPILE_DSN"):
        UnipileAdapter(Settings(unipile_dsn="", unipile_api_key="k", unipile_account_id="a"))


def test_unipile_profile_mapping_builds_the_name_from_parts() -> None:
    from app.integrations.platform.unipile_adapter import map_profile

    profile = map_profile(UNIPILE_PROFILE)
    assert profile.external_id == "ACoAAB1234567"
    assert profile.full_name == "Ananya Rao"
    assert profile.headline == "CTO at Finflow"
    assert profile.profile_url.endswith("/in/ananya-rao-123")
    # 2nd degree is reachable but not yet connected.
    assert profile.connection_status is ConnectionStatus.NOT_CONNECTED


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("DISTANCE_1", ConnectionStatus.CONNECTED),
        ("DISTANCE_2", ConnectionStatus.NOT_CONNECTED),
        ("pending", ConnectionStatus.PENDING),
        ("something-new", ConnectionStatus.UNKNOWN),
        (None, ConnectionStatus.UNKNOWN),
    ],
)
def test_unipile_connection_degree_mapping(raw, expected) -> None:
    from app.integrations.platform.unipile_adapter import map_profile

    assert map_profile({**UNIPILE_PROFILE, "network_distance": raw}).connection_status is expected


def test_unipile_post_mapping() -> None:
    from app.integrations.platform.unipile_adapter import map_post

    post = map_post(UNIPILE_POSTS["items"][0], "ACoAAB1234567")
    assert post.external_id == "urn:li:activity:7100000000000000001"
    assert post.like_count == 389
    assert post.comment_count == 47
    assert post.post_type is PostType.IMAGE, "derived from the attachment type"


async def test_unipile_search_sends_account_and_filters() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path.endswith("/search/parameters"):
            return httpx.Response(200, json={"items": []})
        return httpx.Response(200, json={"items": [UNIPILE_PROFILE], "cursor": "c1"})

    adapter = build_unipile(handler)
    result = await adapter.search_people(
        SearchCriteria(job_titles=["CTO"], keywords=["Java"], limit=10)
    )

    assert len(result.people) == 1
    assert result.next_cursor == "c1"
    assert result.people[0].matched_criteria == ["CTO"]

    search = next(r for r in seen if r.url.path.endswith("/linkedin/search"))
    body = json.loads(search.content)
    assert body["api"] == "classic"
    assert body["category"] == "people"
    assert body["role"] == ["CTO"]
    assert body["keywords"] == "Java"
    assert search.url.params["account_id"] == "acct_1"
    await adapter.aclose()


async def test_unipile_like_and_comment() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"id": "obj-1"})

    adapter = build_unipile(handler)

    like = await adapter.like_post("urn:li:activity:1")
    assert like.success
    assert seen[-1].url.path.endswith("/posts/urn:li:activity:1/reaction")

    comment = await adapter.comment_on_post("urn:li:activity:1", "A specific observation.")
    assert comment.success
    assert json.loads(seen[-1].content)["text"] == "A specific observation."
    await adapter.aclose()


async def test_unipile_refuses_an_empty_comment() -> None:
    adapter = build_unipile(lambda r: httpx.Response(200, json={}))
    with pytest.raises(PlatformError, match="empty comment"):
        await adapter.comment_on_post("p1", "   ")
    await adapter.aclose()


async def test_unipile_connection_note_limit_is_enforced_before_sending() -> None:
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, json={"invitation_id": "inv-1"})

    adapter = build_unipile(handler)
    with pytest.raises(PlatformError, match="LinkedIn allows 300"):
        await adapter.send_connection("ACoAAB1234567", "x" * 301)
    assert not calls, "must not reach the network"

    outcome = await adapter.send_connection("ACoAAB1234567", "Hi Ananya, enjoyed your Kafka post.")
    assert outcome.success and outcome.external_id == "inv-1"
    await adapter.aclose()


async def test_unipile_403_explains_the_subscription_requirement() -> None:
    adapter = build_unipile(
        lambda r: httpx.Response(403, text="forbidden"),
        unipile_search_api="sales_navigator",
    )
    with pytest.raises(PlatformError) as exc:
        await adapter.search_people(SearchCriteria(job_titles=["CTO"], limit=5))

    assert exc.value.code.value == "AUTHENTICATION_EXPIRED"
    assert "Sales Navigator" in exc.value.message
    await adapter.aclose()


async def test_unipile_429_is_a_rate_limit_not_a_failure() -> None:
    adapter = build_unipile(lambda r: httpx.Response(429, text="slow down"))
    with pytest.raises(PlatformError) as exc:
        await adapter.search_people(SearchCriteria(job_titles=["CTO"], limit=5))
    assert exc.value.code.value == "RATE_LIMIT_REACHED"
    await adapter.aclose()


# -------------------------------------------------------------- composite --


async def test_composite_routes_reads_and_writes_to_the_right_half() -> None:
    from app.integrations.platform.composite_adapter import CompositeAdapter
    from app.integrations.platform.mock_adapter import MockSocialPlatformAdapter

    reader = MockSocialPlatformAdapter()
    writer = MockSocialPlatformAdapter()
    composite = CompositeAdapter(reader, writer)

    await composite.get_posts("mock-p-001", limit=5)
    await composite.like_post("mock-post-001-a")

    assert any(op == "get_posts" for op, _ in reader.call_log)
    assert not any(op == "like_post" for op, _ in reader.call_log)
    assert any(op == "like_post" for op, _ in writer.call_log)
    assert composite.platform == "mock+mock"


def test_composite_capability_matrix_is_split() -> None:
    from app.integrations.platform.brightdata_adapter import BrightDataAdapter
    from app.integrations.platform.composite_adapter import CompositeAdapter
    from app.integrations.platform.mock_adapter import MockSocialPlatformAdapter

    composite = CompositeAdapter(
        BrightDataAdapter(brightdata_settings()), MockSocialPlatformAdapter()
    )
    caps = composite.capabilities

    assert caps[PlatformCapability.POST_READ] is CapabilitySupport.SUPPORTED
    # Bright Data cannot engage, but the writer can — the composite must report
    # the writer's answer, not the reader's.
    assert caps[PlatformCapability.COMMENT] is CapabilitySupport.SUPPORTED
    composite.require(PlatformCapability.COMMENT)


async def test_composite_asks_the_writer_for_connection_status() -> None:
    """Only the member's own session can see their connection graph."""
    from app.integrations.platform.composite_adapter import CompositeAdapter
    from app.integrations.platform.mock_adapter import MockSocialPlatformAdapter

    reader = MockSocialPlatformAdapter()
    writer = MockSocialPlatformAdapter()
    writer.connections["mock-p-001"] = ConnectionStatus.CONNECTED

    composite = CompositeAdapter(reader, writer)
    assert await composite.get_connection_status("mock-p-001") is ConnectionStatus.CONNECTED


def test_composite_rejects_recursive_configuration() -> None:
    from app.integrations.platform.composite_adapter import build_composite

    with pytest.raises(ValueError, match="cannot itself be"):
        build_composite(
            Settings(
                platform_adapter=PlatformAdapterName.COMPOSITE,
                composite_read_adapter=PlatformAdapterName.COMPOSITE,
            )
        )


async def test_brightdata_empty_result_with_errors_is_a_failure_not_an_empty_feed() -> None:
    """A dead page must not look like "this person has no posts".

    Observed live: status "ready", records 0, error_codes {"dead_page": 1}.
    Returning [] there would make the workflow skip the candidate for the wrong
    reason, with nothing in the audit trail to say why.
    """

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/datasets/v3/trigger":
            return httpx.Response(200, json={"snapshot_id": "sd_dead"})
        if "progress" in request.url.path:
            return httpx.Response(
                200,
                json={
                    "status": "ready",
                    "records": 0,
                    "errors": 1,
                    "error_codes": {"dead_page": 1},
                },
            )
        return httpx.Response(200, json=[])

    adapter = build_brightdata(handler)
    adapter._settings = brightdata_settings(brightdata_poll_interval_seconds=0.0)

    with pytest.raises(PlatformError, match="collected nothing"):
        await adapter.get_posts("someone", limit=5)
    await adapter.aclose()


async def test_brightdata_genuinely_empty_feed_is_not_an_error() -> None:
    """Zero records with zero errors means the person really has no posts."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/datasets/v3/trigger":
            return httpx.Response(200, json={"snapshot_id": "sd_empty"})
        if "progress" in request.url.path:
            return httpx.Response(200, json={"status": "ready", "records": 0, "errors": 0})
        return httpx.Response(200, json=[])

    adapter = build_brightdata(handler)
    adapter._settings = brightdata_settings(brightdata_poll_interval_seconds=0.0)

    assert await adapter.get_posts("someone", limit=5) == []
    await adapter.aclose()


# ------------------------------- unipile: corrections found against the live API --

UNIPILE_FULL_PROFILE = {
    "provider_id": "ACoAAA8BYqEBCGLg",
    "public_identifier": "williamhgates",
    "first_name": "Bill",
    "last_name": "Gates",
    "headline": "Chair, Gates Foundation and Founder, Breakthrough Energy",
    "location": "Seattle, Washington, United States",
    "network_distance": "DISTANCE_2",
    # only present when linkedin_sections is requested
    "work_experience": [
        {"position": "Co-chair", "company": "Gates Foundation"},
        {"position": "Founder", "company": "Microsoft"},
    ],
}


def test_unipile_company_comes_from_work_experience() -> None:
    """The default profile payload has no employer field at all."""
    from app.integrations.platform.unipile_adapter import map_profile

    profile = map_profile(UNIPILE_FULL_PROFILE)
    assert profile.company == "Gates Foundation"
    assert profile.job_title == "Co-chair", "the role, not the headline"


def test_unipile_falls_back_to_headline_without_sections() -> None:
    from app.integrations.platform.unipile_adapter import map_profile

    bare = {k: v for k, v in UNIPILE_FULL_PROFILE.items() if k != "work_experience"}
    profile = map_profile(bare)
    assert profile.company is None
    assert profile.job_title == bare["headline"]


async def test_unipile_profile_requests_the_extra_sections() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=UNIPILE_FULL_PROFILE)

    adapter = build_unipile(handler)
    await adapter.get_profile("williamhgates")
    assert seen[0].url.params["linkedin_sections"] == "*"
    await adapter.aclose()


async def test_unipile_resolves_a_public_handle_before_fetching_posts() -> None:
    """The posts endpoint 422s on a public handle; it wants the provider id."""
    paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        paths.append(request.url.path)
        if request.url.path.endswith("/posts"):
            return httpx.Response(200, json=UNIPILE_POSTS)
        return httpx.Response(200, json=UNIPILE_FULL_PROFILE)

    adapter = build_unipile(handler)
    await adapter.get_posts("williamhgates", limit=5)

    assert paths[0] == "/api/v1/users/williamhgates", "looks the handle up first"
    assert paths[1].endswith("/users/ACoAAA8BYqEBCGLg/posts"), "then uses the provider id"
    await adapter.aclose()


async def test_unipile_skips_the_lookup_when_given_a_provider_id() -> None:
    paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        paths.append(request.url.path)
        return httpx.Response(200, json=UNIPILE_POSTS)

    adapter = build_unipile(handler)
    await adapter.get_posts("ACoAAA8BYqEBCGLg", limit=5)
    assert len(paths) == 1
    await adapter.aclose()


async def test_unipile_resolves_location_and_industry_to_linkedin_ids() -> None:
    """Free-text location/industry are rejected with a 400; ids are required."""
    bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/search/parameters"):
            kind = request.url.params["type"]
            name = request.url.params["keywords"]
            return httpx.Response(
                200,
                json={
                    "items": [
                        # a near-miss first, to prove exact titles win
                        {"title": f"Greater {name} Area", "id": "999"},
                        {"title": name, "id": "102713980" if kind == "LOCATION" else "96"},
                    ]
                },
            )
        bodies.append(json.loads(request.content))
        return httpx.Response(200, json={"items": [UNIPILE_PROFILE]})

    adapter = build_unipile(handler)
    await adapter.search_people(
        SearchCriteria(job_titles=["CTO"], locations=["India"], industries=["Software"], limit=5)
    )

    sent = bodies[0]
    assert sent["location"] == ["102713980"], "the exact title's id, not the near-miss"
    assert sent["industry"] == ["96"]
    assert sent["role"] == ["CTO"], "job titles stay free text — those are accepted"
    await adapter.aclose()


async def test_unipile_drops_a_filter_linkedin_cannot_resolve() -> None:
    """Live: 'SaaS' has no INDUSTRY id. Better to search without it than 400."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/search/parameters"):
            return httpx.Response(200, json={"items": []})
        return httpx.Response(200, json={"items": [UNIPILE_PROFILE]})

    adapter = build_unipile(handler)
    result = await adapter.search_people(
        SearchCriteria(job_titles=["CTO"], industries=["SaaS"], limit=5)
    )
    assert len(result.people) == 1
    await adapter.aclose()


async def test_unipile_search_parameters_are_cached() -> None:
    lookups: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/search/parameters"):
            lookups.append(request.url.params["keywords"])
            return httpx.Response(200, json={"items": [{"title": "India", "id": "102713980"}]})
        return httpx.Response(200, json={"items": []})

    adapter = build_unipile(handler)
    for _ in range(3):
        await adapter.search_people(SearchCriteria(locations=["India"], limit=5))
    assert lookups == ["India"], "resolved once, then reused"
    await adapter.aclose()


async def test_unipile_search_needs_at_least_one_filter() -> None:
    adapter = build_unipile(lambda r: httpx.Response(200, json={"items": []}))
    with pytest.raises(PlatformError, match="at least one of"):
        await adapter.search_people(SearchCriteria(limit=5))
    await adapter.aclose()
