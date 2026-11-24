"""Pydantic contracts for every AI agent.

No LLM output reaches the workflow engine without passing through one of these.
"""

from __future__ import annotations

import re

from pydantic import BaseModel, ConfigDict, Field, field_validator


def _camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(word.capitalize() for word in tail)


class AISchema(BaseModel):
    """Base: camelCase on the wire, snake_case in Python, extras rejected."""

    model_config = ConfigDict(
        alias_generator=_camel,
        populate_by_name=True,
        extra="forbid",
        str_strip_whitespace=True,
    )


# --------------------------------------------------------------- campaign --


class TargetPeople(AISchema):
    job_titles: list[str] = Field(default_factory=list, max_length=40)
    industries: list[str] = Field(default_factory=list, max_length=40)
    locations: list[str] = Field(default_factory=list, max_length=40)
    keywords: list[str] = Field(default_factory=list, max_length=60)
    seniority_levels: list[str] = Field(default_factory=list, max_length=20)
    company_sizes: list[str] = Field(default_factory=list, max_length=20)


class PostCriteria(AISchema):
    include_topics: list[str] = Field(default_factory=list, max_length=60)
    exclude_topics: list[str] = Field(default_factory=list, max_length=60)
    include_keywords: list[str] = Field(default_factory=list, max_length=60)
    exclude_keywords: list[str] = Field(default_factory=list, max_length=60)
    post_types: list[str] = Field(default_factory=list, max_length=12)
    minimum_relevance_score: int = Field(default=75, ge=0, le=100)


class EngagementPlan(AISchema):
    initial_posts_to_like: int = Field(default=2, ge=0, le=10)
    evaluate_post_index: int = Field(default=3, ge=1, le=20)
    generate_comment: bool = True
    connection_delay_hours: int = Field(default=48, ge=0, le=720)
    max_people_per_day: int = Field(default=20, ge=1, le=500)


class ParsedCampaign(AISchema):
    """Structured criteria derived from the user's natural-language instruction."""

    campaign_name: str = Field(min_length=1, max_length=200)
    target_people: TargetPeople
    post_criteria: PostCriteria
    engagement: EngagementPlan = Field(default_factory=EngagementPlan)
    summary: str = Field(default="", max_length=2000)


# -------------------------------------------------------------- candidate --


class CandidateEvaluationResult(AISchema):
    match: bool
    score: int = Field(ge=0, le=100)
    matched_criteria: list[str] = Field(default_factory=list, max_length=40)
    reason: str = Field(min_length=1, max_length=2000)
    risk_flags: list[str] = Field(default_factory=list, max_length=20)


# ------------------------------------------------------------------- post --


class PostEvaluationResult(AISchema):
    eligible: bool
    relevance_score: int = Field(ge=0, le=100)
    topics: list[str] = Field(default_factory=list, max_length=20)
    reason: str = Field(min_length=1, max_length=2000)
    risk_flags: list[str] = Field(default_factory=list, max_length=20)


# ---------------------------------------------------------------- writing --

#: Openers that add nothing; the generator is instructed to avoid them and the
#: validator rejects them outright.
BANNED_COMMENT_OPENERS: tuple[str, ...] = (
    "great post",
    "amazing",
    "very insightful",
    "nice sharing",
    "thanks for sharing",
    "well said",
    "so true",
    "love this",
    "couldn't agree more",
    "spot on",
)


#: Phrases that assert first-hand experience the sender may not have. A model
#: that writes "this mirrors our experience migrating to Kafka" has invented a
#: claim about the user's own work, which then goes out under their name — worse
#: than a bland comment, because it is a lie about them. The prompts forbid this
#: and models do it anyway, so it is enforced here instead.
FABRICATED_EXPERIENCE_PATTERNS: tuple[str, ...] = (
    r"\b(?:our|my)\s+(?:experience|team|company|org|organisation|organization"
    r"|stack|setup|pipeline|platform|system|clients?|customers?)\b",
    r"\bwe(?:'ve|'re| have| are| were)?\s+(?:seen|found|hit|ran|run|migrated"
    r"|moved|built|shipped|implemented|experienced|had|been|started|switched"
    r"|solved|tried|use|used|using)\b",
    r"\bI(?:'ve| have)?\s+(?:seen|found|hit|built|shipped|implemented|run"
    r"|worked|spent|led|managed)\b",
    r"\b(?:at|in)\s+(?:my|our)\s+(?:company|org|team|shop|firm)\b",
    r"\bin\s+my\s+experience\b",
    r"\bwhen\s+we\s+\w+",
)

_FABRICATION_RE = re.compile("|".join(FABRICATED_EXPERIENCE_PATTERNS), re.IGNORECASE)


def reject_fabricated_experience(value: str) -> str:
    match = _FABRICATION_RE.search(value)
    if match:
        raise ValueError(
            f"Claims first-hand experience the sender may not have: {match.group(0)!r}. "
            "Write about the post's idea, not about what you or your team did."
        )
    return value


class GeneratedComment(AISchema):
    comment: str = Field(min_length=20, max_length=1200)
    referenced_points: list[str] = Field(default_factory=list, max_length=10)
    confidence: int = Field(default=80, ge=0, le=100)

    @field_validator("comment")
    @classmethod
    def _reject_filler(cls, value: str) -> str:
        lowered = value.lower().lstrip("\"'“‘ ")
        for opener in BANNED_COMMENT_OPENERS:
            if lowered.startswith(opener):
                raise ValueError(
                    f"Comment starts with the generic filler {opener!r}. "
                    "Reference something specific from the post instead."
                )
        return reject_fabricated_experience(value)


class GeneratedConnectionMessage(AISchema):
    #: LinkedIn caps connection notes at 300 characters.
    message: str = Field(min_length=20, max_length=300)
    referenced_post: bool = False
    confidence: int = Field(default=80, ge=0, le=100)

    @field_validator("message")
    @classmethod
    def _reject_fabrication(cls, value: str) -> str:
        return reject_fabricated_experience(value)


class GeneratedPostDraft(AISchema):
    title: str = Field(min_length=3, max_length=200)
    content: str = Field(min_length=20, max_length=3000)
    hook_type: str = Field(default="story", max_length=50)
    estimated_reading_time_seconds: int = Field(default=30, ge=5, le=300)


class PostGeneratorResult(AISchema):
    drafts: list[GeneratedPostDraft] = Field(min_length=1, max_length=5)


__all__ = [
    "BANNED_COMMENT_OPENERS",
    "CandidateEvaluationResult",
    "EngagementPlan",
    "GeneratedComment",
    "GeneratedConnectionMessage",
    "GeneratedPostDraft",
    "ParsedCampaign",
    "PostCriteria",
    "PostEvaluationResult",
    "PostGeneratorResult",
    "TargetPeople",
]
