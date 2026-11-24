from __future__ import annotations

import enum
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.database import Base
from app.database.types import TimestampMixin, enum_column

if TYPE_CHECKING:
    from app.database.models.plan import Plan
    from app.database.models.user import User


class PaymentProvider(str, enum.Enum):
    STRIPE = "stripe"
    RAZORPAY = "razorpay"


class SubscriptionStatus(str, enum.Enum):
    TRIALING = "trialing"
    ACTIVE = "active"
    PAST_DUE = "past_due"
    CANCELED = "canceled"
    INCOMPLETE = "incomplete"
    UNPAID = "unpaid"


class Subscription(TimestampMixin, Base):
    """Multi-tenant subscription record backing SaaS access and plan quotas."""

    __tablename__ = "subscriptions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False, index=True
    )

    # Provider-agnostic gateway identifiers
    provider: Mapped[PaymentProvider] = mapped_column(
        enum_column(PaymentProvider), default=PaymentProvider.STRIPE, nullable=False, index=True
    )
    provider_customer_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    provider_subscription_id: Mapped[str | None] = mapped_column(
        String(100), nullable=True, index=True
    )
    provider_price_id: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Plan link & billing cycle
    plan_id: Mapped[str] = mapped_column(
        ForeignKey("plans.id", ondelete="RESTRICT"), default="starter", nullable=False, index=True
    )
    billing_cycle: Mapped[str] = mapped_column(
        String(20), default="monthly", nullable=False
    )  # 'monthly' | 'annual'
    status: Mapped[SubscriptionStatus] = mapped_column(
        enum_column(SubscriptionStatus),
        default=SubscriptionStatus.TRIALING,
        nullable=False,
        index=True,
    )

    # Timeline & trial tracking
    trial_start_at: Mapped[datetime | None] = mapped_column()
    trial_ends_at: Mapped[datetime | None] = mapped_column(index=True)
    current_period_start: Mapped[datetime | None] = mapped_column()
    current_period_end: Mapped[datetime | None] = mapped_column(index=True)
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    canceled_at: Mapped[datetime | None] = mapped_column()

    user: Mapped[User] = relationship(back_populates="subscription")
    plan: Mapped[Plan] = relationship()


class PaymentEventLog(TimestampMixin, Base):
    """Guarantees strict at-most-once processing across all payment gateways."""

    __tablename__ = "payment_event_logs"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)  # Provider event ID
    provider: Mapped[PaymentProvider] = mapped_column(
        enum_column(PaymentProvider), nullable=False, index=True
    )
    event_type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    processed_at: Mapped[datetime] = mapped_column(default=datetime.utcnow, nullable=False)
    payload_summary: Mapped[str | None] = mapped_column(Text)

