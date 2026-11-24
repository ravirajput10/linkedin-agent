"""Agent API endpoints for Chrome Extension communication and status synchronization.

Covers:
- FR-1.4: Extension installed & online detection (blocks campaigns when offline)
- FR-1.5: Extension session pairing & identity verification
- FR-1.6: Account tier detection (Free, Premium, Sales Navigator)
- FR-1.7: Connection status visibility
- FR-1.8: Session expiry pause and notification
- FR-1.9: Disconnect account and halt campaigns
"""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, or_, select

from typing import Any

from app.api.deps import CurrentUser, DbSession, OptionalUser
from app.database.models import (
    Action,
    AgentLog,
    Approval,
    Audience,
    Campaign,
    DailyUsage,
    Person,
    PersonCampaign,
    ScheduledTask,
    User,
    UserPlatformAccount,
    UserSettings,
)
from app.enums import (
    ActionStatus,
    ActionType,
    ApprovalStatus,
    CampaignStatus,
    LogLevel,
    PlatformAccountStatus,
    PlatformProvider,
    ScheduledTaskStatus,
)
from app.logging import get_logger
from app.security import create_access_token
from app.schemas.agent import (
    AgentHeartbeatRequest,
    AgentHeartbeatResponse,
    AgentPairSessionRequest,
    AgentPairSessionResponse,
    AgentProfileEvaluationRequest,
    AgentProfileEvaluationResponse,
    AgentQueueItem,
    AgentQueueReportRequest,
    AgentQueueResponse,
    AgentStatusResponse,
)
from app.schemas.common import MessageResponse
from app.services.dispatch import dispatch_workflow_advance

logger = get_logger(__name__)
router = APIRouter(prefix="/agent", tags=["agent"])


@router.post("/heartbeat", response_model=AgentHeartbeatResponse)
def agent_heartbeat(
    session: DbSession,
    payload: AgentHeartbeatRequest,
    current_user: OptionalUser = None,
) -> AgentHeartbeatResponse:
    """Record heartbeat ping from Chrome extension service worker (FR-1.4, FR-8.9)."""
    now = datetime.now(UTC)

    # If no bearer token provided, resolve account from member_id or active connected user
    account = None
    if current_user is not None:
        account = session.scalar(
            select(UserPlatformAccount).where(
                UserPlatformAccount.user_id == current_user.id,
                UserPlatformAccount.provider == PlatformProvider.LINKEDIN,
            )
        )
    elif payload.linkedin_member_id:
        account = session.scalar(
            select(UserPlatformAccount).where(
                UserPlatformAccount.platform_member_id == payload.linkedin_member_id,
                UserPlatformAccount.provider == PlatformProvider.LINKEDIN,
            )
        )

    if account is None and current_user is None:
        if payload.linkedin_member_id:
            return AgentHeartbeatResponse(
                acknowledged=True,
                extension_online=True,
                server_time=now,
                connection_status="PENDING",
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication or linked platform account required to record heartbeat.",
        )

    if account is None and current_user is not None:
        account = UserPlatformAccount(
            user_id=current_user.id,
            provider=PlatformProvider.LINKEDIN,
            status=PlatformAccountStatus.PENDING,
            extension_last_seen=now,
            extension_version=payload.extension_version,
        )
        session.add(account)
    elif account is not None:
        account.extension_last_seen = now
        account.extension_version = payload.extension_version
        if payload.linkedin_member_id and not account.platform_member_id:
            account.platform_member_id = payload.linkedin_member_id

    session.commit()

    conn_status = account.status.value if account else "NOT_CONNECTED"
    if account and account.status == PlatformAccountStatus.CONNECTED:
        conn_status = "CONNECTED"

    return AgentHeartbeatResponse(
        acknowledged=True,
        extension_online=True,
        server_time=now,
        connection_status=conn_status,
    )


