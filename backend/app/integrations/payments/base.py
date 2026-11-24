from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.database.models.subscription import PaymentProvider, SubscriptionStatus


class CheckoutResult(BaseModel):
    provider: PaymentProvider
    checkout_url: str | None = None
    session_id: str | None = None
    order_id: str | None = None
    client_payload: dict[str, Any] = Field(default_factory=dict)


class PortalResult(BaseModel):
    provider: PaymentProvider
    portal_url: str


class NormalizedPaymentEvent(BaseModel):
    provider: PaymentProvider
    event_id: str
    event_type: str
    customer_id: str
    subscription_id: str | None = None
    price_id: str | None = None
    plan_id: str | None = None
    status: SubscriptionStatus
    trial_start_at: datetime | None = None
    trial_ends_at: datetime | None = None
    current_period_start: datetime | None = None
    current_period_end: datetime | None = None
    cancel_at_period_end: bool = False
    raw_payload: dict[str, Any] = Field(default_factory=dict)


class BasePaymentProvider(ABC):
    """Abstract interface defining the contract for all payment providers."""

    @abstractmethod
    async def create_checkout_session(
        self,
        user: Any,
        plan: Any,
        billing_cycle: str,
        success_url: str,
        cancel_url: str,
        trial_days: int = 14,
    ) -> CheckoutResult:
        """Create a hosted checkout session or gateway order."""
        pass

    @abstractmethod
    async def create_portal_session(self, customer_id: str, return_url: str) -> PortalResult:
        """Create an authenticated customer billing management portal session."""
        pass

    @abstractmethod
    async def verify_and_parse_webhook(
        self, raw_body: bytes, headers: dict[str, str]
    ) -> NormalizedPaymentEvent:
        """Verify HMAC signature with raw bytes and parse into normalized event."""
        pass

    @abstractmethod
    async def cancel_subscription(self, subscription_id: str) -> bool:
        """Cancel or mark a subscription for period-end cancellation."""
        pass

