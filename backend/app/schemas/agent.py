"""Schemas for Chrome Extension agent communication (FR-1.4, FR-1.5, FR-1.7, FR-1.8, FR-8)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, model_validator


class AgentHeartbeatRequest(BaseModel):
    extension_version: str = Field(default="1.0.0", max_length=32)
    extension_id: str | None = None
    linkedin_member_id: str | None = None
    current_url: str | None = None

    @model_validator(mode="before")
    @classmethod
    def populate_aliases(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if "member_id" in data and "linkedin_member_id" not in data:
                data["linkedin_member_id"] = data["member_id"]
            if "version" in data and "extension_version" not in data:
                data["extension_version"] = data["version"]
        return data


class AgentHeartbeatResponse(BaseModel):
    acknowledged: bool = True
    extension_online: bool = True
    server_time: datetime
    connection_status: str


class AgentPairSessionRequest(BaseModel):
    member_id: str = Field(min_length=1, max_length=128)
    member_name: str | None = Field(default=None, max_length=200)
    full_name: str | None = Field(default=None, max_length=200)
    profile_url: str | None = None
    account_tier: str = Field(default="FREE", max_length=32)

    @model_validator(mode="before")
    @classmethod
    def populate_name(cls, data: Any) -> Any:
        if isinstance(data, dict):
            name = data.get("member_name") or data.get("full_name") or "LinkedIn Member"
            data["member_name"] = name
            data["full_name"] = name
        return data


class AgentPairSessionResponse(BaseModel):
    success: bool
    connection_status: str
    member_matched: bool
    account_tier: str
    message: str
    access_token: str | None = None
    member_name: str | None = None
    email: str | None = None


class AgentStatusResponse(BaseModel):
    connected: bool = False
    connection_status: str  # CONNECTED, EXTENSION_OFFLINE, SESSION_EXPIRED, WARNING, NOT_CONNECTED
    extension_online: bool
    extension_last_seen: datetime | None = None
    extension_version: str | None = None
    account_tier: str = "FREE"
    member_name: str | None = None
    member_id: str | None = None
    campaigns_blocked: bool = False
    block_reason: str | None = None


class AgentQueueItem(BaseModel):
    task_id: int
    campaign_id: int
    task_type: str
    status: str
    scheduled_at: datetime
    target_name: str | None = None
    target_url: str | None = None
    target_headline: str | None = None
    message: str | None = None
    payload: dict[str, Any] | None = None


class AgentQueueResponse(BaseModel):
    items: list[AgentQueueItem]
    total: int
    within_working_hours: bool = True


class AgentQueueReportRequest(BaseModel):
    success: bool
    error_code: str | None = None
    error_message: str | None = None
    result_data: dict[str, Any] | None = None


class AgentProfileEvaluationRequest(BaseModel):
    profile_url: str
    name: str | None = None
    headline: str | None = None
    location: str | None = None
    audience_id: int | None = None


class AgentProfileEvaluationResponse(BaseModel):
    fit_score: int
    match_rationale: str
    match_criteria: list[str]
    audience_name: str | None = None
    already_in_campaign: bool = False
