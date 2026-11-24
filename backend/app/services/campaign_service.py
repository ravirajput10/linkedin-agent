"""Campaign lifecycle: parse, create, edit, start, pause, resume, stop."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.ai.agents import CampaignParserAgent
from app.ai.schemas import ParsedCampaign
from app.config import settings
from app.database.models import (
    Action,
    Approval,
    Campaign,
    CampaignCriteria,
    CampaignExclusion,
    CandidateEvaluation,
    Comment,
    ConnectionMessage,
    PersonCampaign,
    PostEvaluation,
    ScheduledTask,
    User,
    Workflow,
)
from app.enums import (
    TERMINAL_STATES,
    ActionStatus,
    ActionType,
    ApprovalStatus,
    CampaignStatus,
    EventType,
    ScheduledTaskStatus,
    WorkflowState,
)
from app.errors import AppError, ConflictError, ErrorCode, NotFoundError
from app.logging import get_logger
from app.schemas.campaign import (
    AnalyzeResponse,
    CampaignCreate,
    CampaignStats,
    CampaignUpdate,
    CriteriaPayload,
    ExclusionPayload,
)
from app.services import events

logger = get_logger(__name__)

CAMPAIGN_LOADERS = (
    selectinload(Campaign.criteria),
    selectinload(Campaign.exclusions),
)


# ------------------------------------------------------------------ lookup --


def get_campaign(
    session: Session, campaign_id: int, *, owner_id: int | None = None
) -> Campaign:
    """``owner_id=None`` is unrestricted; workers and admin routes pass None.

    A campaign owned by someone else reads as missing rather than forbidden, so
    the response never confirms that an id exists.
    """
    stmt = select(Campaign).where(Campaign.id == campaign_id).options(*CAMPAIGN_LOADERS)
    if owner_id is not None:
        stmt = stmt.where(Campaign.owner_id == owner_id)
    campaign = session.scalar(stmt)
    if campaign is None:
        raise NotFoundError(f"Campaign {campaign_id} not found.")
    return campaign


def list_campaigns(
    session: Session,
    *,
    status: CampaignStatus | None = None,
    owner_id: int | None = None,
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[Campaign], int]:
    stmt = select(Campaign).options(*CAMPAIGN_LOADERS)
    count_stmt = select(func.count()).select_from(Campaign)
    if status is not None:
        stmt = stmt.where(Campaign.status == status)
        count_stmt = count_stmt.where(Campaign.status == status)
    if owner_id is not None:
        stmt = stmt.where(Campaign.owner_id == owner_id)
        count_stmt = count_stmt.where(Campaign.owner_id == owner_id)
    total = session.scalar(count_stmt) or 0
    items = list(session.scalars(stmt.order_by(Campaign.created_at.desc()).offset(offset).limit(limit)))
    return items, total


# ------------------------------------------------------------------ parser --


def criteria_from_parsed(parsed: ParsedCampaign) -> CriteriaPayload:
    """Map the AI's output onto the editable criteria the user reviews."""
    people, posts, plan = parsed.target_people, parsed.post_criteria, parsed.engagement
    return CriteriaPayload(
        job_titles=people.job_titles,
        industries=people.industries,
        locations=people.locations,
        company_sizes=people.company_sizes,
        people_keywords=people.keywords,
        seniority_levels=people.seniority_levels,
        include_topics=posts.include_topics,
        exclude_topics=posts.exclude_topics,
        include_keywords=posts.include_keywords,
        exclude_keywords=posts.exclude_keywords,
        post_types=posts.post_types,
        minimum_relevance_score=posts.minimum_relevance_score,
        initial_posts_to_like=plan.initial_posts_to_like,
        evaluate_post_index=plan.evaluate_post_index,
        generate_comment=plan.generate_comment,
        connection_delay_hours=plan.connection_delay_hours,
        max_people_per_day=plan.max_people_per_day,
    )


