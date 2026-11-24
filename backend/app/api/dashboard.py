from __future__ import annotations

from fastapi import APIRouter, Query

from app.api.deps import DbSession, OwnerScope
from app.schemas.observability import AnalyticsResponse, DashboardResponse
from app.services import dashboard_service, scoping

router = APIRouter(tags=["dashboard"])


@router.get("/dashboard", response_model=DashboardResponse)
def get_dashboard(session: DbSession, owner_id: OwnerScope) -> DashboardResponse:
    return dashboard_service.dashboard(session, owner_id=owner_id)


@router.get("/analytics", response_model=AnalyticsResponse)
def get_analytics(
    session: DbSession,
    owner_id: OwnerScope,
    campaign_id: int | None = Query(default=None),
    days: int = Query(default=14, ge=1, le=90),
) -> AnalyticsResponse:
    if campaign_id is not None:
        scoping.assert_owns_campaign(session, campaign_id, owner_id)
    return dashboard_service.analytics(
        session, campaign_id=campaign_id, days=days, owner_id=owner_id
    )
