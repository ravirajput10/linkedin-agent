from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.enums import (
    ActionStatus,
    ActionType,
    ApprovalStatus,
    ApprovalType,
    ConnectionStatus,
    PostProcessingStatus,
    PostType,
    ScheduledTaskStatus,
    ScheduledTaskType,
    WorkflowState,
)
from app.schemas.common import ORMModel


class PersonSummary(ORMModel):
    id: int
    full_name: str
    headline: str | None
    job_title: str | None
    company: str | None
    industry: str | None
    location: str | None
    profile_url: str
    avatar_url: str | None
    connection_status: ConnectionStatus
    last_activity_at: datetime | None


class CandidateEvaluationRead(ORMModel):
    id: int
    is_match: bool
    score: int
    matched_criteria: list[str]
    reason: str
    risk_flags: list[str]
    agent_name: str
    prompt_version: str
    provider: str
    model: str
    created_at: datetime


class PostEvaluationRead(ORMModel):
    id: int
    eligible: bool
    relevance_score: int
    topics: list[str]
    reason: str
    risk_flags: list[str]
    agent_name: str
    prompt_version: str
    provider: str
    model: str
    created_at: datetime


class PostRead(ORMModel):
    id: int
    person_id: int
    campaign_id: int | None
    external_id: str
    post_url: str | None
    content: str
    post_type: PostType
    published_at: datetime | None
    like_count: int | None
    comment_count: int | None
    sequence_index: int | None
    is_eligible: bool
    ineligibility_reason: str | None
    processing_status: PostProcessingStatus
    created_at: datetime


class PostDetail(PostRead):
    evaluations: list[PostEvaluationRead] = Field(default_factory=list)


class WorkflowStepRead(ORMModel):
    id: int
    from_state: WorkflowState | None
    to_state: WorkflowState
    summary: str | None
    duration_ms: int | None
    created_at: datetime


class WorkflowRead(ORMModel):
    id: int
    campaign_id: int
    person_id: int
    state: WorkflowState
    previous_state: WorkflowState | None
    context: dict
    consecutive_failures: int
    last_error_code: str | None
    last_error_message: str | None
    started_at: datetime | None
    completed_at: datetime | None
    updated_at: datetime


class CandidateRead(BaseModel):
    person: PersonSummary
    campaign_id: int
    match_score: int | None
    matched_criteria: list[str]
    discovery_reason: str | None
    workflow: WorkflowRead | None
    next_action: str | None


class CandidateDetail(CandidateRead):
    evaluation: CandidateEvaluationRead | None
    posts: list[PostDetail] = Field(default_factory=list)
    timeline: list[WorkflowStepRead] = Field(default_factory=list)


class CommentRead(ORMModel):
    id: int
    campaign_id: int
    person_id: int
    post_id: int
    generated_text: str
    edited_text: str | None
    posted_text: str | None
    regeneration_count: int
    posted_at: datetime | None
    provider: str
    model: str
    prompt_version: str
    created_at: datetime


class ConnectionMessageRead(ORMModel):
    id: int
    campaign_id: int
    person_id: int
    generated_text: str | None
    edited_text: str | None
    sent_text: str | None
    regeneration_count: int
    sent_at: datetime | None
    created_at: datetime


class ActionRead(ORMModel):
    id: int
    campaign_id: int
    person_id: int | None
    post_id: int | None
    action_type: ActionType
    status: ActionStatus
    dry_run: bool
    attempt_count: int
    executed_at: datetime | None
    external_id: str | None
    error_code: str | None
    error_message: str | None
    created_at: datetime


class ApprovalRead(ORMModel):
    id: int
    campaign_id: int
    person_id: int
    workflow_id: int | None
    post_id: int | None
    comment_id: int | None
    connection_message_id: int | None
    approval_type: ApprovalType
    status: ApprovalStatus
    proposed_action: str
    ai_reasoning: str | None
    ai_score: int | None
    content: str | None
    context: dict | None
    decided_at: datetime | None
    decided_by: str | None
    created_at: datetime


class ApprovalDetail(ApprovalRead):
    person: PersonSummary
    campaign_name: str
    post: PostRead | None = None
    post_evaluation: PostEvaluationRead | None = None


class ApprovalDecision(BaseModel):
    note: str | None = Field(default=None, max_length=1000)
    edited_content: str | None = Field(default=None, max_length=2000)


class RegenerateRequest(BaseModel):
    feedback: str | None = Field(default=None, max_length=1000)


class BulkApproveRequest(BaseModel):
    approval_type: ApprovalType | None = None
    approval_ids: list[int] | None = None


class BulkApproveResponse(BaseModel):
    approved_count: int
    items: list[int] = Field(default_factory=list)


class ExpireStaleRequest(BaseModel):
    older_than_hours: int = Field(default=48, ge=1, le=720)


class ExpireStaleResponse(BaseModel):
    expired_count: int
    items: list[int] = Field(default_factory=list)


class ScheduledActionRead(ORMModel):
    id: int
    campaign_id: int
    person_id: int | None
    workflow_id: int | None
    task_type: ScheduledTaskType
    status: ScheduledTaskStatus
    scheduled_at: datetime
    executed_at: datetime | None
    attempt_count: int
    error_code: str | None
    error_message: str | None
    created_at: datetime


class ScheduledActionDetail(ScheduledActionRead):
    person: PersonSummary | None = None
    campaign_name: str


class RescheduleRequest(BaseModel):
    scheduled_at: datetime