@router.get("/status", response_model=AgentStatusResponse)
def get_agent_status(session: DbSession, current_user: CurrentUser) -> AgentStatusResponse:
    """Retrieve full agent status across web app and extension (FR-1.4, FR-1.7)."""
    account = session.scalar(
        select(UserPlatformAccount).where(
            UserPlatformAccount.user_id == current_user.id,
            UserPlatformAccount.provider == PlatformProvider.LINKEDIN,
        )
    )

    now = datetime.now(UTC)
    extension_online = False
    connection_status = "NOT_CONNECTED"
    tier = "FREE"
    member_id = None
    member_name = current_user.full_name

    if account is not None:
        tier = account.account_tier or "FREE"
        member_id = account.platform_member_id

        # Extension is considered online if seen within 90 seconds
        last_seen = account.extension_last_seen
        if last_seen and last_seen.tzinfo is None:
            last_seen = last_seen.replace(tzinfo=UTC)
        if last_seen and (now - last_seen) < timedelta(seconds=90):
            extension_online = True

        if account.status == PlatformAccountStatus.CONNECTED:
            connection_status = "CONNECTED" if extension_online else "EXTENSION_OFFLINE"
        elif account.status == PlatformAccountStatus.WARNING:
            connection_status = "WARNING"
        elif account.status in (PlatformAccountStatus.ERROR, PlatformAccountStatus.EXPIRED):
            connection_status = "SESSION_EXPIRED"
        else:
            connection_status = account.status.value

    # Campaign blocking logic (FR-1.4: block campaign start until extension online)
    campaigns_blocked = False
    block_reason = None
    if connection_status == "EXTENSION_OFFLINE":
        campaigns_blocked = True
        block_reason = "Chrome extension is installed but offline. Open your browser or ensure extension is active."
    elif connection_status in ("NOT_CONNECTED", "PENDING"):
        campaigns_blocked = True
        block_reason = "No active LinkedIn account connected. Please complete onboarding step 2."
    elif connection_status == "SESSION_EXPIRED":
        campaigns_blocked = True
        block_reason = "LinkedIn session expired. Please reconnect your account to resume campaigns."
    elif connection_status == "WARNING":
        campaigns_blocked = True
        block_reason = "LinkedIn warning/checkpoint detected. Automation is halted for account safety."

    session.commit()
    return AgentStatusResponse(
        connected=connection_status == "CONNECTED",
        connection_status=connection_status,
        extension_online=extension_online,
        extension_last_seen=account.extension_last_seen if account else None,
        extension_version=account.extension_version if account else None,
        account_tier=tier,
        member_name=member_name,
        member_id=member_id,
        campaigns_blocked=campaigns_blocked,
        block_reason=block_reason,
    )


@router.post("/pair-session", response_model=AgentPairSessionResponse)
def pair_extension_session(
    session: DbSession,
    payload: AgentPairSessionRequest,
    current_user: CurrentUser,
) -> AgentPairSessionResponse:
    """Pair the browser's active LinkedIn session with the workspace account (FR-1.5, FR-1.6)."""

    account = session.scalar(
        select(UserPlatformAccount).where(
            UserPlatformAccount.user_id == current_user.id,
            UserPlatformAccount.provider == PlatformProvider.LINKEDIN,
        )
    )

    now = datetime.now(UTC)
    if account is None:
        account = UserPlatformAccount(
            user_id=current_user.id,
            provider=PlatformProvider.LINKEDIN,
        )
        session.add(account)

    # Member verification: check if member matches or bind new member
    member_matched = True
    if account.platform_member_id and account.platform_member_id != payload.member_id:
        # Check if names loosely match (skip generic tab titles)
        if (
            current_user.full_name
            and payload.member_name
            and payload.member_name not in ("LinkedIn Member", "FEED", "LINKEDIN")
        ):
            user_tokens = set(current_user.full_name.lower().split())
            member_tokens = set(payload.member_name.lower().split())
            if not user_tokens.intersection(member_tokens):
                member_matched = False
                logger.warning(
                    "Identity mismatch during pairing: workspace user is '%s', tab is '%s'",
                    current_user.full_name,
                    payload.member_name,
                )

    if not member_matched:
        session.commit()
        return AgentPairSessionResponse(
            success=False,
            connection_status="ERROR",
            member_matched=False,
            account_tier="FREE",
            message=f"Logged-in LinkedIn user ({payload.member_name}) does not match your workspace profile.",
        )

    # Update account details
    account.platform_member_id = payload.member_id
    account.status = PlatformAccountStatus.CONNECTED
    account.connected_at = now
    account.extension_last_seen = now
    account.account_tier = payload.account_tier.upper()
    account.last_error = None

    if payload.profile_url and not current_user.linkedin_url:
        current_user.linkedin_url = payload.profile_url

    session.commit()
    logger.info("Successfully paired LinkedIn session for user %s (%s)", current_user.id, payload.member_name)

    access_token, _ = create_access_token(current_user.id, role=current_user.role.value)

    return AgentPairSessionResponse(
        success=True,
        connection_status="CONNECTED",
        member_matched=True,
        account_tier=account.account_tier,
        message="LinkedIn session linked and verified successfully.",
        access_token=access_token,
        member_name=current_user.full_name or payload.member_name or "LinkedIn Member",
        email=current_user.email,
    )


