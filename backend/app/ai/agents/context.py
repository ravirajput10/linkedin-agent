"""Turns ORM rows into the plain values prompt templates expect."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from app.database.models import Campaign, CampaignCriteria, Person, Post


def _lines(label: str, values: list[str] | None) -> str:
    if not values:
        return f"{label}: (none specified)"
    return f"{label}: " + ", ".join(values)


def format_campaign_criteria(criteria: CampaignCriteria) -> str:
    """A compact, human-readable rendering of the campaign's rules."""
    return "\n".join(
        [
            "TARGET PEOPLE",
            _lines("  Job titles", criteria.job_titles),
            _lines("  Seniority", criteria.seniority_levels),
            _lines("  Industries", criteria.industries),
            _lines("  Locations", criteria.locations),
            _lines("  Company sizes", criteria.company_sizes),
            _lines("  Profile keywords", criteria.people_keywords),
            "",
            "POST CRITERIA",
            _lines("  Include topics", criteria.include_topics),
            _lines("  Exclude topics", criteria.exclude_topics),
            _lines("  Include keywords", criteria.include_keywords),
            _lines("  Exclude keywords", criteria.exclude_keywords),
            _lines("  Allowed post types", criteria.post_types),
            f"  Minimum relevance score: {criteria.minimum_relevance_score}",
            f"  Minimum candidate match score: {criteria.minimum_candidate_score}",
        ]
    )


def format_exclusions(campaign: Campaign) -> str:
    if not campaign.exclusions:
        return "(none)"
    return "\n".join(
        f"- {item.exclusion_type}: {item.value}"
        + (f" ({item.reason})" if item.reason else "")
        for item in campaign.exclusions
    )


def person_variables(person: Person) -> dict[str, Any]:
    return {
        "candidate_name": person.full_name,
        "candidate_headline": person.headline or "(no headline)",
        "candidate_job_title": person.job_title or "(unknown)",
        "candidate_company": person.company or "(unknown)",
        "candidate_industry": person.industry or "(unknown)",
        "candidate_location": person.location or "(unknown)",
        "candidate_about": (person.about or "(not available)")[:2000],
        "candidate_profile_url": person.profile_url,
    }


def post_variables(post: Post) -> dict[str, Any]:
    age = "(unknown)"
    if post.published_at:
        published = post.published_at
        if published.tzinfo is None:
            published = published.replace(tzinfo=UTC)
        hours = (datetime.now(UTC) - published).total_seconds() / 3600
        age = f"{hours / 24:.1f} days" if hours >= 24 else f"{hours:.1f} hours"
    return {
        "post_content": post.content[:8000],
        "post_type": post.post_type.value,
        "post_age": age,
        "post_like_count": post.like_count if post.like_count is not None else "(unknown)",
        "post_comment_count": post.comment_count if post.comment_count is not None else "(unknown)",
        "post_url": post.post_url or "(not available)",
    }