async def analyze_instruction(
    session: Session, instruction: str, *, campaign_id: int | None = None
) -> AnalyzeResponse:
    """Run the campaign parser. The result is a proposal the user must confirm."""
    agent = CampaignParserAgent()
    result = await agent.run(session=session, campaign_id=campaign_id, instruction=instruction)
    parsed = result.data

    return AnalyzeResponse(
        parsed=parsed,
        criteria=criteria_from_parsed(parsed),
        suggested_name=parsed.campaign_name,
        summary=parsed.summary,
        provider=result.provider,
        model=result.model,
        prompt_version=result.prompt_version,
    )


# ------------------------------------------------------------------- write --


def _default_criteria(owner: User | None = None) -> CriteriaPayload:
    """Server defaults, overlaid with the owner's saved preferences.

    The values are copied into the campaign's own criteria row, so changing an
    account's settings later never re-tunes a campaign that is already running.
    """
    criteria = CriteriaPayload(
        minimum_relevance_score=settings.minimum_relevance_score,
        initial_posts_to_like=settings.initial_posts_to_like,
        evaluate_post_index=settings.evaluated_post_index,
        connection_delay_hours=settings.connection_delay_hours,
        max_people_per_day=settings.max_people_per_day,
        max_likes_per_day=settings.max_likes_per_day,
        max_comments_per_day=settings.max_comments_per_day,
        max_connections_per_day=settings.max_connections_per_day,
        max_people_per_run=settings.max_people_per_run,
        min_action_delay_seconds=settings.min_action_delay_seconds,
        max_action_delay_seconds=settings.max_action_delay_seconds,
    )

    preferences = owner.settings if owner is not None else None
    if preferences is None:
        return criteria

    for field in (
        "max_people_per_day",
        "max_likes_per_day",
        "max_comments_per_day",
        "max_connections_per_day",
        "max_people_per_run",
        "min_action_delay_seconds",
        "max_action_delay_seconds",
        "initial_posts_to_like",
        "evaluate_post_index",
        "minimum_relevance_score",
        "minimum_candidate_score",
        "generate_comment",
        "connection_delay_hours",
        "comment_length",
        "comment_style",
        "connection_message_mode",
        "connection_message_template",
        "candidate_approval",
        "comment_approval",
        "connection_approval",
    ):
        if hasattr(criteria, field):
            setattr(criteria, field, getattr(preferences, field))
    return criteria


def _apply_criteria(criteria: CampaignCriteria, payload: CriteriaPayload) -> None:
    for field, value in payload.model_dump().items():
        setattr(criteria, field, value)


def _apply_exclusions(
    session: Session, campaign: Campaign, payloads: list[ExclusionPayload]
) -> None:
    for existing in list(campaign.exclusions):
        session.delete(existing)
    campaign.exclusions = [
        CampaignExclusion(
            campaign_id=campaign.id,
            exclusion_type=item.exclusion_type,
            value=item.value,
            reason=item.reason,
        )
        for item in payloads
    ]
    session.flush()