@router.post("/session-expired", response_model=MessageResponse)
def notify_session_expired(session: DbSession, current_user: CurrentUser) -> MessageResponse:
    """Pause campaigns and mark session expired when LinkedIn session drops (FR-1.8)."""
    account = session.scalar(
        select(UserPlatformAccount).where(
            UserPlatformAccount.user_id == current_user.id,
            UserPlatformAccount.provider == PlatformProvider.LINKEDIN,
        )
    )
    if account is not None:
        account.status = PlatformAccountStatus.EXPIRED
        account.last_error = "LinkedIn session expired or logged out. Reconnect to resume."

    # Pause active campaigns
    active_campaigns = session.scalars(
        select(Campaign).where(
            Campaign.owner_id == current_user.id,
            Campaign.status == CampaignStatus.RUNNING,
        )
    ).all()
    for camp in active_campaigns:
        camp.status = CampaignStatus.PAUSED

    session.commit()
    logger.warning("Session expired for user %s; paused %d campaigns", current_user.id, len(active_campaigns))
    return MessageResponse(
        message="Session marked as expired. Automated actions paused.",
        detail=f"{len(active_campaigns)} active campaign(s) paused.",
    )


@router.post("/disconnect", response_model=MessageResponse)
def disconnect_account(session: DbSession, current_user: CurrentUser) -> MessageResponse:
    """Disconnect account, pause campaigns immediately, and delete session data (FR-1.9)."""
    account = session.scalar(
        select(UserPlatformAccount).where(
            UserPlatformAccount.user_id == current_user.id,
            UserPlatformAccount.provider == PlatformProvider.LINKEDIN,
        )
    )

    if account is not None:
        account.status = PlatformAccountStatus.DISCONNECTED
        account.account_id = None
        account.platform_member_id = None
        account.link_token = None
        account.disconnected_at = datetime.now(UTC)
        account.last_error = None

    # Halt all active campaigns immediately
    campaigns = session.scalars(
        select(Campaign).where(
            Campaign.owner_id == current_user.id,
            Campaign.status == CampaignStatus.RUNNING,
        )
    ).all()
    for camp in campaigns:
        camp.status = CampaignStatus.PAUSED

    session.commit()
    logger.info("Account disconnected for user %s; paused %d campaigns", current_user.id, len(campaigns))
    return MessageResponse(message="Account disconnected successfully. All running campaigns paused.")


@router.post("/circuit-breaker", response_model=MessageResponse)
def trigger_circuit_breaker(
    session: DbSession, current_user: CurrentUser, reason: str = "LinkedIn security challenge / restriction detected."
) -> MessageResponse:
    """Emergency circuit breaker: freezes automation and sets WARNING state (FR-8.8, FR-9.9)."""
    account = session.scalar(
        select(UserPlatformAccount).where(
            UserPlatformAccount.user_id == current_user.id,
            UserPlatformAccount.provider == PlatformProvider.LINKEDIN,
        )
    )
    if account is not None:
        account.status = PlatformAccountStatus.WARNING
        account.last_error = reason

    # Pause all campaigns
    campaigns = session.scalars(
        select(Campaign).where(
            Campaign.owner_id == current_user.id,
            Campaign.status == CampaignStatus.RUNNING,
        )
    ).all()
    for camp in campaigns:
        camp.status = CampaignStatus.PAUSED

    session.commit()
    logger.critical("Circuit breaker tripped for user %s: %s", current_user.id, reason)
    return MessageResponse(
        message="Circuit breaker activated. All automated actions halted.",
        detail=reason,
    )


