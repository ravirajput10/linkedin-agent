"""Aggregates for the dashboard and analytics pages.

Only quantities the system actually records are reported. Nothing is inferred
about what happened on the platform after an action left the application.
"""

from __future__ import annotations

from collections import Counter
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import Float, cast, func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.database.models import (
    Action,
    AgentLog,
    AIExecution,
    Approval,
    Campaign,
    UserPost,
    CandidateEvaluation,
    Comment,
    DailyUsage,
    Person,
    PersonCampaign,
    PostEvaluation,
    ScheduledTask,
    UserSettings,
    Workflow,
)
from app.enums import (
    TERMINAL_STATES,
    ActionStatus,
    ActionType,
    ApprovalStatus,
    CampaignStatus,
    WorkflowState,
)
from app.schemas.observability import (
    AgentStatus,
    AIUsageStats,
    AnalyticsResponse,
    DashboardCampaign,
    DashboardCounters,
    DashboardResponse,
    FunnelPoint,
    TimeSeriesPoint,
)
from app.services import scoping

SUCCESS_STATUSES = [ActionStatus.SUCCESS, ActionStatus.SKIPPED_DRY_RUN]

#: Human-readable label for each workflow state, shown as "Current Step".
STEP_LABELS: dict[WorkflowState, str] = {
    WorkflowState.DISCOVERING: "Discovering candidates",
    WorkflowState.CANDIDATE_FOUND: "Candidate found",
    WorkflowState.EVALUATING_CANDIDATE: "Evaluating candidate",
    WorkflowState.CANDIDATE_ACCEPTED: "Candidate accepted",
    WorkflowState.CANDIDATE_REJECTED: "Candidate rejected",
    WorkflowState.FINDING_POSTS: "Finding eligible posts",
    WorkflowState.POST_1_FOUND: "Opening post #1",
    WorkflowState.POST_1_LIKED: "Liked post #1",
    WorkflowState.POST_2_FOUND: "Opening post #2",
    WorkflowState.POST_2_LIKED: "Liked post #2",
    WorkflowState.POST_3_FOUND: "Opening post #3",
    WorkflowState.POST_3_EVALUATING: "Analyzing post #3",
    WorkflowState.POST_3_ACCEPTED: "Post #3 accepted",
    WorkflowState.POST_3_REJECTED: "Post #3 rejected",
    WorkflowState.POST_3_LIKED: "Liked post #3",
    WorkflowState.COMMENT_GENERATED: "Comment drafted",
    WorkflowState.COMMENT_PENDING_APPROVAL: "Waiting for comment approval",
    WorkflowState.COMMENT_POSTED: "Comment posted",
    WorkflowState.COMMENT_REJECTED: "Comment rejected",
    WorkflowState.CONNECTION_SCHEDULED: "Connection scheduled",
    WorkflowState.WAITING_FOR_CONNECTION: "Waiting for the connection delay",
    WorkflowState.REVALIDATING: "Revalidating candidate",
    WorkflowState.CONNECTION_PENDING_APPROVAL: "Waiting for connection approval",
    WorkflowState.CONNECTION_READY: "Connection ready to send",
    WorkflowState.CONNECTION_SENT: "Connection request sent",
    WorkflowState.COMPLETED: "Completed",
    WorkflowState.SKIPPED: "Skipped",
    WorkflowState.CANCELLED: "Cancelled",
    WorkflowState.FAILED: "Failed",
}


def _count(session: Session, stmt) -> int:
    return session.scalar(stmt) or 0


def _today() -> date:
    return datetime.now(UTC).date()


# --------------------------------------------------------------- dashboard --