def create_campaign(
    session: Session, payload: CampaignCreate, *, owner: User | None = None
) -> Campaign:
    from app.database.models import Audience, AudienceMember
    from app.services.user_service import effective_dry_run
    from app.services.quota_service import QuotaService

    if owner is not None:
        can_create, reason = QuotaService.can_create_campaign(session, owner)
        if not can_create:
            raise AppError(
                reason or "You have reached your active campaign limit for this plan.",
                code=ErrorCode.QUOTA_EXCEEDED,
                http_status=402,
                details={"type": "quota_exceeded", "quota": "max_campaigns"},
            )

    requested_dry_run = payload.dry_run if payload.dry_run is not None else settings.dry_run
    # Server-wide DRY_RUN is a safety switch, so a request cannot turn it off.
    dry_run = True if settings.dry_run else (
        requested_dry_run if payload.dry_run is not None
        else (effective_dry_run(owner) if owner is not None else settings.dry_run)
    )

    campaign = Campaign(
        name=payload.name,
        description=payload.description,
        instruction=payload.instruction,
        dry_run=dry_run,
        status=CampaignStatus.DRAFT,
        owner_id=owner.id if owner is not None else None,
        audience_id=payload.audience_id,
    )
    session.add(campaign)
    session.flush()

    criteria = CampaignCriteria(campaign_id=campaign.id)
    _apply_criteria(criteria, payload.criteria or _default_criteria(owner))
    session.add(criteria)
    session.flush()

    if payload.exclusions:
        _apply_exclusions(session, campaign, payload.exclusions)

    # If audience_id provided, enroll active members into PersonCampaign (FR-3.1 & FR-3.11)
    if payload.audience_id:
        aud = session.scalar(
            select(Audience).where(Audience.id == payload.audience_id)
        )
        if aud:
            members = session.scalars(
                select(AudienceMember).where(
                    AudienceMember.audience_id == aud.id,
                    AudienceMember.excluded.is_(False),
                )
            ).all()
            for m in members:
                # Check single campaign lock (FR-3.11)
                if criteria.single_campaign_lock:
                    already_in_active = session.scalar(
                        select(PersonCampaign).join(Campaign).where(
                            PersonCampaign.person_id == m.person_id,
                            Campaign.status.in_([CampaignStatus.RUNNING, CampaignStatus.PAUSED]),
                            Campaign.id != campaign.id,
                        )
                    )
                    if already_in_active:
                        continue

                link = session.scalar(
                    select(PersonCampaign).where(
                        PersonCampaign.campaign_id == campaign.id,
                        PersonCampaign.person_id == m.person_id,
                    )
                )
                if not link:
                    link = PersonCampaign(
                        campaign_id=campaign.id,
                        person_id=m.person_id,
                        match_score=m.fit_score,
                        discovery_reason=m.match_reason or "Enrolled from audience",
                        matched_criteria=m.matched_criteria,
                    )
                    session.add(link)
            session.flush()

    session.refresh(campaign)
    events.emit(
        session,
        EventType.CAMPAIGN_STATUS_CHANGED,
        f"Campaign '{campaign.name}' created as a draft.",
        campaign_id=campaign.id,
    )
    return campaign


def update_campaign(
    session: Session,
    campaign_id: int,
    payload: CampaignUpdate,
    *,
    owner_id: int | None = None,
) -> Campaign:
    campaign = get_campaign(session, campaign_id, owner_id=owner_id)

    if campaign.status is CampaignStatus.RUNNING and payload.criteria is not None:
        raise ConflictError(
            "Pause the campaign before editing its criteria, so in-flight "
            "workflows are not evaluated against two different rule sets."
        )

    for field in ("name", "description", "instruction", "dry_run", "audience_id", "is_archived"):
        value = getattr(payload, field, None)
        if value is not None:
            setattr(campaign, field, value)

    if payload.criteria is not None:
        if campaign.criteria is None:
            campaign.criteria = CampaignCriteria(campaign_id=campaign.id)
            session.add(campaign.criteria)
            session.flush()
        _apply_criteria(campaign.criteria, payload.criteria)

    if payload.exclusions is not None:
        _apply_exclusions(session, campaign, payload.exclusions)

    session.flush()
    return campaign


def duplicate_campaign(
    session: Session, campaign_id: int, *, owner_id: int | None = None
) -> Campaign:
    """FR-3.10: Duplicate campaign."""
    source = get_campaign(session, campaign_id, owner_id=owner_id)

    new_campaign = Campaign(
        owner_id=source.owner_id,
        audience_id=source.audience_id,
        name=f"{source.name} (Copy)",
        description=source.description,
        instruction=source.instruction,
        dry_run=source.dry_run,
        status=CampaignStatus.DRAFT,
    )
    session.add(new_campaign)
    session.flush()

    if source.criteria:
        new_crit = CampaignCriteria(campaign_id=new_campaign.id)
        _apply_criteria(new_crit, CriteriaPayload.model_validate(source.criteria))
        session.add(new_crit)

    for ex in source.exclusions:
        session.add(
            CampaignExclusion(
                campaign_id=new_campaign.id,
                exclusion_type=ex.exclusion_type,
                value=ex.value,
                reason=ex.reason,
            )
        )

    session.flush()
    session.refresh(new_campaign)
    events.emit(
        session,
        EventType.CAMPAIGN_STATUS_CHANGED,
        f"Campaign '{new_campaign.name}' duplicated from campaign #{source.id}.",
        campaign_id=new_campaign.id,
    )
    return new_campaign


