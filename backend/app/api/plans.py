from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import DbSession
from app.schemas.plan import PlanRead
from app.services import plan_service

router = APIRouter(prefix="/plans", tags=["plans"])


@router.get("", response_model=list[PlanRead])
def get_plans(session: DbSession) -> list[PlanRead]:
    """Public: list all active published plans for user registration and pricing."""
    return plan_service.list_active_plans(session)
