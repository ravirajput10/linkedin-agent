"""Safety, compliance, rate-limit ceilings, warm-up ramping, and invitation lifecycle management (FR-9)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database.models import Action, AgentLog, Campaign, User, UserPlatformAccount
from app.enums import ActionStatus, ActionType, LogLevel, PlatformAccountStatus
from app.errors import ConflictError, ValidationError
from app.logging import get_logger
from app.services import scoping

logger = get_logger(__name__)

# Hard system-wide safety ceilings (FR-9.2) - user cannot exceed these under any circumstances
HARD_MAX_LIKES_PER_DAY = 100
HARD_MAX_COMMENTS_PER_DAY = 40
HARD_MAX_CONNECTIONS_PER_DAY = 40
HARD_MAX_PEOPLE_PER_DAY = 80
HARD_MAX_CONNECTIONS_PER_WEEK = 100

HARD_LIMITS: dict[str, int] = {
    "max_likes_per_day": HARD_MAX_LIKES_PER_DAY,
    "max_comments_per_day": HARD_MAX_COMMENTS_PER_DAY,
    "max_connections_per_day": HARD_MAX_CONNECTIONS_PER_DAY,
    "max_people_per_day": HARD_MAX_PEOPLE_PER_DAY,
}


@dataclass(frozen=True, slots=True)
class SafetyLimitCheck:
    allowed: bool
    counter: str
    used: int
    limit: int
    reason: str | None = None

    @property
    def remaining(self) -> int:
        return max(0, self.limit - self.used)


def validate_safety_limits(limits: dict[str, Any]) -> None:
    """Validate requested limits against hard system safety ceilings (FR-9.2)."""
    for key, hard_ceiling in HARD_LIMITS.items():
        val = limits.get(key)
        if val is not None and val > hard_ceiling:
            label = key.replace("_", " ").title()
            raise ValidationError(
                f"{label} cannot exceed the safety maximum of {hard_ceiling} per day (FR-9.2)."
            )


def count_weekly_connections(
    session: Session,
    *,
    campaign_id: int | None = None,
    owner_id: int | None = None,
) -> int:
    """Count connection requests sent across the last 7 rolling days (FR-9.2)."""
    cutoff = datetime.now(UTC) - timedelta(days=7)
    stmt = (
        select(func.count())
        .select_from(Action)
        .where(
            Action.action_type == ActionType.SEND_CONNECTION,
            Action.status.in_([ActionStatus.SUCCESS, ActionStatus.RUNNING, ActionStatus.SKIPPED_DRY_RUN]),
            Action.created_at >= cutoff,
        )
    )
    if owner_id is not None:
        stmt = scoping.restrict(stmt, Action.campaign_id, owner_id)
    elif campaign_id is not None:
        stmt = stmt.where(Action.campaign_id == campaign_id)

    return int(session.scalar(stmt) or 0)


def check_weekly_connections_cap(
    session: Session,
    *,
    campaign_id: int | None = None,
    owner_id: int | None = None,
) -> SafetyLimitCheck:
    """Ensure rolling 7-day connection requests do not exceed 100 (FR-9.2)."""
    used = count_weekly_connections(session, campaign_id=campaign_id, owner_id=owner_id)
    limit = HARD_MAX_CONNECTIONS_PER_WEEK
    if used >= limit:
        return SafetyLimitCheck(
            allowed=False,
            counter="weekly_connections",
            used=used,
            limit=limit,
            reason=f"Weekly safety ceiling reached: {used}/{limit} connection requests sent in past 7 days (FR-9.2).",
        )
    return SafetyLimitCheck(allowed=True, counter="weekly_connections", used=used, limit=limit)


# ---------------------------------------------------------------------------
# Warm-up mode auto-scaling calculation (FR-9.4)
# ---------------------------------------------------------------------------


def get_warmup_multiplier(days_active: int) -> float:
    """Calculate ramp-up multiplier over a 21-day timeline (FR-9.4):
    - Week 1 (Days 0-7): 35% of configured daily caps
    - Week 2 (Days 8-14): 60% of configured daily caps
    - Week 3 (Days 15-21): 85% of configured daily caps
    - Day 22+: 100% (Warmup fully graduated)
    """
    if days_active <= 7:
        return 0.35
    elif days_active <= 14:
        return 0.60
    elif days_active <= 21:
        return 0.85
    return 1.0


def calculate_effective_limits(
    base_limits: dict[str, int],
    *,
    warmup_enabled: bool,
    days_active: int,
) -> dict[str, int]:
    """Apply the warm-up multiplier to base daily limits if warm-up mode is on."""
    if not warmup_enabled:
        return dict(base_limits)

    multiplier = get_warmup_multiplier(days_active)
    effective: dict[str, int] = {}
    for key, val in base_limits.items():
        # Keep at least 1 action possible if base limit is > 0
        effective[key] = max(1, int(val * multiplier)) if val > 0 else 0
    return effective


# ---------------------------------------------------------------------------
# Stale invitation auto-withdrawal (FR-9.6)
# ---------------------------------------------------------------------------


def withdraw_stale_invitations(
    session: Session,
    *,
    owner_id: int | None = None,
    max_age_days: int = 14,
) -> int:
    """Identify and withdraw pending connection requests older than max_age_days (FR-9.6)."""
    cutoff = datetime.now(UTC) - timedelta(days=max_age_days)
    stmt = select(Action).where(
        Action.action_type == ActionType.SEND_CONNECTION,
        Action.status.in_([ActionStatus.PENDING, ActionStatus.RUNNING]),
        Action.created_at <= cutoff,
    )
    if owner_id is not None:
        stmt = scoping.restrict(stmt, Action.campaign_id, owner_id)

    stale_actions = list(session.scalars(stmt))
    for act in stale_actions:
        act.status = ActionStatus.CANCELLED
        act.last_error = (
            f"Automatically withdrawn: pending invitation older than {max_age_days} days (FR-9.6)."
        )

    if stale_actions:
        session.flush()
        log = AgentLog(
            level=LogLevel.INFO,
            event_type="invitation_withdrawn",
            message=f"Auto-withdrew {len(stale_actions)} stale connection requests older than {max_age_days} days.",
        )
        session.add(log)
        session.flush()
        logger.info("Withdrew %d stale invitations older than %d days", len(stale_actions), max_age_days)

    return len(stale_actions)


# ---------------------------------------------------------------------------
# Automation Risk Acceptance (FR-9.11)
# ---------------------------------------------------------------------------


def record_risk_consent(session: Session, user: User, version: str = "1.0") -> None:
    """Record user consent to platform automation terms."""
    now = datetime.now(UTC)
    user.accepted_risk_terms_at = now  # type: ignore[attr-defined]
    user.risk_terms_version = version  # type: ignore[attr-defined]
    session.flush()