def archive_campaign(
    session: Session, campaign_id: int, *, owner_id: int | None = None
) -> Campaign:
    """FR-3.10: Archive / Unarchive campaign."""
    campaign = get_campaign(session, campaign_id, owner_id=owner_id)
    campaign.is_archived = not campaign.is_archived
    session.flush()
    msg = f"Campaign '{campaign.name}' {'archived' if campaign.is_archived else 'unarchived'}."
    events.emit(session, EventType.CAMPAIGN_STATUS_CHANGED, msg, campaign_id=campaign.id)
    return campaign


def skip_prospect(
    session: Session, campaign_id: int, person_id: int, *, owner_id: int | None = None
) -> Workflow:
    """FR-3.12: Skip person in campaign."""
    campaign = get_campaign(session, campaign_id, owner_id=owner_id)
    workflow = session.scalar(
        select(Workflow).where(
            Workflow.campaign_id == campaign.id,
            Workflow.person_id == person_id,
        )
    )
    if workflow is None:
        raise NotFoundError(f"Workflow for person {person_id} not found in campaign {campaign_id}.")

    workflow.previous_state = workflow.state
    workflow.state = WorkflowState.SKIPPED
    workflow.completed_at = datetime.now(UTC)

    # Cancel any pending scheduled tasks for this workflow/person
    tasks = session.scalars(
        select(ScheduledTask).where(
            ScheduledTask.campaign_id == campaign.id,
            ScheduledTask.person_id == person_id,
            ScheduledTask.status == ScheduledTaskStatus.SCHEDULED,
        )
    ).all()
    for t in tasks:
        t.status = ScheduledTaskStatus.CANCELLED

    session.flush()
    events.emit(
        session,
        EventType.WORKFLOW_STATE_CHANGED,
        f"Prospect #{person_id} skipped in campaign '{campaign.name}'.",
        campaign_id=campaign.id,
    )
    return workflow


def remove_prospect(
    session: Session, campaign_id: int, person_id: int, *, owner_id: int | None = None
) -> None:
    """FR-3.12: Remove person from campaign."""
    campaign = get_campaign(session, campaign_id, owner_id=owner_id)
    link = session.scalar(
        select(PersonCampaign).where(
            PersonCampaign.campaign_id == campaign.id,
            PersonCampaign.person_id == person_id,
        )
    )
    if link is not None:
        session.delete(link)

    workflow = session.scalar(
        select(Workflow).where(
            Workflow.campaign_id == campaign.id,
            Workflow.person_id == person_id,
        )
    )
    if workflow is not None:
        session.delete(workflow)

    tasks = session.scalars(
        select(ScheduledTask).where(
            ScheduledTask.campaign_id == campaign.id,
            ScheduledTask.person_id == person_id,
            ScheduledTask.status == ScheduledTaskStatus.SCHEDULED,
        )
    ).all()
    for t in tasks:
        t.status = ScheduledTaskStatus.CANCELLED

    session.flush()
    events.emit(
        session,
        EventType.WORKFLOW_STATE_CHANGED,
        f"Prospect #{person_id} removed from campaign '{campaign.name}'.",
        campaign_id=campaign.id,
    )


