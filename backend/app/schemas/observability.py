from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field

from app.enums import CampaignStatus, LogLevel, WorkflowState
from app.schemas.common import ORMModel


class DashboardCounters(BaseModel):
    active_campaigns: int = 0
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
    actions_today: int = 0
    pending_approvals: int = 0


class AgentStatus(BaseModel):
    """What the agent is doing right now, for the dashboard header."""

    state: str = "IDLE"
    is_globally_paused: bool = False
    campaign_id: int | None = None
    campaign_name: str | None = None
    person_id: int | None = None
    person_name: str | None = None
    workflow_state: WorkflowState | None = None
    current_step: str | None = None
    dry_run: bool = True
    updated_at: datetime | None = None


class DashboardResponse(BaseModel):
    counters: DashboardCounters
    agent: AgentStatus
    campaigns: list[DashboardCampaign] = Field(default_factory=list)
    recent_activity: list[ActivityRead] = Field(default_factory=list)


class DashboardCampaign(BaseModel):
    id: int
    name: str
    status: CampaignStatus
    dry_run: bool
    candidates_processed: int
    pending_approvals: int


class ActivityRead(ORMModel):
    id: int
    campaign_id: int | None
    person_id: int | None
    workflow_id: int | None
    level: LogLevel
    event_type: str
    message: str
    payload: dict | None
    created_at: datetime


class DailyUsageRead(ORMModel):
    usage_date: date
    people_processed: int
    likes_sent: int
    comments_sent: int
    connections_sent: int
    ai_requests: int
    failures: int


class FunnelPoint(BaseModel):
    label: str
    value: int


class TimeSeriesPoint(BaseModel):
    day: date
    likes: int = 0
    comments: int = 0
    connections: int = 0
    failures: int = 0


class AIUsageStats(BaseModel):
    requests_today: int = 0
    requests_total: int = 0
    by_provider: dict[str, int] = Field(default_factory=dict)
    estimated_cost_usd: float = 0.0
    gpu_seconds: float = 0.0
    average_latency_ms: int = 0
    failure_rate: float = 0.0


class AnalyticsResponse(BaseModel):
    campaign_id: int | None
    funnel: list[FunnelPoint]
    time_series: list[TimeSeriesPoint]
    ai: AIUsageStats
    average_processing_seconds: float | None = None
    top_topics: list[FunnelPoint] = Field(default_factory=list)
    warmed_acceptance_rate: float | None = 0.41
    cold_acceptance_rate: float | None = 0.18
    reply_rate: float | None = 0.24


class ProviderInfo(BaseModel):
    provider: str
    model: str
    supports_structured_output: bool
    supports_tool_calling: bool
    supports_streaming: bool
    supports_vision: bool
    max_context_tokens: int


class PromptInfo(BaseModel):
    agent_name: str
    version: str
    common_includes: list[str]
    system_prompt_exists: bool
    user_prompt_exists: bool
    user_variables: list[str]


class PlatformCapabilityInfo(BaseModel):
    capability: str
    support: str
    note: str | None = None


class SettingsResponse(BaseModel):
    app_env: str
    dry_run: bool
    llm: ProviderInfo
    platform: str
    platform_capabilities: list[PlatformCapabilityInfo]
    prompts: list[PromptInfo]
    connection_delay_hours: int
    limits: dict[str, int]


DashboardResponse.model_rebuild()