@router.post("/withdraw-stale-invites", response_model=MessageResponse)
def withdraw_stale_invites(
    session: DbSession,
    current_user: CurrentUser,
    max_age_days: int = Query(default=14, ge=1, le=90),
) -> MessageResponse:
    """Withdraw pending connection requests older than max_age_days (FR-9.6)."""
    from app.services.safety_service import withdraw_stale_invitations
    count = withdraw_stale_invitations(session, owner_id=current_user.id, max_age_days=max_age_days)
    session.commit()
    return MessageResponse(
        message=f"Withdrew {count} connection request(s) older than {max_age_days} days.",
        detail=str(count),
    )


@router.get("/warmup-status")
def get_warmup_status(
    session: DbSession,
    current_user: CurrentUser,
) -> dict[str, Any]:
    """Retrieve warm-up status, active days, and effective limits (FR-9.4)."""
    from app.services.safety_service import get_warmup_multiplier, calculate_effective_limits
    account = session.scalar(
        select(UserPlatformAccount).where(
            UserPlatformAccount.user_id == current_user.id,
            UserPlatformAccount.provider == PlatformProvider.LINKEDIN,
        )
    )
    user_settings = session.scalar(
        select(UserSettings).where(UserSettings.user_id == current_user.id)
    )

    base_limits = {
        "max_likes_per_day": user_settings.max_likes_per_day if user_settings else 60,
        "max_comments_per_day": user_settings.max_comments_per_day if user_settings else 20,
        "max_connections_per_day": user_settings.max_connections_per_day if user_settings else 25,
    }

    connected_at = account.connected_at if account and account.connected_at else current_user.created_at
    if connected_at and connected_at.tzinfo is None:
        connected_at = connected_at.replace(tzinfo=UTC)
    now = datetime.now(UTC)
    days_active = max(1, (now - connected_at).days) if connected_at else 1

    warmup_enabled = days_active <= 21
    multiplier = get_warmup_multiplier(days_active)
    effective_limits = calculate_effective_limits(base_limits, warmup_enabled=warmup_enabled, days_active=days_active)

    return {
        "warmup_enabled": warmup_enabled,
        "days_active": days_active,
        "warmup_day": min(days_active, 21),
        "warmup_total_days": 21,
        "multiplier": multiplier,
        "percentage": int(multiplier * 100),
        "base_limits": base_limits,
        "effective_limits": effective_limits,
    }


@router.post("/accept-risk-terms", response_model=MessageResponse)
def accept_risk_terms(
    session: DbSession,
    current_user: CurrentUser,
    version: str = "1.0",
) -> MessageResponse:
    """Record consent to platform automation terms (FR-9.11)."""
    from app.services.safety_service import record_risk_consent
    record_risk_consent(session, current_user, version=version)
    session.commit()
    return MessageResponse(
        message="Automation risk terms acknowledged and recorded.",
        detail=version,
    )


@router.post("/pause-all", response_model=AgentStatusResponse)
def pause_all_automation(session: DbSession, current_user: CurrentUser) -> AgentStatusResponse:
    """Globally pause all automation campaigns and actions (FR-7.1)."""
    sett = session.scalar(select(UserSettings).where(UserSettings.user_id == current_user.id))
    if sett is None:
        sett = UserSettings(user_id=current_user.id, is_globally_paused=True)
        session.add(sett)
    else:
        sett.is_globally_paused = True

    campaigns = session.scalars(
        select(Campaign).where(
            Campaign.owner_id == current_user.id,
            Campaign.status == CampaignStatus.RUNNING,
        )
    ).all()
    for camp in campaigns:
        camp.status = CampaignStatus.PAUSED

    log_entry = AgentLog(
        level=LogLevel.INFO,
        event_type="agent_paused",
        message=f"User globally paused all automation ({len(campaigns)} campaigns paused).",
    )
    session.add(log_entry)
    session.commit()
    logger.info("User %s paused all automation (%d campaigns paused)", current_user.id, len(campaigns))

    return get_agent_status(session, current_user)