def handle_prospect_reply(
    session: Session, campaign_id: int, person_id: int, *, owner_id: int | None = None
) -> Workflow:
    """FR-3.6: Auto-stop sequence for person when they reply to a message or comment."""
    campaign = get_campaign(session, campaign_id, owner_id=owner_id)
    workflow = session.scalar(
        select(Workflow).where(
            Workflow.campaign_id == campaign.id,
            Workflow.person_id == person_id,
        )
    )
    if workflow is None:
        raise NotFoundError(f"Workflow for person {person_id} not found in campaign {campaign_id}.")

    workflow.previous_state = workflow.state
    workflow.state = WorkflowState.COMPLETED
    workflow.completed_at = datetime.now(UTC)
    workflow.context = {**(workflow.context or {}), "stop_reason": "REPLY_RECEIVED"}

    tasks = session.scalars(
        select(ScheduledTask).where(
            ScheduledTask.campaign_id == campaign.id,
            ScheduledTask.person_id == person_id,
            ScheduledTask.status == ScheduledTaskStatus.SCHEDULED,
        )
    ).all()
    for t in tasks:
        t.status = ScheduledTaskStatus.CANCELLED

    session.flush()
    events.emit(
        session,
        EventType.WORKFLOW_COMPLETED,
        f"Sequence auto-stopped for prospect #{person_id} because they replied.",
        campaign_id=campaign.id,
    )
    return workflow


def delete_campaign(
    session: Session, campaign_id: int, *, owner_id: int | None = None
) -> None:
    campaign = get_campaign(session, campaign_id, owner_id=owner_id)
    if campaign.status is CampaignStatus.RUNNING:
        raise ConflictError("Stop the campaign before deleting it.")
    session.delete(campaign)
    session.flush()



# --------------------------------------------------------------- lifecycle --


def _set_status(
    session: Session, campaign: Campaign, status: CampaignStatus, message: str
) -> Campaign:
    campaign.status = status
    now = datetime.now(UTC)
    match status:
        case CampaignStatus.RUNNING:
            campaign.started_at = campaign.started_at or now
            campaign.paused_at = None
        case CampaignStatus.PAUSED:
            campaign.paused_at = now
        case CampaignStatus.STOPPED:
            campaign.stopped_at = now
        case CampaignStatus.COMPLETED:
            campaign.completed_at = now
    session.flush()
    events.emit(
        session, EventType.CAMPAIGN_STATUS_CHANGED, message, campaign_id=campaign.id
    )
    return campaign


def require_owner_can_act(session: Session, campaign: Campaign) -> None:
    """Refuse to start unless the owner has a LinkedIn account to act through.

    Enforces:
    - Connected platform account
    - FR-1.4: Chrome extension must be installed and online
    """
    from datetime import timedelta
    from app.database.models import UserPlatformAccount
    from app.enums import PlatformAccountStatus, PlatformProvider
    from app.integrations.platform.factory import requires_connected_account
    from app.services import integration_service

    if not requires_connected_account():
        return
    if campaign.owner_id is None:
        raise ConflictError(
            "This campaign has no owner, so there is no LinkedIn account to act "
            "through. Assign an owner before starting it."
        )

    account = session.scalar(
        select(UserPlatformAccount).where(
            UserPlatformAccount.user_id == campaign.owner_id,
            UserPlatformAccount.provider == PlatformProvider.LINKEDIN,
        )
    )
    # Circuit breaker & warning check (FR-9.9)
    if account is not None and account.status == PlatformAccountStatus.WARNING:
        raise ConflictError(
            "Campaign cannot be started while a LinkedIn warning or restriction is active. "
            "Please review the warning in Settings before resuming."
        )

    if account is None or account.status != PlatformAccountStatus.CONNECTED:
        if not integration_service.connected_account_id(session, campaign.owner_id):
            raise ConflictError(
                "Connect your LinkedIn account before starting a campaign. "
                "You can do that from your profile or onboarding wizard."
            )

    # Global pause check (FR-9.8)
    from app.database.models import UserSettings
    sett = session.scalar(select(UserSettings).where(UserSettings.user_id == campaign.owner_id))
    if sett is not None and sett.is_globally_paused:
        raise ConflictError("All campaigns are currently globally paused. Resume automation first.")

    # In production/live mode, verify extension is online (seen in last 90s)
    if settings.is_production and account is not None:
        now = datetime.now(UTC)
        last_seen = account.extension_last_seen
        if last_seen and last_seen.tzinfo is None:
            last_seen = last_seen.replace(tzinfo=UTC)
        if not last_seen or (now - last_seen) > timedelta(seconds=90):
            raise ConflictError(
                "Chrome extension must be installed and online to start a campaign."
            )



