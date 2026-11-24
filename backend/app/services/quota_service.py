from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database.models.campaign import Campaign
from app.database.models.plan import Plan
from app.database.models.subscription import Subscription, SubscriptionStatus
from app.database.models.user import User


class QuotaService:
    """Enforces tier limits, operational quotas, and delinquent payment gates."""

    @staticmethod
    def get_user_plan(session: Session, user: User) -> Plan | None:
        sub = session.scalar(select(Subscription).where(Subscription.user_id == user.id))
        plan_id = sub.plan_id if sub else (user.plan_id or "starter")
        return session.get(Plan, plan_id)

    @staticmethod
    def can_create_campaign(session: Session, user: User) -> tuple[bool, str | None]:
        """Check if user has reached their plan's maximum active campaign count."""
        plan = QuotaService.get_user_plan(session, user)
        max_campaigns = plan.max_campaigns if plan else 5

        # Unlimited plans use high integer (e.g. >= 999 or 0)
        if max_campaigns <= 0 or max_campaigns >= 999:
            return True, None

        active_count = session.scalar(
            select(func.count(Campaign.id)).where(
                Campaign.owner_id == user.id,
                Campaign.is_archived.is_(False),
            )
        ) or 0

        if active_count >= max_campaigns:
            return (
                False,
                f"You have reached your limit of {max_campaigns} campaigns on the {plan.name if plan else 'current'} plan. Please upgrade to create more campaigns.",
            )

        return True, None

    @staticmethod
    def can_run_automated_actions(session: Session, user: User) -> tuple[bool, str | None]:
        """Verify whether automated background queue execution is permitted."""
        sub = session.scalar(select(Subscription).where(Subscription.user_id == user.id))
        if sub and sub.status in (
            SubscriptionStatus.PAST_DUE,
            SubscriptionStatus.CANCELED,
            SubscriptionStatus.UNPAID,
        ):
            return (
                False,
                f"Automation is paused because your subscription status is {sub.status.value.upper()}. Please update your billing details to resume.",
            )

        return True, None

