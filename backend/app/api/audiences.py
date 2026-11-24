from __future__ import annotations

from fastapi import APIRouter, File, Form, UploadFile, status
from pydantic import BaseModel

from app.api.deps import CurrentUser, DbSession
from app.schemas.audience import (
    AudienceAssignCampaignRequest,
    AudienceCreate,
    AudienceDetail,
    AudienceExcludeRequest,
    AudienceRead,
    AudienceSearchRequest,
    AudienceSearchResponse,
    AudienceUpdate,
    CSVImportResponse,
    PromptParseRequest,
    PromptParseResponse,
)
from app.schemas.common import MessageResponse
from app.services import audience_service

router = APIRouter(prefix="/audiences", tags=["audiences"])


# ----------------------------------------------------------- FR-2.1 & FR-2.2 --


@router.post("/parse-prompt", response_model=PromptParseResponse)
async def parse_audience_prompt(
    session: DbSession,
    payload: PromptParseRequest,
    current_user: CurrentUser,
) -> PromptParseResponse:
    """Parses a free-text prompt describing an audience into structured filter chips."""
    return await audience_service.parse_audience_prompt(session, payload.prompt)


# --------------------------------------------------- FR-2.4, 2.5, 2.6 & 2.11 --


@router.post("/search", response_model=AudienceSearchResponse)
async def search_audience(
    session: DbSession,
    payload: AudienceSearchRequest,
    current_user: CurrentUser,
) -> AudienceSearchResponse:
    """Searches LinkedIn for matching profiles with fit scoring, rate limiting, and exclusions."""
    return await audience_service.search_audience(session, current_user, payload)


# ------------------------------------------------------------- CRUD (FR-2.8) --


@router.get("", response_model=list[AudienceRead])
def list_audiences(
    session: DbSession,
    current_user: CurrentUser,
) -> list[AudienceRead]:
    """Lists all saved audiences for the current user."""
    return audience_service.list_audiences(session, current_user.id)


@router.post("", response_model=AudienceRead, status_code=status.HTTP_201_CREATED)
def create_audience(
    session: DbSession,
    payload: AudienceCreate,
    current_user: CurrentUser,
) -> AudienceRead:
    """Creates a new saved audience."""
    return audience_service.create_audience(session, current_user.id, payload)


@router.get("/{audience_id}", response_model=AudienceDetail)
def get_audience(
    session: DbSession,
    audience_id: int,
    current_user: CurrentUser,
) -> AudienceDetail:
    """Returns details and member candidates for a saved audience."""
    return audience_service.get_audience_detail(session, audience_id, current_user.id)


@router.put("/{audience_id}", response_model=AudienceRead)
def update_audience(
    session: DbSession,
    audience_id: int,
    payload: AudienceUpdate,
    current_user: CurrentUser,
) -> AudienceRead:
    """Updates audience name, prompt, filters, or refresh schedule."""
    return audience_service.update_audience(session, audience_id, current_user.id, payload)


@router.post("/{audience_id}/duplicate", response_model=AudienceRead)
def duplicate_audience(
    session: DbSession,
    audience_id: int,
    current_user: CurrentUser,
) -> AudienceRead:
    """Duplicates an audience and its members."""
    return audience_service.duplicate_audience(session, audience_id, current_user.id)


@router.post("/{audience_id}/archive", response_model=AudienceRead)
def archive_audience(
    session: DbSession,
    audience_id: int,
    current_user: CurrentUser,
) -> AudienceRead:
    """Toggles archived status of an audience."""
    return audience_service.archive_audience(session, audience_id, current_user.id)


@router.delete("/{audience_id}", response_model=MessageResponse)
def delete_audience(
    session: DbSession,
    audience_id: int,
    current_user: CurrentUser,
) -> MessageResponse:
    """Deletes an audience and removes its membership links."""
    audience_service.delete_audience(session, audience_id, current_user.id)
    return MessageResponse(message=f"Audience {audience_id} deleted.")


# ---------------------------------------------------- Refresh (FR-2.9) -------


@router.post("/{audience_id}/refresh", response_model=AudienceDetail)
async def refresh_audience(
    session: DbSession,
    audience_id: int,
    current_user: CurrentUser,
) -> AudienceDetail:
    """Refreshes audience with live LinkedIn search."""
    return await audience_service.refresh_audience(session, audience_id, current_user)


# ---------------------------------------- Batch Exclude & Campaign (FR-2.7) --


@router.post("/{audience_id}/assign-campaign", response_model=MessageResponse)
def assign_to_campaign(
    session: DbSession,
    audience_id: int,
    payload: AudienceAssignCampaignRequest,
    current_user: CurrentUser,
) -> MessageResponse:
    """Assigns selected audience candidates into a campaign."""
    count = audience_service.assign_audience_to_campaign(
        session,
        audience_id=audience_id,
        owner_id=current_user.id,
        campaign_id=payload.campaign_id,
        person_ids=payload.person_ids,
    )
    return MessageResponse(message=f"Assigned {count} candidate(s) to campaign {payload.campaign_id}.")


@router.post("/{audience_id}/exclude", response_model=MessageResponse)
def exclude_candidates(
    session: DbSession,
    audience_id: int,
    payload: AudienceExcludeRequest,
    current_user: CurrentUser,
) -> MessageResponse:
    """Permanently excludes candidates from this audience."""
    count = audience_service.exclude_audience_candidates(
        session,
        audience_id=audience_id,
        owner_id=current_user.id,
        person_ids=payload.person_ids,
        reason=payload.reason,
    )
    return MessageResponse(message=f"Excluded {count} candidate(s) from audience.")


# ---------------------------------------------------- CSV Import (FR-2.10) ---


class CSVImportPayload(BaseModel):
    csv_text: str
    audience_id: int | None = None


@router.post("/import-csv", response_model=CSVImportResponse)
async def import_csv_profiles(
    session: DbSession,
    current_user: CurrentUser,
    payload: CSVImportPayload | None = None,
    file: UploadFile | None = File(default=None),
    audience_id: int | None = Form(default=None),
) -> CSVImportResponse:
    """Imports LinkedIn profiles from CSV file or text."""
    csv_content = ""
    target_audience_id = audience_id
    if file:
        raw_bytes = await file.read()
        csv_content = raw_bytes.decode("utf-8", errors="ignore")
    elif payload:
        csv_content = payload.csv_text
        target_audience_id = payload.audience_id or target_audience_id

    return audience_service.import_csv_profiles(
        session,
        user=current_user,
        csv_text=csv_content,
        audience_id=target_audience_id,
    )