def start_campaign(
    session: Session, campaign_id: int, *, owner_id: int | None = None
) -> Campaign:
    campaign = get_campaign(session, campaign_id, owner_id=owner_id)
    if campaign.status is CampaignStatus.RUNNING:
        raise ConflictError("Campaign is already running.")
    if campaign.criteria is None:
        raise ConflictError("Campaign has no criteria. Analyze the instruction first.")
    require_owner_can_act(session, campaign)
    return _set_status(
        session, campaign, CampaignStatus.RUNNING, f"Campaign '{campaign.name}' started."
    )


def pause_campaign(
    session: Session, campaign_id: int, *, owner_id: int | None = None
) -> Campaign:
    campaign = get_campaign(session, campaign_id, owner_id=owner_id)
    if campaign.status is not CampaignStatus.RUNNING:
        raise ConflictError(f"Campaign is {campaign.status.value}, not RUNNING.")
    return _set_status(
        session, campaign, CampaignStatus.PAUSED, f"Campaign '{campaign.name}' paused."
    )


def resume_campaign(
    session: Session, campaign_id: int, *, owner_id: int | None = None
) -> Campaign:
    campaign = get_campaign(session, campaign_id, owner_id=owner_id)
    if campaign.status not in (CampaignStatus.PAUSED, CampaignStatus.STOPPED, CampaignStatus.COMPLETED):
        raise ConflictError(f"Campaign is {campaign.status.value}; nothing to resume.")
    require_owner_can_act(session, campaign)
    campaign.completed_at = None
    return _set_status(
        session, campaign, CampaignStatus.RUNNING, f"Campaign '{campaign.name}' resumed."
    )


def stop_campaign(
    session: Session, campaign_id: int, *, owner_id: int | None = None
) -> Campaign:
    """Stop the campaign and cancel everything still scheduled for it."""
    campaign = get_campaign(session, campaign_id, owner_id=owner_id)

    pending = session.scalars(
        select(ScheduledTask).where(
            ScheduledTask.campaign_id == campaign.id,
            ScheduledTask.status == ScheduledTaskStatus.SCHEDULED,
        )
    )
    cancelled = 0
    for task in pending:
        task.status = ScheduledTaskStatus.CANCELLED
        cancelled += 1

    open_approvals = session.scalars(
        select(Approval).where(
            Approval.campaign_id == campaign.id, Approval.status == ApprovalStatus.PENDING
        )
    )
    for approval in open_approvals:
        approval.status = ApprovalStatus.CANCELLED
        approval.decided_at = datetime.now(UTC)

    session.flush()
    return _set_status(
        session,
        campaign,
        CampaignStatus.STOPPED,
        f"Campaign '{campaign.name}' stopped; {cancelled} scheduled actions cancelled.",
    )


# ------------------------------------------------------------------- stats --


