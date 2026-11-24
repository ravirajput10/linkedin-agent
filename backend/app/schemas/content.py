from __future__ import annotations

from datetime import datetime
from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


# Content Pillars
class ContentPillarBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    target_cadence: str = Field(default="1 / week", max_length=50)
    description: str | None = None


class ContentPillarCreate(ContentPillarBase):
    pass


class ContentPillarUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    target_cadence: str | None = None
    description: str | None = None


class ContentPillarRead(ORMModel):
    id: int
    owner_id: int
    name: str
    target_cadence: str
    description: str | None
    created_at: datetime
    updated_at: datetime


# Post Draft Generation
class GenerateDraftsRequest(BaseModel):
    topic_prompt: str = Field(..., min_length=5, max_length=2000)
    post_format: str = Field(default="Text post")
    content_pillar: str = Field(default="Building with AI")
    post_length: str = Field(default="Medium · ~150 words")


class PostDraftItem(BaseModel):
    id: str
    title: str
    content: str
    word_count: int
    voice_match: int
    best_time: str
    scheduled_slot: str


class GenerateDraftsResponse(BaseModel):
    drafts: list[PostDraftItem]


# Draft Refinement
class ShortenDraftRequest(BaseModel):
    content: str = Field(..., min_length=10)


class RegenerateDraftRequest(BaseModel):
    topic_prompt: str
    post_format: str = "Text post"
    content_pillar: str = "Building with AI"
    previous_content: str | None = None


class SuggestIdeasRequest(BaseModel):
    pillar_name: str | None = None


class SuggestIdeasResponse(BaseModel):
    ideas: list[str]


# User Posts & Scheduling
class SchedulePostRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=300)
    content: str = Field(..., min_length=1)
    post_format: str = Field(default="Text post")
    pillar_id: int | None = None
    scheduled_for: datetime | None = None
    best_time: str | None = None
    voice_match_score: int = 90
    send_to_approvals: bool = True
    image_url: str | None = None


class UserPostRead(ORMModel):
    id: int
    owner_id: int
    pillar_id: int | None
    title: str
    content: str
    post_format: str
    status: str
    voice_match_score: int
    best_time: str | None
    scheduled_for: datetime | None
    published_at: datetime | None
    external_id: str | None
    metrics: dict | None
    image_url: str | None = None
    created_at: datetime
    updated_at: datetime


class CalendarItem(BaseModel):
    id: int | None = None
    day_name: str = ""
    date_str: str = ""
    title: str = ""
    content: str = ""
    post_format: str = "Text post"
    status: str = "EMPTY"
    scheduled_for: datetime | None = None
    published_at: datetime | None = None
    post: UserPostRead | None = None
