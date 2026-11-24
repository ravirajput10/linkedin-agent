"""The deterministic filter that answers 'is this even a post?'."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from app.enums import PostType
from app.integrations.platform.base import PlatformPost
from app.services import eligibility

SUBSTANTIVE = (
    "We moved the settlement pipeline onto Kafka with per-tenant partitions and "
    "the p99 dropped because we stopped contending on row locks during the batch."
)


def criteria(**overrides):
    base = {
        "post_types": [],
        "exclude_keywords": [],
        "min_post_age_hours": None,
        "max_post_age_days": 30,
    }
    return SimpleNamespace(**(base | overrides))


def post(**overrides) -> PlatformPost:
    base = {
        "external_id": "p1",
        "author_external_id": "a1",
        "content": SUBSTANTIVE,
        "post_type": PostType.TEXT,
        "published_at": datetime.now(UTC) - timedelta(hours=10),
    }
    return PlatformPost(**(base | overrides))


def test_substantive_post_is_eligible() -> None:
    assert eligibility.evaluate(post(), criteria()).eligible


def test_promoted_content_is_not_a_post() -> None:
    verdict = eligibility.evaluate(post(is_authored_post=False), criteria())
    assert not verdict.eligible
    assert "Not an authored post" in verdict.reason


@pytest.mark.parametrize("post_type", [PostType.JOB, PostType.ADVERTISEMENT])
def test_job_cards_and_ads_are_never_eligible(post_type) -> None:
    assert not eligibility.evaluate(post(post_type=post_type), criteria()).eligible


def test_post_type_outside_the_campaign_allowlist_is_rejected() -> None:
    verdict = eligibility.evaluate(
        post(post_type=PostType.VIDEO), criteria(post_types=["TEXT", "ARTICLE"])
    )
    assert not verdict.eligible
    assert "outside the campaign's allowed types" in verdict.reason


def test_bare_repost_is_rejected() -> None:
    verdict = eligibility.evaluate(
        post(is_repost=True, has_added_commentary=False), criteria()
    )
    assert not verdict.eligible
    assert "no added commentary" in verdict.reason


def test_repost_with_commentary_is_kept() -> None:
    assert eligibility.evaluate(
        post(is_repost=True, has_added_commentary=True), criteria()
    ).eligible


def test_too_short_to_engage_with() -> None:
    assert not eligibility.evaluate(post(content="Great news today!"), criteria()).eligible


@pytest.mark.parametrize(
    "content",
    [
        "We are hiring senior Java engineers for our platform team in Bengaluru now",
        "Comment YES below if you want the free architecture guide sent to you today",
        "Check the link in bio for the full breakdown of our new platform offering",
    ],
)
def test_recruitment_and_bait_are_filtered_without_an_ai_call(content: str) -> None:
    assert not eligibility.evaluate(post(content=content), criteria()).eligible


def test_campaign_exclude_keywords_are_applied() -> None:
    verdict = eligibility.evaluate(
        post(), criteria(exclude_keywords=["settlement"])
    )
    assert not verdict.eligible
    assert "settlement" in verdict.reason


def test_posts_older_than_the_window_are_rejected() -> None:
    old = post(published_at=datetime.now(UTC) - timedelta(days=90))
    verdict = eligibility.evaluate(old, criteria(max_post_age_days=30))
    assert not verdict.eligible
    assert "Older than" in verdict.reason


def test_posts_newer_than_the_minimum_age_are_rejected() -> None:
    fresh = post(published_at=datetime.now(UTC) - timedelta(minutes=30))
    verdict = eligibility.evaluate(fresh, criteria(min_post_age_hours=6))
    assert not verdict.eligible
    assert "Newer than" in verdict.reason


def test_filter_returns_newest_first_and_keeps_the_rejects() -> None:
    now = datetime.now(UTC)
    posts = [
        post(external_id="old", published_at=now - timedelta(days=3)),
        post(external_id="ad", post_type=PostType.ADVERTISEMENT, published_at=now),
        post(external_id="new", published_at=now - timedelta(hours=2)),
    ]
    annotated = eligibility.filter_eligible(posts, criteria())

    assert [item[0].external_id for item in annotated] == ["ad", "new", "old"]
    assert [item[0].external_id for item in annotated if item[1].eligible] == ["new", "old"]


# ------------------------------------------------- profile URL identity --


@pytest.mark.parametrize(
    "url",
    [
        "https://in.linkedin.com/in/Williamhgates",
        "https://mx.linkedin.com/in/williamhgates/",
        "https://nz.linkedin.com/in/Williamhgates?trk=public",
        "https://www.linkedin.com/in/williamhgates",
        "HTTPS://WWW.LINKEDIN.COM/in/WilliamHGates/",
    ],
)
def test_country_mirrors_and_casing_resolve_to_one_identity(url: str) -> None:
    """Live data returned all of these for the same person.

    Person identity is keyed on this URL, so without normalising it the same
    human is rediscovered every run and gets liked and contacted again.
    """
    from app.workflows.discovery import normalise_profile_url

    assert normalise_profile_url(url) == "https://www.linkedin.com/in/williamhgates"


def test_member_ids_keep_their_casing() -> None:
    """Vanity handles are case-insensitive; ACoAA member ids are not."""
    from app.workflows.discovery import normalise_profile_url

    url = "https://www.linkedin.com/in/ACoAAA8BYqEBCGLg"
    assert normalise_profile_url(url) == url


def test_normalisation_leaves_odd_input_alone() -> None:
    from app.workflows.discovery import normalise_profile_url

    assert normalise_profile_url("") == ""
    assert normalise_profile_url("not-a-url") == "not-a-url"