def campaign_stats(session: Session, campaign_id: int) -> CampaignStats:
    def count(stmt) -> int:
        return session.scalar(stmt) or 0

    discovered = count(
        select(func.count()).select_from(PersonCampaign).where(
            PersonCampaign.campaign_id == campaign_id
        )
    )
    matched = count(
        select(func.count()).select_from(CandidateEvaluation).where(
            CandidateEvaluation.campaign_id == campaign_id,
            CandidateEvaluation.is_match.is_(True),
        )
    )
    processed = count(
        select(func.count()).select_from(Workflow).where(
            Workflow.campaign_id == campaign_id,
            Workflow.state.in_(list(TERMINAL_STATES)),
        )
    )
    posts_analyzed = count(
        select(func.count()).select_from(PostEvaluation).where(
            PostEvaluation.campaign_id == campaign_id
        )
    )
    posts_liked = count(
        select(func.count()).select_from(Action).where(
            Action.campaign_id == campaign_id,
            Action.action_type == ActionType.LIKE_POST,
            Action.status.in_([ActionStatus.SUCCESS, ActionStatus.SKIPPED_DRY_RUN]),
        )
    )
    comments_generated = count(
        select(func.count()).select_from(Comment).where(Comment.campaign_id == campaign_id)
    )
    comments_posted = count(
        select(func.count()).select_from(Comment).where(
            Comment.campaign_id == campaign_id, Comment.posted_at.is_not(None)
        )
    )
    connections_scheduled = count(
        select(func.count()).select_from(ScheduledTask).where(
            ScheduledTask.campaign_id == campaign_id
        )
    )
    connections_sent = count(
        select(func.count()).select_from(ConnectionMessage).where(
            ConnectionMessage.campaign_id == campaign_id,
            ConnectionMessage.sent_at.is_not(None),
        )
    ) or count(
        select(func.count()).select_from(Action).where(
            Action.campaign_id == campaign_id,
            Action.action_type == ActionType.SEND_CONNECTION,
            Action.status.in_([ActionStatus.SUCCESS, ActionStatus.SKIPPED_DRY_RUN]),
        )
    )
    failed = count(
        select(func.count()).select_from(Action).where(
            Action.campaign_id == campaign_id, Action.status == ActionStatus.FAILED
        )
    )
    pending_approvals = count(
        select(func.count()).select_from(Approval).where(
            Approval.campaign_id == campaign_id, Approval.status == ApprovalStatus.PENDING
        )
    )

    return CampaignStats(
        candidates_discovered=discovered,
        candidates_matched=matched,
        candidates_processed=processed,
        posts_analyzed=posts_analyzed,
        posts_liked=posts_liked,
        comments_generated=comments_generated,
        comments_posted=comments_posted,
        connections_scheduled=connections_scheduled,
        connections_sent=connections_sent,
        failed_actions=failed,
        pending_approvals=pending_approvals,
    )


def enroll_manual_prospect(
    session: Session,
    campaign_id: int,
    payload: "EnrollProspectPayload",
    *,
    owner_id: int | None = None,
) -> Person:
    from datetime import UTC, datetime
    from app.database.models import Person, PersonCampaign, Workflow
    from app.enums import ConnectionStatus, WorkflowState
    from app.errors import NotFoundError

    campaign = get_campaign(session, campaign_id, owner_id=owner_id)
    if campaign is None:
        raise NotFoundError(f"Campaign {campaign_id} not found.")

    clean_url = payload.profile_url.strip().rstrip("/")
    fallback_name = clean_url.split("/")[-1].replace("-", " ").title() if "/" in clean_url else "LinkedIn Prospect"
    name = (payload.full_name or "").strip() or fallback_name
    title = payload.job_title or "LinkedIn Professional"
    company = payload.company or "—"

    person = session.scalar(
        select(Person).where(Person.platform == "linkedin", Person.profile_url == clean_url)
    )
    if person is None:
        person = Person(
            platform="linkedin",
            profile_url=clean_url,
            full_name=name,
            headline=title,
            job_title=title,
            company=company,
            connection_status=ConnectionStatus.UNKNOWN,
            last_synced_at=datetime.now(UTC),
        )
        session.add(person)
        session.flush()

    link = session.scalar(
        select(PersonCampaign).where(
            PersonCampaign.campaign_id == campaign.id,
            PersonCampaign.person_id == person.id,
        )
    )
    if link is None:
        link = PersonCampaign(
            campaign_id=campaign.id,
            person_id=person.id,
            discovery_reason="Manually enrolled via LinkedIn URL",
            matched_criteria=["Manual enrollment"],
            match_score=100,
        )
        session.add(link)
        session.flush()

    wf = session.scalar(
        select(Workflow).where(
            Workflow.campaign_id == campaign.id,
            Workflow.person_id == person.id,
        )
    )
    if wf is None:
        wf = Workflow(
            campaign_id=campaign.id,
            person_id=person.id,
            state=WorkflowState.CANDIDATE_FOUND,
        )
        session.add(wf)
        session.flush()

    return person
