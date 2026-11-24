from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.database.models.subscription import PaymentProvider, SubscriptionStatus
from app.schemas.plan import PlanRead


class BillingConfigResponse(BaseModel):
    default_provider: str
    stripe_publishable_key: str
    stripe_currency: str
    razorpay_key_id: str | None = None


class CreateCheckoutRequest(BaseModel):
    plan_id: str = Field(default="starter")
    billing_cycle: str = Field(default="monthly")  # 'monthly' | 'annual'
    provider: PaymentProvider | None = None
    currency: str | None = None
    success_url: str | None = None
    cancel_url: str | None = None


class CheckoutSessionResponse(BaseModel):
    provider: PaymentProvider
    checkout_url: str | None = None
    session_id: str | None = None
    order_id: str | None = None
    client_payload: dict[str, Any] = Field(default_factory=dict)


class CreatePortalRequest(BaseModel):
    return_url: str | None = None


class ConfirmSessionRequest(BaseModel):
    session_id: str


class PortalSessionResponse(BaseModel):
    portal_url: str


class SubscriptionResponse(BaseModel):
    has_subscription: bool
    provider: PaymentProvider | None = None
    provider_customer_id: str | None = None
    provider_subscription_id: str | None = None
    plan_id: str = "starter"
    plan: PlanRead | None = None
    billing_cycle: str = "monthly"
    status: SubscriptionStatus = SubscriptionStatus.TRIALING
    is_active: bool = True
    trial_start_at: datetime | None = None
    trial_ends_at: datetime | None = None
    trial_days_remaining: int = 0
    current_period_start: datetime | None = None
    current_period_end: datetime | None = None
    cancel_at_period_end: bool = False
    campaigns_limit: int = 5
    daily_actions_limit: int = 50
    monthly_prospects_limit: int = 1000

