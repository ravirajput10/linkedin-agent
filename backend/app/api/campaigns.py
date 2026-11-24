from __future__ import annotations

from fastapi import APIRouter, Query, status

from app.api.deps import CurrentUser, DbSession, OwnerScope, Pagination
from app.enums import CampaignStatus
from app.logging import get_logger
from app.schemas.campaign import (
    AnalyzeRequest,
    AnalyzeResponse,
    CampaignActionResponse,
    CampaignCreate,
    CampaignDetail,
    CampaignRead,
    CampaignSummary,
    CampaignUpdate,
    EnrollProspectPayload,
    ProspectReplyEvent,
)
from app.schemas.common import MessageResponse, Page
from app.schemas.observability import AnalyticsResponse
from app.services import campaign_service, dashboard_service
from app.services.dispatch import dispatch_campaign_run

logger = get_logger(__name__)
router = APIRouter(prefix="/campaigns", tags=["campaigns"])


@router.get("", response_model=Page[CampaignRead])
def list_campaigns(
    session: DbSession,
    pagination: Pagination,
    owner_id: OwnerScope,
    campaign_status: CampaignStatus | None = Query(default=None, alias="status"),
) -> Page[CampaignRead]:
    items, total = campaign_service.list_campaigns(
        session,
        status=campaign_status,
        owner_id=owner_id,
        offset=pagination.offset,
        limit=pagination.page_size,
    )
    return Page[CampaignRead](
        items=[CampaignRead.model_validate(item) for item in items],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.post("", response_model=CampaignRead, status_code=status.HTTP_201_CREATED)
def create_campaign(
    session: DbSession, payload: CampaignCreate, current_user: CurrentUser
) -> CampaignRead:
    campaign = campaign_service.create_campaign(session, payload, owner=current_user)
    return CampaignRead.model_validate(campaign)


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_new_campaign(
    session: DbSession, payload: AnalyzeRequest, current_user: CurrentUser
) -> AnalyzeResponse:
    """Parse a natural-language brief before the campaign exists."""
    return await campaign_service.analyze_instruction(session, payload.instruction)


@router.get("/{campaign_id}", response_model=CampaignDetail)
def get_campaign(
    session: DbSession, campaign_id: int, owner_id: OwnerScope
) -> CampaignDetail:
    campaign = campaign_service.get_campaign(session, campaign_id, owner_id=owner_id)
    detail = CampaignDetail.model_validate(
        {
            **CampaignRead.model_validate(campaign).model_dump(),
            "stats": campaign_service.campaign_stats(session, campaign_id),
        }
    )
    return detail


@router.put("/{campaign_id}", response_model=CampaignRead)
def update_campaign(
    session: DbSession, campaign_id: int, payload: CampaignUpdate, owner_id: OwnerScope
) -> CampaignRead:
    campaign = campaign_service.update_campaign(
        session, campaign_id, payload, owner_id=owner_id
    )
    return CampaignRead.model_validate(campaign)


@router.delete("/{campaign_id}", response_model=MessageResponse)
def delete_campaign(
    session: DbSession, campaign_id: int, owner_id: OwnerScope
) -> MessageResponse:
    campaign_service.delete_campaign(session, campaign_id, owner_id=owner_id)
    return MessageResponse(message=f"Campaign {campaign_id} deleted.")


@router.post("/{campaign_id}/analyze", response_model=AnalyzeResponse)
async def analyze_campaign(
    session: DbSession,
    campaign_id: int,
    owner_id: OwnerScope,
    payload: AnalyzeRequest | None = None,
) -> AnalyzeResponse:
    """Re-parse an existing campaign's instruction. Criteria are not overwritten."""
    campaign = campaign_service.get_campaign(session, campaign_id, owner_id=owner_id)
    instruction = payload.instruction if payload else campaign.instruction
    return await campaign_service.analyze_instruction(
        session, instruction, campaign_id=campaign_id
    )


@router.post("/{campaign_id}/start", response_model=CampaignActionResponse)
def start_campaign(
    session: DbSession, campaign_id: int, owner_id: OwnerScope
) -> CampaignActionResponse:
    campaign = campaign_service.start_campaign(session, campaign_id, owner_id=owner_id)
    session.commit()
    task_id = dispatch_campaign_run(campaign.id, trigger="manual")
    return CampaignActionResponse(
        campaign=CampaignSummary.model_validate(campaign),
        message="Campaign started.",
        task_id=task_id,
    )


@router.post("/{campaign_id}/pause", response_model=CampaignActionResponse)
def pause_campaign(
    session: DbSession, campaign_id: int, owner_id: OwnerScope
) -> CampaignActionResponse:
    campaign = campaign_service.pause_campaign(session, campaign_id, owner_id=owner_id)
    return CampaignActionResponse(
        campaign=CampaignSummary.model_validate(campaign),
        message="Campaign paused. In-flight workflows keep their state.",
    )


@router.post("/{campaign_id}/resume", response_model=CampaignActionResponse)
def resume_campaign(
    session: DbSession, campaign_id: int, owner_id: OwnerScope
) -> CampaignActionResponse:
    campaign = campaign_service.resume_campaign(session, campaign_id, owner_id=owner_id)
    session.commit()
    task_id = dispatch_campaign_run(campaign.id, trigger="resume")
    return CampaignActionResponse(
        campaign=CampaignSummary.model_validate(campaign),
        message="Campaign resumed.",
        task_id=task_id,
    )


@router.post("/{campaign_id}/stop", response_model=CampaignActionResponse)
def stop_campaign(
    session: DbSession, campaign_id: int, owner_id: OwnerScope
) -> CampaignActionResponse:
    campaign = campaign_service.stop_campaign(session, campaign_id, owner_id=owner_id)
    return CampaignActionResponse(
        campaign=CampaignSummary.model_validate(campaign),
        message="Campaign stopped and scheduled actions cancelled.",
    )


@router.post("/{campaign_id}/run", response_model=CampaignActionResponse)
def run_campaign_now(
    session: DbSession, campaign_id: int, owner_id: OwnerScope
) -> CampaignActionResponse:
    """Trigger one immediate agent run without waiting for the scheduler."""
    campaign = campaign_service.get_campaign(session, campaign_id, owner_id=owner_id)
    # The worker refuses this too, but failing here means the user is told now
    # rather than finding a dead run in the activity log later.
    campaign_service.require_owner_can_act(session, campaign)
    task_id = dispatch_campaign_run(campaign.id, trigger="manual")
    return CampaignActionResponse(
        campaign=CampaignSummary.model_validate(campaign),
        message="Agent run dispatched.",
        task_id=task_id,
    )


@router.post("/{campaign_id}/duplicate", response_model=CampaignRead)
def duplicate_campaign(
    session: DbSession, campaign_id: int, owner_id: OwnerScope
) -> CampaignRead:
    """FR-3.10: Duplicate campaign."""
    duplicated = campaign_service.duplicate_campaign(session, campaign_id, owner_id=owner_id)
    session.commit()
    return CampaignRead.model_validate(duplicated)


@router.post("/{campaign_id}/archive", response_model=CampaignRead)
def archive_campaign(
    session: DbSession, campaign_id: int, owner_id: OwnerScope
) -> CampaignRead:
    """FR-3.10: Toggle archive status on campaign."""
    archived = campaign_service.archive_campaign(session, campaign_id, owner_id=owner_id)
    session.commit()
    return CampaignRead.model_validate(archived)


@router.post("/{campaign_id}/prospects/{person_id}/skip", response_model=MessageResponse)
def skip_campaign_prospect(
    session: DbSession, campaign_id: int, person_id: int, owner_id: OwnerScope
) -> MessageResponse:
    """FR-3.12: Skip current prospect workflow step."""
    campaign_service.skip_prospect(session, campaign_id, person_id, owner_id=owner_id)
    session.commit()
    return MessageResponse(message=f"Prospect #{person_id} skipped in campaign #{campaign_id}.")


@router.delete("/{campaign_id}/prospects/{person_id}", response_model=MessageResponse)
def remove_campaign_prospect(
    session: DbSession, campaign_id: int, person_id: int, owner_id: OwnerScope
) -> MessageResponse:
    """FR-3.12: Remove prospect from campaign."""
    campaign_service.remove_prospect(session, campaign_id, person_id, owner_id=owner_id)
    session.commit()
    return MessageResponse(message=f"Prospect #{person_id} removed from campaign #{campaign_id}.")


@router.post("/{campaign_id}/events/reply-received", response_model=MessageResponse)
def prospect_reply_received(
    session: DbSession, campaign_id: int, payload: ProspectReplyEvent, owner_id: OwnerScope
) -> MessageResponse:
    """FR-3.6: Handle reply event to stop campaign sequence for prospect."""
    campaign_service.handle_prospect_reply(
        session, campaign_id, payload.person_id, owner_id=owner_id
    )
    session.commit()
    return MessageResponse(message=f"Prospect #{payload.person_id} marked as replied; sequence stopped.")


@router.post("/{campaign_id}/prospects", response_model=MessageResponse)
def add_campaign_prospect(
    session: DbSession,
    campaign_id: int,
    payload: EnrollProspectPayload,
    owner_id: OwnerScope,
) -> MessageResponse:
    """Manually enroll a prospect by LinkedIn URL into the campaign."""
    person = campaign_service.enroll_manual_prospect(
        session, campaign_id, payload, owner_id=owner_id
    )
    session.commit()
    return MessageResponse(
        message=f"Prospect '{person.full_name}' ({person.profile_url}) added to campaign #{campaign_id}."
    )


@router.get("/{campaign_id}/analytics", response_model=AnalyticsResponse)
def get_campaign_analytics(
    session: DbSession,
    campaign_id: int,
    owner_id: OwnerScope,
    days: int = Query(default=14, ge=1, le=90),
) -> AnalyticsResponse:
    """Retrieve per-campaign results and conversion analytics (FR-7.8)."""
    from app.services import scoping

    scoping.assert_owns_campaign(session, campaign_id, owner_id)
    return dashboard_service.analytics(
        session, campaign_id=campaign_id, days=days, owner_id=owner_id
    )