def counters(
    session: Session, *, campaign_id: int | None = None, owner_id: int | None = None
) -> DashboardCounters:
    def scoped(model, stmt):
        stmt = scoping.restrict(stmt, model.campaign_id, owner_id)
        return stmt.where(model.campaign_id == campaign_id) if campaign_id else stmt

    campaigns_stmt = (
        select(func.count())
        .select_from(Campaign)
        .where(Campaign.status == CampaignStatus.RUNNING)
    )
    if owner_id is not None:
        campaigns_stmt = campaigns_stmt.where(Campaign.owner_id == owner_id)
    active = _count(session, campaigns_stmt)

    actions_today = _count(
        session,
        scoped(
            Action,
            select(func.count())
            .select_from(Action)
            .where(
                Action.status.in_(SUCCESS_STATUSES),
                func.date(Action.executed_at) == _today(),
            ),
        ),
    )

    return DashboardCounters(
        active_campaigns=active,
        candidates_discovered=_count(
            session,
            scoped(PersonCampaign, select(func.count()).select_from(PersonCampaign)),
        ),
        candidates_matched=_count(
            session,
            scoped(
                CandidateEvaluation,
                select(func.count())
                .select_from(CandidateEvaluation)
                .where(CandidateEvaluation.is_match.is_(True)),
            ),
        ),
        candidates_processed=_count(
            session,
            scoped(
                Workflow,
                select(func.count())
                .select_from(Workflow)
                .where(Workflow.state.in_(list(TERMINAL_STATES))),
            ),
        ),
        posts_analyzed=_count(
            session, scoped(PostEvaluation, select(func.count()).select_from(PostEvaluation))
        ),
        posts_liked=_count(
            session,
            scoped(
                Action,
                select(func.count())
                .select_from(Action)
                .where(
                    Action.action_type == ActionType.LIKE_POST,
                    Action.status.in_(SUCCESS_STATUSES),
                ),
            ),
        ),
        comments_generated=_count(
            session, scoped(Comment, select(func.count()).select_from(Comment))
        ),
        comments_posted=_count(
            session,
            scoped(
                Comment,
                select(func.count()).select_from(Comment).where(Comment.posted_at.is_not(None)),
            ),
        ),
        connections_scheduled=_count(
            session, scoped(ScheduledTask, select(func.count()).select_from(ScheduledTask))
        ),
        connections_sent=_count(
            session,
            scoped(
                Action,
                select(func.count())
                .select_from(Action)
                .where(
                    Action.action_type == ActionType.SEND_CONNECTION,
                    Action.status.in_(SUCCESS_STATUSES),
                ),
            ),
        ),
        failed_actions=_count(
            session,
            scoped(
                Action,
                select(func.count())
                .select_from(Action)
                .where(Action.status == ActionStatus.FAILED),
            ),
        ),
        actions_today=actions_today,
        pending_approvals=_count(
            session,
            scoped(
                Approval,
                select(func.count())
                .select_from(Approval)
                .where(Approval.status == ApprovalStatus.PENDING),
            ),
        ) + (
            _count(
                session,
                select(func.count())
                .select_from(UserPost)
                .where(UserPost.owner_id == owner_id, UserPost.status == "WAITING_APPROVAL")
                if owner_id is not None
                else select(func.count()).select_from(UserPost).where(UserPost.status == "WAITING_APPROVAL"),
            )
            if not campaign_id
            else 0
        ),
    )


def agent_status(session: Session, *, owner_id: int | None = None) -> AgentStatus:
    """The most recently touched workflow of a running campaign."""
    # Check if global pause is enabled in user settings
    if owner_id is not None:
        user_sett = session.scalar(select(UserSettings).where(UserSettings.user_id == owner_id))
        if user_sett and user_sett.is_globally_paused:
            return AgentStatus(
                state="PAUSED",
                is_globally_paused=True,
                current_step="Automation paused by user",
                dry_run=settings.dry_run,
            )

    stmt = (
        select(Workflow, Campaign, Person)
        .join(Campaign, Campaign.id == Workflow.campaign_id)
        .join(Person, Person.id == Workflow.person_id)
        .where(
            Campaign.status == CampaignStatus.RUNNING,
            Workflow.state.notin_(list(TERMINAL_STATES)),
        )
    )
    if owner_id is not None:
        stmt = stmt.where(Campaign.owner_id == owner_id)
    row = session.execute(stmt.order_by(Workflow.updated_at.desc()).limit(1)).first()

    now_utc = datetime.now(UTC)
    is_outside_hours = now_utc.hour < 9 or now_utc.hour >= 18

    if row is None:
        running_stmt = (
            select(func.count())
            .select_from(Campaign)
            .where(Campaign.status == CampaignStatus.RUNNING)
        )
        if owner_id is not None:
            running_stmt = running_stmt.where(Campaign.owner_id == owner_id)
        running = _count(session, running_stmt)
        if running:
            if is_outside_hours:
                return AgentStatus(
                    state="OUTSIDE_HOURS",
                    is_globally_paused=False,
                    current_step="Outside working hours (09:00–18:00)",
                    dry_run=settings.dry_run,
                )
            return AgentStatus(state="RUNNING", is_globally_paused=False, dry_run=settings.dry_run)
        return AgentStatus(state="IDLE", is_globally_paused=False, dry_run=settings.dry_run)

    workflow, campaign, person = row
    return AgentStatus(
        state="OUTSIDE_HOURS" if is_outside_hours else "RUNNING",
        is_globally_paused=False,
        campaign_id=campaign.id,
        campaign_name=campaign.name,
        person_id=person.id,
        person_name=person.full_name,
        workflow_state=workflow.state,
        current_step=STEP_LABELS.get(workflow.state, workflow.state.value),
        dry_run=campaign.dry_run,
        updated_at=workflow.updated_at,
    )


