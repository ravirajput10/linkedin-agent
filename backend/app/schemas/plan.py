from __future__ import annotations

from pydantic import BaseModel, Field

from app.schemas.common import TimestampedModel


class PlanRead(TimestampedModel):
    id: str
    name: str
    description: str
    badge: str | None = None
    monthly_price: float
    annual_price: float
    currency: str = "USD"
    trial_days: int = 14
    is_recommended: bool = False
    is_active: bool = True
    sort_order: int = 0
    button_label: str = "Start Free Trial"
    max_campaigns: int = 5
    monthly_ai_prospects: int = 1000
    daily_action_limit: int = 50
    has_smart_pacing: bool = True
    has_2fa_proxy: bool = True
    has_custom_ai_prompts: bool = False
    features: list[str] = Field(default_factory=list)


class PlanAdminRead(PlanRead):
    subscriber_count: int = 0


class PlanCreate(BaseModel):
    id: str = Field(min_length=2, max_length=64, pattern=r"^[a-z0-9_-]+$")
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(min_length=1)
    badge: str | None = Field(default=None, max_length=50)
    monthly_price: float = Field(ge=0)
    annual_price: float = Field(ge=0)
    currency: str = Field(default="USD", max_length=10)
    trial_days: int = Field(default=14, ge=0)
    is_recommended: bool = False
    is_active: bool = True
    sort_order: int = 0
    button_label: str = Field(default="Start Free Trial", max_length=100)
    max_campaigns: int = 5
    monthly_ai_prospects: int = 1000
    daily_action_limit: int = 50
    has_smart_pacing: bool = True
    has_2fa_proxy: bool = True
    has_custom_ai_prompts: bool = False
    features: list[str] = Field(default_factory=list)


class PlanUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    description: str | None = None
    badge: str | None = None
    monthly_price: float | None = Field(default=None, ge=0)
    annual_price: float | None = Field(default=None, ge=0)
    currency: str | None = None
    trial_days: int | None = Field(default=None, ge=0)
    is_recommended: bool | None = None
    is_active: bool | None = None
    sort_order: int | None = None
    button_label: str | None = None
    max_campaigns: int | None = None
    monthly_ai_prospects: int | None = None
    daily_action_limit: int | None = None
    has_smart_pacing: bool | None = None
    has_2fa_proxy: bool | None = None
    has_custom_ai_prompts: bool | None = None
    features: list[str] | None = None


class UserPlanUpdate(BaseModel):
    plan_id: str = Field(max_length=64)
    billing_cycle: str | None = Field(default="monthly", max_length=20)


class PlanReorderPayload(BaseModel):
    plan_ids: list[str] = Field(min_length=1)

