from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.ai.schemas import ParsedCampaign
from app.enums import (
    ApprovalMode,
    CampaignStatus,
    CommentLength,
    CommentStyle,
    ConnectionMessageMode,
)
from app.schemas.common import ORMModel


class CriteriaPayload(BaseModel):
    """Editable campaign criteria. Every field has a safe default."""

    model_config = ConfigDict(from_attributes=True)

    # target people
    job_titles: list[str] = Field(default_factory=list)
    industries: list[str] = Field(default_factory=list)
    locations: list[str] = Field(default_factory=list)
    company_sizes: list[str] = Field(default_factory=list)
    people_keywords: list[str] = Field(default_factory=list)
    seniority_levels: list[str] = Field(default_factory=list)

    # post criteria
    include_topics: list[str] = Field(default_factory=list)
    exclude_topics: list[str] = Field(default_factory=list)
    include_keywords: list[str] = Field(default_factory=list)
    exclude_keywords: list[str] = Field(default_factory=list)
    post_types: list[str] = Field(default_factory=list)
    minimum_relevance_score: int = Field(default=75, ge=0, le=100)
    minimum_candidate_score: int = Field(default=70, ge=0, le=100)
    min_post_age_hours: int | None = Field(default=None, ge=0, le=8760)
    max_post_age_days: int | None = Field(default=30, ge=1, le=3650)

    # engagement
    initial_posts_to_like: int = Field(default=2, ge=0, le=10)
    evaluate_post_index: int = Field(default=3, ge=1, le=20)
    like_evaluated_post_if_relevant: bool = True
    generate_comment: bool = True
    #: Off means engage regardless of the post's score. The person already
    #: passed evaluation; their latest post simply may not be on topic.
    require_relevance_for_like: bool = True
    require_relevance_for_comment: bool = True

    # comment
    comment_approval: ApprovalMode = ApprovalMode.REQUIRED
    comment_length: CommentLength = CommentLength.SHORT
    comment_style: CommentStyle = CommentStyle.PROFESSIONAL

    # candidate
    candidate_approval: ApprovalMode = ApprovalMode.AUTOMATIC

    # connection
    connection_delay_hours: int = Field(default=48, ge=0, le=720)
    revalidate_before_connection: bool = True
    connection_message_mode: ConnectionMessageMode = ConnectionMessageMode.AI_GENERATED
    connection_message_template: str | None = Field(default=None, max_length=300)
    connection_approval: ApprovalMode = ApprovalMode.REQUIRED

    # rate limits
    max_people_per_day: int = Field(default=20, ge=1, le=500)
    daily_intake_limit: int = Field(default=20, ge=1, le=500)
    single_campaign_lock: bool = True
    max_likes_per_day: int = Field(default=60, ge=0, le=1000)
    max_comments_per_day: int = Field(default=15, ge=0, le=500)
    max_connections_per_day: int = Field(default=15, ge=0, le=500)
    max_people_per_run: int = Field(default=5, ge=1, le=100)
    min_action_delay_seconds: int = Field(default=30, ge=0, le=3600)
    max_action_delay_seconds: int = Field(default=180, ge=0, le=7200)


class CriteriaRead(CriteriaPayload, ORMModel):
    id: int


class ExclusionPayload(BaseModel):
    exclusion_type: str = Field(max_length=50)
    value: str = Field(max_length=500)
    reason: str | None = None


class ExclusionRead(ExclusionPayload, ORMModel):
    id: int


class CampaignCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    instruction: str = Field(min_length=10)
    description: str | None = None
    dry_run: bool = True
    audience_id: int | None = None
    criteria: CriteriaPayload | None = None
    exclusions: list[ExclusionPayload] = Field(default_factory=list)


class CampaignUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    instruction: str | None = Field(default=None, min_length=10)
    description: str | None = None
    dry_run: bool | None = None
    audience_id: int | None = None
    is_archived: bool | None = None
    criteria: CriteriaPayload | None = None
    exclusions: list[ExclusionPayload] | None = None


class EnrollProspectPayload(BaseModel):
    profile_url: str = Field(min_length=5, max_length=1000)
    full_name: str | None = None
    job_title: str | None = None
    company: str | None = None


class CampaignStats(BaseModel):
    candidates_discovered: int = 0
    candidates_matched: int = 0
    candidates_processed: int = 0
    posts_analyzed: int = 0
    posts_liked: int = 0
    comments_generated: int = 0
    comments_posted: int = 0
    connections_scheduled: int = 0
    connections_sent: int = 0
    failed_actions: int = 0
    pending_approvals: int = 0


class CampaignSummary(ORMModel):
    id: int
    name: str
    description: str | None
    status: CampaignStatus
    audience_id: int | None = None
    is_archived: bool = False
    dry_run: bool
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None
    completed_at: datetime | None



class CampaignRead(CampaignSummary):
    instruction: str
    last_error: str | None
    criteria: CriteriaRead | None
    exclusions: list[ExclusionRead] = Field(default_factory=list)


class CampaignDetail(CampaignRead):
    stats: CampaignStats


class AnalyzeRequest(BaseModel):
    instruction: str = Field(min_length=10)


class AnalyzeResponse(BaseModel):
    """Parser output, plus the criteria payload the review screen edits."""

    parsed: ParsedCampaign
    criteria: CriteriaPayload
    suggested_name: str
    summary: str
    provider: str
    model: str
    prompt_version: str


class CampaignActionResponse(BaseModel):
    campaign: CampaignSummary
    message: str
    task_id: str | None = None


class ProspectReplyEvent(BaseModel):
    person_id: int
    snippet: str | None = None

