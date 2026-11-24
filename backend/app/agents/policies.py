"""Deterministic decision rules.

Every "should we?" question in the system is answered here, from persisted
state and campaign configuration. The AI supplies scores and text; it never
decides whether an action happens.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from app.database.models import (
    Campaign,
    CampaignCriteria,
    CandidateEvaluation,
    Person,
    PostEvaluation,
    Workflow,
)
from app.enums import (
    ApprovalMode,
    ApprovalType,
    CampaignStatus,
    ConnectionMessageMode,
    ConnectionStatus,
)


@dataclass(frozen=True, slots=True)
class Decision:
    allowed: bool
    reason: str

    def __bool__(self) -> bool:
        return self.allowed


ALLOW = Decision(True, "")


# ------------------------------------------------------------------ scores --


def candidate_accepted(evaluation: CandidateEvaluation, criteria: CampaignCriteria) -> Decision:
    """Threshold check on the AI's candidate score. This is the gate, not the AI."""
    threshold = criteria.minimum_candidate_score
    if not evaluation.is_match:
        return Decision(False, f"AI judged no match ({evaluation.score}/100): {evaluation.reason}")
    if evaluation.score < threshold:
        return Decision(
            False, f"Score {evaluation.score} is below the campaign threshold of {threshold}."
        )
    return Decision(True, f"Score {evaluation.score} meets the threshold of {threshold}.")


def post_accepted(evaluation: PostEvaluation, criteria: CampaignCriteria) -> Decision:
    threshold = criteria.minimum_relevance_score
    if not evaluation.eligible:
        return Decision(
            False, f"AI judged ineligible ({evaluation.relevance_score}/100): {evaluation.reason}"
        )
    if evaluation.relevance_score < threshold:
        return Decision(
            False,
            f"Relevance {evaluation.relevance_score} is below the campaign threshold of {threshold}.",
        )
    return Decision(
        True, f"Relevance {evaluation.relevance_score} meets the threshold of {threshold}."
    )


# ----------------------------------------------------------------- actions --


def should_like_evaluated_post(criteria: CampaignCriteria) -> bool:
    return criteria.like_evaluated_post_if_relevant


def engage_despite_low_relevance(criteria: CampaignCriteria, action: str) -> bool:
    """Whether an off-topic post should still be acted on.

    The candidate has already passed evaluation. Their most recent post may be
    about anything; requiring every post to match the campaign's topics means
    engaging with almost no one.
    """
    if action == "like":
        return not criteria.require_relevance_for_like
    if action == "comment":
        return not criteria.require_relevance_for_comment
    return False


def should_generate_comment(criteria: CampaignCriteria) -> bool:
    return criteria.generate_comment


def approval_required(criteria: CampaignCriteria, approval_type: ApprovalType) -> bool:
    mode = {
        ApprovalType.CANDIDATE: criteria.candidate_approval,
        ApprovalType.COMMENT: criteria.comment_approval,
        ApprovalType.CONNECTION: criteria.connection_approval,
    }[approval_type]
    return mode is ApprovalMode.REQUIRED


def should_generate_connection_message(criteria: CampaignCriteria) -> bool:
    return criteria.connection_message_mode is ConnectionMessageMode.AI_GENERATED


# --------------------------------------------------------------- campaigns --


def campaign_can_act(campaign: Campaign) -> Decision:
    if campaign.status is CampaignStatus.RUNNING:
        return ALLOW
    return Decision(False, f"Campaign is {campaign.status.value}, not RUNNING.")


def person_excluded(campaign: Campaign, person: Person) -> Decision:
    """Match the campaign's exclusion list against the person's identifying fields."""
    haystack = {
        "person": (person.full_name or "").lower(),
        "company": (person.company or "").lower(),
        "profile_url": (person.profile_url or "").lower(),
        "keyword": " ".join(
            filter(None, [person.headline, person.job_title, person.about])
        ).lower(),
    }

    for exclusion in campaign.exclusions:
        field = haystack.get(exclusion.exclusion_type.lower())
        if field is None:
            field = " ".join(haystack.values())
        if exclusion.value and exclusion.value.lower() in field:
            return Decision(
                True,
                f"Excluded by campaign rule {exclusion.exclusion_type}={exclusion.value!r}"
                + (f" ({exclusion.reason})" if exclusion.reason else ""),
            )
    return Decision(False, "")


# -------------------------------------------------------------- connection --


def connection_due(workflow: Workflow, scheduled_at: datetime) -> bool:
    now = datetime.now(UTC)
    due = scheduled_at if scheduled_at.tzinfo else scheduled_at.replace(tzinfo=UTC)
    return now >= due


@dataclass(frozen=True, slots=True)
class RevalidationOutcome:
    eligible: bool
    checks: dict[str, str]
    reason: str


def revalidate_connection(
    *,
    campaign: Campaign,
    person: Person,
    connection_status: ConnectionStatus,
    has_recent_activity: bool,
    daily_limit_available: bool,
) -> RevalidationOutcome:
    """The gate the 48-hour job must pass before a connection is sent.

    An UNKNOWN connection status does not block: some platforms expose no way to
    read it, and the adapter reports the truth rather than guessing.
    """
    checks: dict[str, str] = {}
    failures: list[str] = []

    campaign_check = campaign_can_act(campaign)
    checks["campaign_active"] = "YES" if campaign_check else "NO"
    if not campaign_check:
        failures.append(campaign_check.reason)

    checks["already_connected"] = (
        "YES" if connection_status is ConnectionStatus.CONNECTED else "NO"
    )
    if connection_status is ConnectionStatus.CONNECTED:
        failures.append("Already connected.")

    checks["request_pending"] = "YES" if connection_status is ConnectionStatus.PENDING else "NO"
    if connection_status is ConnectionStatus.PENDING:
        failures.append("A connection request is already pending.")

    exclusion = person_excluded(campaign, person)
    checks["excluded"] = "YES" if exclusion.allowed else "NO"
    if exclusion.allowed:
        failures.append(exclusion.reason)

    checks["recent_relevant_activity"] = "YES" if has_recent_activity else "NO"
    if not has_recent_activity:
        failures.append("No recent activity found on the profile.")

    checks["daily_limit"] = "AVAILABLE" if daily_limit_available else "REACHED"
    if not daily_limit_available:
        failures.append("Daily connection limit reached.")

    return RevalidationOutcome(
        eligible=not failures,
        checks=checks,
        reason="; ".join(failures) if failures else "All revalidation checks passed.",
    )


def has_recent_activity(person: Person, *, within_days: int = 30) -> bool:
    if person.last_activity_at is None:
        return False
    last = person.last_activity_at
    if last.tzinfo is None:
        last = last.replace(tzinfo=UTC)
    return datetime.now(UTC) - last <= timedelta(days=within_days)


# ------------------------------------------------------------------ errors --


def should_pause_workflow(workflow: Workflow, threshold: int) -> bool:
    """Stop retrying and ask for a human once failures pile up."""
    return workflow.consecutive_failures >= threshold


def retry_delay_seconds(attempt: int, *, base: int = 30, cap: int = 3600) -> int:
    """Exponential backoff, capped so a stuck job never sleeps for a day."""
    return min(cap, base * (2 ** max(0, attempt - 1)))
