"""Daily rate limits, enforced against a locked ``daily_usage`` row."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.database.models import Campaign, DailyUsage
from app.enums import ActionType
from app.logging import get_logger

logger = get_logger(__name__)

#: Which counter and which campaign limit each action type consumes.
ACTION_LIMITS: dict[ActionType, tuple[str, str]] = {
    ActionType.LIKE_POST: ("likes_sent", "max_likes_per_day"),
    ActionType.COMMENT_POST: ("comments_sent", "max_comments_per_day"),
    ActionType.SEND_CONNECTION: ("connections_sent", "max_connections_per_day"),
}

PEOPLE_LIMIT = ("people_processed", "max_people_per_day")


@dataclass(frozen=True, slots=True)
class LimitCheck:
    allowed: bool
    counter: str
    used: int
    limit: int
    reason: str | None = None

    @property
    def remaining(self) -> int:
        return max(0, self.limit - self.used)


def today() -> date:
    return datetime.now(UTC).date()


def get_or_create_usage(session: Session, campaign_id: int, day: date | None = None) -> DailyUsage:
    """Fetch today's counters, creating the row atomically if it is missing."""
    day = day or today()
    stmt = (
        pg_insert(DailyUsage)
        .values(campaign_id=campaign_id, usage_date=day)
        .on_conflict_do_nothing(index_elements=["campaign_id", "usage_date"])
    )
    session.execute(stmt)
    usage = session.scalar(
        select(DailyUsage)
        .where(DailyUsage.campaign_id == campaign_id, DailyUsage.usage_date == day)
        .with_for_update()
    )
    assert usage is not None  # the insert above guarantees the row exists
    return usage


def _check(usage: DailyUsage, campaign: Campaign, counter: str, limit_attr: str) -> LimitCheck:
    limit = int(getattr(campaign.criteria, limit_attr))
    used = int(getattr(usage, counter))
    if used >= limit:
        return LimitCheck(
            allowed=False,
            counter=counter,
            used=used,
            limit=limit,
            reason=f"Daily limit reached: {used}/{limit} {counter.replace('_', ' ')}.",
        )
    return LimitCheck(allowed=True, counter=counter, used=used, limit=limit)


def check_action(session: Session, campaign: Campaign, action_type: ActionType) -> LimitCheck:
    if action_type == ActionType.SEND_CONNECTION:
        from app.services.safety_service import check_weekly_connections_cap
        weekly_check = check_weekly_connections_cap(session, campaign_id=campaign.id, owner_id=campaign.owner_id)
        if not weekly_check.allowed:
            return LimitCheck(
                allowed=False,
                counter="weekly_connections",
                used=weekly_check.used,
                limit=weekly_check.limit,
                reason=weekly_check.reason,
            )

    counter, limit_attr = ACTION_LIMITS[action_type]
    usage = get_or_create_usage(session, campaign.id)
    return _check(usage, campaign, counter, limit_attr)


def check_person(session: Session, campaign: Campaign) -> LimitCheck:
    counter, limit_attr = PEOPLE_LIMIT
    usage = get_or_create_usage(session, campaign.id)
    return _check(usage, campaign, counter, limit_attr)


def consume(session: Session, campaign_id: int, counter: str, amount: int = 1) -> DailyUsage:
    usage = get_or_create_usage(session, campaign_id)
    setattr(usage, counter, int(getattr(usage, counter)) + amount)
    session.flush()
    return usage


def consume_action(session: Session, campaign_id: int, action_type: ActionType) -> DailyUsage:
    counter, _ = ACTION_LIMITS[action_type]
    return consume(session, campaign_id, counter)


def consume_person(session: Session, campaign_id: int) -> DailyUsage:
    return consume(session, campaign_id, PEOPLE_LIMIT[0])


def record_failure(session: Session, campaign_id: int) -> DailyUsage:
    return consume(session, campaign_id, "failures")


def record_ai_request(session: Session, campaign_id: int) -> DailyUsage:
    return consume(session, campaign_id, "ai_requests")
