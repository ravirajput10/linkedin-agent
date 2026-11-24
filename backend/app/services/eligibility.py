"""Deterministic post eligibility filter.

Runs *before* any AI call. Its job is to answer "is this even a post?" — the
platform returns advertisements, job cards and other chrome alongside genuine
content, and none of that should be counted toward "post #1, #2, #3".

Topic relevance is a separate, AI-driven question handled by the post evaluator.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from app.database.models import CampaignCriteria
from app.enums import DEFAULT_ELIGIBLE_POST_TYPES, PostType
from app.integrations.platform.base import PlatformPost

#: Phrases that mark content as recruitment or engagement bait without needing a
#: model call. Deliberately conservative — borderline cases go to the evaluator.
HARD_EXCLUDE_PHRASES: tuple[str, ...] = (
    "we are hiring",
    "we're hiring",
    "now hiring",
    "urgent hiring",
    "urgently hiring",
    "apply now",
    "dm me your cv",
    "send your resume",
    "share your resume",
    "immediate joiners",
    "job opening",
    "comment yes",
    "repost if",
    "link in bio",
    "book a demo",
    "limited time offer",
)

MIN_CONTENT_WORDS = 15


@dataclass(frozen=True, slots=True)
class EligibilityVerdict:
    eligible: bool
    reason: str | None = None


def _allowed_types(criteria: CampaignCriteria) -> set[PostType]:
    if not criteria.post_types:
        return set(DEFAULT_ELIGIBLE_POST_TYPES)
    allowed: set[PostType] = set()
    for raw in criteria.post_types:
        try:
            post_type = PostType(str(raw).upper())
        except ValueError:
            continue
        if post_type in DEFAULT_ELIGIBLE_POST_TYPES:
            allowed.add(post_type)
    return allowed or set(DEFAULT_ELIGIBLE_POST_TYPES)


def evaluate(post: PlatformPost, criteria: CampaignCriteria) -> EligibilityVerdict:
    if not post.is_authored_post:
        return EligibilityVerdict(False, "Not an authored post (promoted or platform content).")

    if post.post_type in (PostType.JOB, PostType.ADVERTISEMENT):
        return EligibilityVerdict(False, f"Post type {post.post_type.value} is never eligible.")

    if post.post_type not in _allowed_types(criteria):
        return EligibilityVerdict(
            False, f"Post type {post.post_type.value} is outside the campaign's allowed types."
        )

    if post.is_repost and not post.has_added_commentary:
        return EligibilityVerdict(False, "Repost with no added commentary.")

    content = (post.content or "").strip()
    if len(content.split()) < MIN_CONTENT_WORDS:
        return EligibilityVerdict(
            False, f"Under {MIN_CONTENT_WORDS} words of content."
        )

    lowered = content.lower()
    for phrase in HARD_EXCLUDE_PHRASES:
        if phrase in lowered:
            return EligibilityVerdict(False, f"Contains excluded phrase {phrase!r}.")

    for keyword in criteria.exclude_keywords:
        if keyword and keyword.lower() in lowered:
            return EligibilityVerdict(False, f"Matches campaign exclude keyword {keyword!r}.")

    if post.published_at is not None:
        published = post.published_at
        if published.tzinfo is None:
            published = published.replace(tzinfo=UTC)
        now = datetime.now(UTC)

        if criteria.min_post_age_hours:
            if now - published < timedelta(hours=criteria.min_post_age_hours):
                return EligibilityVerdict(
                    False, f"Newer than the campaign's {criteria.min_post_age_hours}h minimum age."
                )
        if criteria.max_post_age_days:
            if now - published > timedelta(days=criteria.max_post_age_days):
                return EligibilityVerdict(
                    False, f"Older than the campaign's {criteria.max_post_age_days}d maximum age."
                )

    return EligibilityVerdict(True)


def filter_eligible(
    posts: list[PlatformPost], criteria: CampaignCriteria
) -> list[tuple[PlatformPost, EligibilityVerdict]]:
    """Annotate every post, newest first. Callers keep the rejects for the audit trail."""
    annotated = [(post, evaluate(post, criteria)) for post in posts]
    annotated.sort(
        key=lambda item: item[0].published_at or datetime.min.replace(tzinfo=UTC),
        reverse=True,
    )
    return annotated