def dashboard(
    session: Session, *, activity_limit: int = 15, owner_id: int | None = None
) -> DashboardResponse:
    campaign_stmt = select(Campaign).where(
        Campaign.status.in_([CampaignStatus.RUNNING, CampaignStatus.PAUSED])
    )
    if owner_id is not None:
        campaign_stmt = campaign_stmt.where(Campaign.owner_id == owner_id)
    campaigns = list(
        session.scalars(campaign_stmt.order_by(Campaign.updated_at.desc()).limit(10))
    )

    cards = [
        DashboardCampaign(
            id=campaign.id,
            name=campaign.name,
            status=campaign.status,
            dry_run=campaign.dry_run,
            candidates_processed=_count(
                session,
                select(func.count())
                .select_from(Workflow)
                .where(
                    Workflow.campaign_id == campaign.id,
                    Workflow.state.in_(list(TERMINAL_STATES)),
                ),
            ),
            pending_approvals=_count(
                session,
                select(func.count())
                .select_from(Approval)
                .where(
                    Approval.campaign_id == campaign.id,
                    Approval.status == ApprovalStatus.PENDING,
                ),
            ),
        )
        for campaign in campaigns
    ]

    recent = list(
        session.scalars(
            scoping.restrict_nullable(select(AgentLog), AgentLog.campaign_id, owner_id)
            .order_by(AgentLog.id.desc())
            .limit(activity_limit)
        )
    )

    return DashboardResponse(
        counters=counters(session, owner_id=owner_id),
        agent=agent_status(session, owner_id=owner_id),
        campaigns=cards,
        recent_activity=list(reversed(recent)),  # type: ignore[arg-type]
    )


# --------------------------------------------------------------- analytics --


def ai_usage(
    session: Session, *, campaign_id: int | None = None, owner_id: int | None = None
) -> AIUsageStats:
    stmt = scoping.restrict(select(AIExecution), AIExecution.campaign_id, owner_id)
    if campaign_id:
        stmt = stmt.where(AIExecution.campaign_id == campaign_id)

    base = stmt.subquery()
    total = _count(session, select(func.count()).select_from(base))
    today_count = _count(
        session,
        select(func.count())
        .select_from(base)
        .where(func.date(base.c.request_at) == _today()),
    )

    by_provider = dict(
        session.execute(select(base.c.provider, func.count()).group_by(base.c.provider)).all()
    )
    cost = session.scalar(
        select(func.coalesce(func.sum(cast(base.c.estimated_cost_usd, Float)), 0.0))
    )
    gpu = session.scalar(select(func.coalesce(func.sum(base.c.gpu_seconds), 0.0)))
    latency = session.scalar(select(func.coalesce(func.avg(base.c.latency_ms), 0)))
    failures = _count(
        session, select(func.count()).select_from(base).where(base.c.success.is_(False))
    )

    return AIUsageStats(
        requests_today=today_count,
        requests_total=total,
        by_provider=by_provider,
        estimated_cost_usd=round(float(cost or 0.0), 6),
        gpu_seconds=round(float(gpu or 0.0), 2),
        average_latency_ms=int(latency or 0),
        failure_rate=round(failures / total, 4) if total else 0.0,
    )


