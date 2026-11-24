from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.database import Base
from app.database.types import TimestampMixin

if TYPE_CHECKING:
    from app.database.models.user import User


class Plan(TimestampMixin, Base):
    __tablename__ = "plans"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    badge: Mapped[str | None] = mapped_column(String(50), nullable=True)
    monthly_price: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    annual_price: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(10), default="USD", nullable=False)
    trial_days: Mapped[int] = mapped_column(Integer, default=14, nullable=False)
    is_recommended: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False, index=True)
    button_label: Mapped[str] = mapped_column(
        String(100), default="Start Free Trial", nullable=False
    )

    # Operational quotas & feature flags
    max_campaigns: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    monthly_ai_prospects: Mapped[int] = mapped_column(Integer, default=1000, nullable=False)
    daily_action_limit: Mapped[int] = mapped_column(Integer, default=50, nullable=False)
    has_smart_pacing: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    has_2fa_proxy: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    has_custom_ai_prompts: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Multi-gateway price mapping
    stripe_monthly_price_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    stripe_annual_price_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    stripe_product_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    razorpay_plan_id: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Bullet point features list stored as JSON array
    features: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)

    users: Mapped[list[User]] = relationship(back_populates="plan")