@router.post("/resume-all", response_model=AgentStatusResponse)
def resume_all_automation(session: DbSession, current_user: CurrentUser) -> AgentStatusResponse:
    """Resume all paused automation campaigns and actions (FR-7.1)."""
    sett = session.scalar(select(UserSettings).where(UserSettings.user_id == current_user.id))
    if sett is None:
        sett = UserSettings(user_id=current_user.id, is_globally_paused=False)
        session.add(sett)
    else:
        sett.is_globally_paused = False

    campaigns = session.scalars(
        select(Campaign).where(
            Campaign.owner_id == current_user.id,
            Campaign.status == CampaignStatus.PAUSED,
        )
    ).all()
    for camp in campaigns:
        camp.status = CampaignStatus.RUNNING

    log_entry = AgentLog(
        level=LogLevel.INFO,
        event_type="agent_resumed",
        message=f"User resumed all automation ({len(campaigns)} campaigns running).",
    )
    session.add(log_entry)
    session.commit()
    logger.info("User %s resumed all automation (%d campaigns running)", current_user.id, len(campaigns))

    return get_agent_status(session, current_user)


@router.get("/queue", response_model=AgentQueueResponse)
def get_agent_queue(session: DbSession, current_user: CurrentUser) -> AgentQueueResponse:
    """Retrieve scheduled action queue for execution by Chrome extension runner (FR-8.2)."""
    from app.services.quota_service import QuotaService
    can_run, reason = QuotaService.can_run_automated_actions(session, current_user)
    if not can_run:
        return AgentQueueResponse(items=[], total=0, within_working_hours=False)
    user_campaign_ids = select(Campaign.id).where(Campaign.owner_id == current_user.id)

    tasks = session.scalars(
        select(ScheduledTask)
        .where(
            ScheduledTask.campaign_id.in_(user_campaign_ids),
            ScheduledTask.status.in_([ScheduledTaskStatus.SCHEDULED, ScheduledTaskStatus.RUNNING]),
        )
        .order_by(ScheduledTask.scheduled_at)
        .limit(50)
    ).all()

    items: list[AgentQueueItem] = []
    for t in tasks:
        person = session.get(Person, t.person_id) if t.person_id else None
        target_name = person.full_name if person else None
        target_url = person.profile_url if person else (t.payload.get("profile_url") if t.payload else None)
        target_headline = person.headline if person else None

        msg = None
        if t.payload:
            msg = t.payload.get("note") or t.payload.get("comment_text") or t.payload.get("message")

        task_action_type = t.task_type.value
        if t.payload and t.payload.get("action_type"):
            task_action_type = str(t.payload.get("action_type"))

        items.append(
            AgentQueueItem(
                task_id=t.id,
                campaign_id=t.campaign_id,
                task_type=task_action_type,
                status=t.status.value,
                scheduled_at=t.scheduled_at,
                target_name=target_name,
                target_url=target_url,
                target_headline=target_headline,
                message=msg,
                payload=t.payload,
            )
        )

    # Working hours check
    within_working_hours = True
    sett = session.scalar(select(UserSettings).where(UserSettings.user_id == current_user.id))
    if sett and sett.is_globally_paused:
        within_working_hours = False

    return AgentQueueResponse(items=items, total=len(items), within_working_hours=within_working_hours)