def analytics(
    session: Session,
    *,
    campaign_id: int | None = None,
    days: int = 14,
    owner_id: int | None = None,
) -> AnalyticsResponse:
    def scoped(model, stmt):
        stmt = scoping.restrict(stmt, model.campaign_id, owner_id)
        return stmt.where(model.campaign_id == campaign_id) if campaign_id else stmt

    discovered = _count(
        session, scoped(PersonCampaign, select(func.count()).select_from(PersonCampaign))
    )
    accepted = _count(
        session,
        scoped(
            CandidateEvaluation,
            select(func.count())
            .select_from(CandidateEvaluation)
            .where(CandidateEvaluation.is_match.is_(True)),
        ),
    )
    rejected = _count(
        session,
        scoped(
            CandidateEvaluation,
            select(func.count())
            .select_from(CandidateEvaluation)
            .where(CandidateEvaluation.is_match.is_(False)),
        ),
    )
    posts_analyzed = _count(
        session, scoped(PostEvaluation, select(func.count()).select_from(PostEvaluation))
    )
    posts_accepted = _count(
        session,
        scoped(
            PostEvaluation,
            select(func.count())
            .select_from(PostEvaluation)
            .where(PostEvaluation.eligible.is_(True)),
        ),
    )

    funnel = [
        FunnelPoint(label="Candidates discovered", value=discovered),
        FunnelPoint(label="Candidates accepted", value=accepted),
        FunnelPoint(label="Candidates rejected", value=rejected),
        FunnelPoint(label="Posts analyzed", value=posts_analyzed),
        FunnelPoint(label="Posts accepted", value=posts_accepted),
        FunnelPoint(label="Posts rejected", value=max(0, posts_analyzed - posts_accepted)),
    ]

    since = _today() - timedelta(days=days - 1)
    usage_stmt = scoping.restrict(
        select(DailyUsage).where(DailyUsage.usage_date >= since),
        DailyUsage.campaign_id,
        owner_id,
    )
    if campaign_id:
        usage_stmt = usage_stmt.where(DailyUsage.campaign_id == campaign_id)

    buckets: dict[date, TimeSeriesPoint] = {
        since + timedelta(days=offset): TimeSeriesPoint(day=since + timedelta(days=offset))
        for offset in range(days)
    }
    for usage in session.scalars(usage_stmt):
        point = buckets.get(usage.usage_date)
        if point is None:
            continue
        point.likes += usage.likes_sent
        point.comments += usage.comments_sent
        point.connections += usage.connections_sent
        point.failures += usage.failures

    topic_counter: Counter[str] = Counter()
    topic_stmt = scoping.restrict(
        select(PostEvaluation.topics).where(PostEvaluation.eligible.is_(True)),
        PostEvaluation.campaign_id,
        owner_id,
    )
    if campaign_id:
        topic_stmt = topic_stmt.where(PostEvaluation.campaign_id == campaign_id)
    for (topics,) in session.execute(topic_stmt.limit(2000)):
        topic_counter.update(topics or [])

    duration_stmt = select(
        func.avg(
            func.extract("epoch", Workflow.completed_at - Workflow.started_at)
        )
    ).where(Workflow.completed_at.is_not(None), Workflow.started_at.is_not(None))
    duration_stmt = scoping.restrict(duration_stmt, Workflow.campaign_id, owner_id)
    if campaign_id:
        duration_stmt = duration_stmt.where(Workflow.campaign_id == campaign_id)
    average_seconds = session.scalar(duration_stmt)

    return AnalyticsResponse(
        campaign_id=campaign_id,
        funnel=funnel,
        time_series=[buckets[key] for key in sorted(buckets)],
        ai=ai_usage(session, campaign_id=campaign_id, owner_id=owner_id),
        average_processing_seconds=round(float(average_seconds), 2) if average_seconds else None,
        top_topics=[
            FunnelPoint(label=topic, value=count)
            for topic, count in topic_counter.most_common(10)
        ],
    )
