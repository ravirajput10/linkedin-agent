from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class FilterChip(BaseModel):
    key: str
    value: str


class PromptParseRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=2000)


class PromptParseResponse(BaseModel):
    prompt: str
    suggested_name: str
    summary: str
    filters: dict[str, Any]
    filter_chips: list[FilterChip]


class AudienceSearchRequest(BaseModel):
    prompt: str | None = None
    filters: dict[str, Any] | None = None
    audience_id: int | None = None
    exclude_connections: bool = True
    exclude_active_campaigns: bool = True
    limit: int = Field(default=25, ge=1, le=100)


class AudienceCandidate(BaseModel):
    id: str
    person_id: int | None = None
    name: str
    title: str | None = None
    company: str | None = None
    location: str | None = None
    profile_url: str | None = None
    avatar_url: str | None = None
    fit_score: int = Field(default=80, ge=0, le=100)
    why_match: str = "Discovered by criteria"
    last_post: str | None = None
    connection_status: str = "UNKNOWN"
    matched_criteria: list[str] = Field(default_factory=list)
    initials: str = "P"
    avatar_color: str = "bg-blue-600"


class AudienceSearchResponse(BaseModel):
    candidates: list[AudienceCandidate]
    total: int
    rate_limit_remaining: int | None = None


class AudienceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    original_prompt: str = ""
    filters_json: dict[str, Any] = Field(default_factory=dict)
    refresh_schedule: str = "daily"
    member_person_ids: list[int] | None = None


class AudienceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    original_prompt: str | None = None
    filters_json: dict[str, Any] | None = None
    refresh_schedule: str | None = None
    is_archived: bool | None = None
    member_person_ids: list[int] | None = None



class AudienceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    original_prompt: str
    filters_json: dict[str, Any]
    refresh_schedule: str
    last_refreshed_at: datetime | None = None
    is_archived: bool = False
    people_count: int = 0
    created_at: datetime
    updated_at: datetime


class AudienceDetail(AudienceRead):
    members: list[AudienceCandidate] = Field(default_factory=list)


class AudienceAssignCampaignRequest(BaseModel):
    campaign_id: int
    person_ids: list[int]


class AudienceExcludeRequest(BaseModel):
    person_ids: list[int] = Field(default_factory=list)
    reason: str | None = None


class CSVImportResponse(BaseModel):
    imported_count: int
    skipped_count: int
    prospects: list[AudienceCandidate] = Field(default_factory=list)