@router.post("/queue/{task_id}/report", response_model=MessageResponse)
def report_task_execution(
    session: DbSession,
    task_id: int,
    payload: AgentQueueReportRequest,
    current_user: CurrentUser,
) -> MessageResponse:
    """Report execution result from Chrome extension runner and advance workflow (FR-8.2, FR-8.3)."""
    task = session.get(ScheduledTask, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Scheduled task not found.")

    campaign = session.get(Campaign, task.campaign_id)
    if campaign is None or campaign.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to report for this task.")

    now = datetime.now(UTC)
    task.executed_at = now

    if payload.success:
        task.status = ScheduledTaskStatus.COMPLETED
        task.result = payload.result_data or {"reported_by": "chrome_extension", "timestamp": now.isoformat()}
        task.error_code = None
        task.error_message = None

        # Update daily usage counters
        today = now.date()
        usage = session.scalar(
            select(DailyUsage).where(
                DailyUsage.campaign_id == task.campaign_id,
                DailyUsage.usage_date == today,
            )
        )
        if usage is None:
            usage = DailyUsage(
                campaign_id=task.campaign_id,
                usage_date=today,
                likes_sent=0,
                comments_sent=0,
                connections_sent=0,
            )
            session.add(usage)

        action_type = task.task_type.value
        if task.payload and task.payload.get("action_type"):
            action_type = str(task.payload.get("action_type")).upper()

        if "LIKE" in action_type:
            usage.likes_sent = (usage.likes_sent or 0) + 1
        elif "COMMENT" in action_type:
            usage.comments_sent = (usage.comments_sent or 0) + 1
        elif "CONNECT" in action_type:
            usage.connections_sent = (usage.connections_sent or 0) + 1

        log_entry = AgentLog(
            level=LogLevel.INFO,
            event_type="extension_action_executed",
            message=f"Extension successfully executed {task.task_type.value} for task #{task.id}.",
            campaign_id=task.campaign_id,
            person_id=task.person_id,
        )
        session.add(log_entry)

        # Advance workflow if workflow_id is linked
        if task.workflow_id:
            dispatch_workflow_advance(task.workflow_id)

    else:
        task.status = ScheduledTaskStatus.FAILED
        task.error_code = payload.error_code or "EXTENSION_EXECUTION_FAILED"
        task.error_message = payload.error_message or "Action execution failed in browser session."

        log_entry = AgentLog(
            level=LogLevel.ERROR,
            event_type="extension_action_failed",
            message=f"Extension action failed for task #{task.id}: {task.error_message}",
            campaign_id=task.campaign_id,
            person_id=task.person_id,
        )
        session.add(log_entry)

    session.commit()
    return MessageResponse(
        message="Execution report recorded.",
        detail=f"Task #{task.id} updated to {task.status.value}.",
    )


def _extract_target_criteria(
    session: DbSession,
    current_user_id: int,
    audience_id: int | None = None,
) -> tuple[str | None, list[str], list[str], list[str]]:
    """Extract dynamic target titles, industries, and locations from user's audience or campaign."""
    audience = None
    if audience_id:
        audience = session.get(Audience, audience_id)
    if audience is None:
        audience = session.scalar(
            select(Audience).where(Audience.owner_id == current_user_id).order_by(Audience.id.desc())
        )

    target_titles: list[str] = []
    target_industries: list[str] = []
    target_locations: list[str] = []
    audience_name: str | None = None

    if audience is not None:
        audience_name = audience.name
        filters = audience.filters_json or {}
        for key in ("job_titles", "titles", "roles", "seniority"):
            vals = filters.get(key)
            if isinstance(vals, list):
                target_titles.extend(str(v).lower() for v in vals)
            elif isinstance(vals, str) and vals:
                target_titles.append(vals.lower())

        for key in ("industries", "sectors", "keywords"):
            vals = filters.get(key)
            if isinstance(vals, list):
                target_industries.extend(str(v).lower() for v in vals)
            elif isinstance(vals, str) and vals:
                target_industries.append(vals.lower())

        for key in ("locations", "geos"):
            vals = filters.get(key)
            if isinstance(vals, list):
                target_locations.extend(str(v).lower() for v in vals)
            elif isinstance(vals, str) and vals:
                target_locations.append(vals.lower())

    # Derive from active campaign if audience has no specific filters
    if not target_titles and not target_industries:
        campaign = session.scalar(
            select(Campaign)
            .where(Campaign.owner_id == current_user_id)
            .order_by(Campaign.id.desc())
        )
        if campaign and campaign.instruction:
            instruction_lower = campaign.instruction.lower()
            tokens = [w.strip() for w in re.split(r"[\s,;]+", instruction_lower) if len(w.strip()) > 2]
            for word in tokens:
                if word in ("founder", "founders", "ceo", "cto", "cmo", "vp", "director", "lead", "head", "manager", "engineer"):
                    target_titles.append(word.rstrip("s"))
                elif word in ("saas", "b2b", "ai", "tech", "software", "healthcare", "fintech", "sales", "crypto"):
                    target_industries.append(word)

    return audience_name, target_titles, target_industries, target_locations


@router.post("/evaluate-profile", response_model=AgentProfileEvaluationResponse)
def evaluate_profile(
    session: DbSession,
    payload: AgentProfileEvaluationRequest,
    current_user: CurrentUser,
) -> AgentProfileEvaluationResponse:
    """Evaluate candidate profile from LinkedIn DOM against dynamic audience criteria (FR-8.6)."""
    # Check if person already exists and is in campaign
    already_in_campaign = False
    person = session.scalar(
        select(Person).where(Person.profile_url == payload.profile_url)
    )
    if person is not None:
        user_campaign_ids = select(Campaign.id).where(Campaign.owner_id == current_user.id)
        pc = session.scalar(
            select(PersonCampaign).where(
                PersonCampaign.person_id == person.id,
                PersonCampaign.campaign_id.in_(user_campaign_ids),
            )
        )
        if pc is not None:
            already_in_campaign = True

    # Dynamically extract criteria from user's active audience or campaign
    audience_name, target_titles, target_industries, target_locations = _extract_target_criteria(
        session, current_user.id, payload.audience_id
    )

    headline_raw = payload.headline or ""
    headline_lower = headline_raw.lower()
    score = 65
    criteria: list[str] = []

    # 1. Dynamic Title / Seniority Evaluation
    if target_titles:
        matched_title = next((t for t in target_titles if t in headline_lower), None)
        if matched_title:
            score += 20
            criteria.append(f"Seniority / Title match: {matched_title.capitalize()}")
        elif headline_lower:
            criteria.append("Role identified")
    else:
        # Detect role from candidate headline when no target audience filters are configured
        matched_candidate_titles = [
            t for t in ["founder", "ceo", "co-founder", "cto", "cmo", "vp", "head", "director", "lead", "engineer", "manager"]
            if t in headline_lower
        ]
        if matched_candidate_titles:
            score += 20
            criteria.append(f"Seniority / Title match: {matched_candidate_titles[0].capitalize()}")
        elif headline_lower:
            criteria.append("Role identified")

    def _format_sector(ind_name: str) -> str:
        special = {"saas": "SaaS", "b2b": "B2B", "ai": "AI", "api": "API"}
        return special.get(ind_name.lower(), ind_name.capitalize())

    # 2. Dynamic Industry / Domain Evaluation
    if target_industries:
        matched_ind = next((ind for ind in target_industries if ind in headline_lower), None)
        if matched_ind:
            score += 10
            criteria.append(f"Industry match: {_format_sector(matched_ind)}")
    else:
        # Detect domain from candidate headline when no audience filters are configured
        matched_candidate_inds = [
            ind for ind in ["saas", "b2b", "ai", "tech", "software", "cloud", "fintech", "healthtech", "security", "data"]
            if ind in headline_lower
        ]
        if matched_candidate_inds:
            score += 10
            criteria.append(f"{_format_sector(matched_candidate_inds[0])} sector")

    # 3. Dynamic Location Evaluation
    if payload.location:
        if target_locations:
            loc_matched = any(loc in payload.location.lower() for loc in target_locations)
            if loc_matched:
                score += 10
                criteria.append(f"Target location: {payload.location}")
            else:
                criteria.append(f"Location: {payload.location}")
        else:
            score += 5
            criteria.append(f"Location: {payload.location}")

    fit_score = min(max(score, 45), 98)

    if audience_name:
        rationale = f"Evaluated against '{audience_name}' criteria based on title, industry, and profile relevance."
    else:
        rationale = "Evaluated against active campaign criteria based on seniority and domain match."

    return AgentProfileEvaluationResponse(
        fit_score=fit_score,
        match_rationale=rationale,
        match_criteria=criteria,
        audience_name=audience_name or "Target Audience",
        already_in_campaign=already_in_campaign,
    )


@router.get("/popup-summary")
def get_popup_summary(session: DbSession, current_user: CurrentUser) -> dict[str, Any]:
    """Provide aggregated status, pending counts, and limits for Extension Popup (FR-8.4)."""
    status_resp = get_agent_status(session, current_user)

    user_campaign_ids = select(Campaign.id).where(Campaign.owner_id == current_user.id)

    pending_approvals = session.scalar(
        select(func.count(Approval.id)).where(
            Approval.campaign_id.in_(user_campaign_ids),
            Approval.status == ApprovalStatus.PENDING,
        )
    ) or 0

    pending_queue_count = session.scalar(
        select(func.count(ScheduledTask.id)).where(
            ScheduledTask.campaign_id.in_(user_campaign_ids),
            ScheduledTask.status == ScheduledTaskStatus.SCHEDULED,
        )
    ) or 0

    # Today's aggregated usage
    today = datetime.now(UTC).date()
    usages = session.scalars(
        select(DailyUsage).where(
            DailyUsage.campaign_id.in_(user_campaign_ids),
            DailyUsage.usage_date == today,
        )
    ).all()

    likes_used = sum(u.likes_sent for u in usages)
    comments_used = sum(u.comments_sent for u in usages)
    connections_used = sum(u.connections_sent for u in usages)

    # User configured safety limits from settings
    sett = session.scalar(select(UserSettings).where(UserSettings.user_id == current_user.id))
    likes_limit = sett.max_likes_per_day if sett and sett.max_likes_per_day is not None else 60
    comments_limit = sett.max_comments_per_day if sett and sett.max_comments_per_day is not None else 15
    connections_limit = sett.max_connections_per_day if sett and sett.max_connections_per_day is not None else 15

    # Real platform metrics from recorded actions
    accepted_count = session.scalar(
        select(func.count(Action.id)).where(
            Action.campaign_id.in_(user_campaign_ids),
            Action.action_type == ActionType.SEND_CONNECTION,
            Action.status.in_([ActionStatus.SUCCESS, ActionStatus.SKIPPED_DRY_RUN]),
        )
    ) or 0

    replies_count = session.scalar(
        select(func.count(Action.id)).where(
            Action.campaign_id.in_(user_campaign_ids),
            Action.action_type == ActionType.COMMENT_POST,
            Action.status.in_([ActionStatus.SUCCESS, ActionStatus.SKIPPED_DRY_RUN]),
        )
    ) or 0

    # Next few queue items
    next_tasks = session.scalars(
        select(ScheduledTask)
        .where(
            ScheduledTask.campaign_id.in_(user_campaign_ids),
            ScheduledTask.status == ScheduledTaskStatus.SCHEDULED,
        )
        .order_by(ScheduledTask.scheduled_at)
        .limit(4)
    ).all()

    recent_queue = []
    for t in next_tasks:
        person = session.get(Person, t.person_id) if t.person_id else None
        target_name = person.full_name if person else (t.payload.get("profile_name") if t.payload else "Prospect")
        company_name = person.company if person else (t.payload.get("company") if t.payload else "LinkedIn")
        recent_queue.append({
            "id": f"q-{t.id}",
            "action": t.task_type.value.capitalize(),
            "target": target_name,
            "company": company_name,
            "timeStr": t.scheduled_at.strftime("%H:%M UTC"),
        })

    return {
        "status": status_resp.model_dump(),
        "pending_approvals": pending_approvals,
        "pending_queue_count": pending_queue_count,
        "usage": {
            "likesUsed": likes_used,
            "likesLimit": likes_limit,
            "commentsUsed": comments_used,
            "commentsLimit": comments_limit,
            "connectionsUsed": connections_used,
            "connectionsLimit": connections_limit,
        },
        "stats": {
            "actions": likes_used + comments_used + connections_used,
            "accepted": accepted_count,
            "replies": replies_count,
        },
        "recent_queue": recent_queue,
    }


