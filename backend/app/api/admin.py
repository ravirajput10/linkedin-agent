"""Administrator endpoints: who is on the system, and switching them on or off.

Every route here requires ``role == ADMIN``; the dependency is declared on the
router so a new route cannot be added without it.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import AdminUser, DbSession, Pagination, get_current_admin
from app.enums import CampaignStatus, UserRole, UserStatus
from app.schemas.auth import (
    AdminPasswordReset,
    AdminStats,
    AdminUserCreate,
    AdminUserRead,
    AdminUserUpdate,
    DeactivateRequest,
    UserSettingsRead,
)
from app.schemas.campaign import CampaignRead
from app.schemas.common import MessageResponse, Page
from app.schemas.plan import (
    PlanAdminRead,
    PlanCreate,
    PlanRead,
    PlanReorderPayload,
    PlanUpdate,
    UserPlanUpdate,
)
from app.services import auth_service, campaign_service, plan_service, user_service

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(get_current_admin)],
)


@router.get("/stats", response_model=AdminStats)
def admin_stats(session: DbSession) -> AdminStats:
    return user_service.stats(session)


@router.get("/users", response_model=Page[AdminUserRead])
def list_users(
    session: DbSession,
    pagination: Pagination,
    search: str | None = Query(default=None, min_length=1, max_length=200),
    role: UserRole | None = Query(default=None),
    user_status: UserStatus | None = Query(default=None, alias="status"),
    is_active: bool | None = Query(default=None),
) -> Page[AdminUserRead]:
    users, total = user_service.list_users(
        session,
        search=search,
        role=role,
        status=user_status,
        is_active=is_active,
        offset=pagination.offset,
        limit=pagination.page_size,
    )
    return Page[AdminUserRead](
        items=user_service.to_admin_read(session, users),
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.post("/users", response_model=AdminUserRead, status_code=status.HTTP_201_CREATED)
def create_user(session: DbSession, payload: AdminUserCreate, admin: AdminUser) -> AdminUserRead:
    user, _ = auth_service.create_user(
        session,
        email=payload.email,
        password=payload.password,
        full_name=payload.full_name,
        role=payload.role,
        is_active=payload.is_active,
        email_verified=payload.email_verified,
    )
    result = user_service.to_admin_read(session, [user])[0]
    session.commit()
    return result


@router.get("/users/{user_id}", response_model=AdminUserRead)
def get_user(session: DbSession, user_id: int) -> AdminUserRead:
    user = auth_service.get_user(session, user_id)
    return user_service.to_admin_read(session, [user])[0]


@router.put("/users/{user_id}", response_model=AdminUserRead)
def update_user(
    session: DbSession, user_id: int, payload: AdminUserUpdate, admin: AdminUser
) -> AdminUserRead:
    user = auth_service.get_user(session, user_id)
    user_service.update_user(session, user, payload, actor=admin)
    result = user_service.to_admin_read(session, [user])[0]
    session.commit()
    return result


@router.post("/users/{user_id}/activate", response_model=AdminUserRead)
def activate_user(session: DbSession, user_id: int, admin: AdminUser) -> AdminUserRead:
    user = auth_service.get_user(session, user_id)
    user_service.set_active(session, user, active=True, actor=admin)
    result = user_service.to_admin_read(session, [user])[0]
    session.commit()
    return result


@router.post("/users/{user_id}/deactivate", response_model=AdminUserRead)
def deactivate_user(
    session: DbSession,
    user_id: int,
    admin: AdminUser,
    payload: DeactivateRequest | None = None,
) -> AdminUserRead:
    """Deactivating ends the user's live sessions as well as blocking new ones."""
    user = auth_service.get_user(session, user_id)
    user_service.set_active(
        session,
        user,
        active=False,
        actor=admin,
        reason=payload.reason if payload else None,
    )
    result = user_service.to_admin_read(session, [user])[0]
    session.commit()
    return result


@router.post("/users/{user_id}/reset-password", response_model=MessageResponse)
def reset_password(
    session: DbSession, user_id: int, payload: AdminPasswordReset, admin: AdminUser
) -> MessageResponse:
    user = auth_service.get_user(session, user_id)
    revoked = user_service.reset_password(session, user, payload.new_password, actor=admin)
    session.commit()
    return MessageResponse(
        message=f"Password reset for {user.email}.",
        detail=f"{revoked} active session(s) were ended.",
    )


@router.delete("/users/{user_id}", response_model=MessageResponse)
def delete_user(session: DbSession, user_id: int, admin: AdminUser) -> MessageResponse:
    user = auth_service.get_user(session, user_id)
    email = user.email
    user_service.delete_user(session, user, actor=admin)
    session.commit()
    return MessageResponse(
        message=f"{email} deleted.",
        detail="Their campaigns were kept and are now unowned.",
    )


@router.get("/users/{user_id}/settings", response_model=UserSettingsRead)
def get_user_settings(session: DbSession, user_id: int) -> UserSettingsRead:
    user = auth_service.get_user(session, user_id)
    user_settings = auth_service.ensure_settings(session, user)
    result = UserSettingsRead.model_validate(user_settings)
    session.commit()
    return result


@router.get("/users/{user_id}/campaigns", response_model=Page[CampaignRead])
def list_user_campaigns(
    session: DbSession,
    user_id: int,
    pagination: Pagination,
    campaign_status: CampaignStatus | None = Query(default=None, alias="status"),
) -> Page[CampaignRead]:
    """Read-only inspection of one user's campaigns, for support questions."""
    auth_service.get_user(session, user_id)
    items, total = campaign_service.list_campaigns(
        session,
        status=campaign_status,
        owner_id=user_id,
        offset=pagination.offset,
        limit=pagination.page_size,
    )
    return Page[CampaignRead](
        items=[CampaignRead.model_validate(item) for item in items],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


# ------------------------------------------------------------------ plans ---


@router.get("/plans", response_model=list[PlanAdminRead])
def list_admin_plans(session: DbSession) -> list[PlanAdminRead]:
    """Admin: lists all plans with current subscriber counts."""
    rows = plan_service.list_all_plans_with_counts(session)
    results = []
    for item in rows:
        plan_dict = PlanRead.model_validate(item["plan"]).model_dump()
        plan_dict["subscriber_count"] = item["subscriber_count"]
        results.append(PlanAdminRead(**plan_dict))
    return results


@router.post("/plans", response_model=PlanRead, status_code=status.HTTP_201_CREATED)
def create_plan(session: DbSession, payload: PlanCreate) -> PlanRead:
    """Admin: creates a new SaaS tier plan."""
    plan = plan_service.create_plan(session, payload)
    session.commit()
    return PlanRead.model_validate(plan)


@router.get("/plans/{plan_id}", response_model=PlanRead)
def get_plan(session: DbSession, plan_id: str) -> PlanRead:
    plan = plan_service.get_plan(session, plan_id)
    return PlanRead.model_validate(plan)


@router.put("/plans/{plan_id}", response_model=PlanRead)
def update_plan(session: DbSession, plan_id: str, payload: PlanUpdate) -> PlanRead:
    """Admin: updates plan details, pricing, quotas or features."""
    plan = plan_service.update_plan(session, plan_id, payload)
    session.commit()
    return PlanRead.model_validate(plan)


@router.patch("/plans/{plan_id}/toggle-active", response_model=PlanRead)
def toggle_plan_active(session: DbSession, plan_id: str) -> PlanRead:
    """Admin: quick toggle active/inactive status."""
    plan = plan_service.toggle_active(session, plan_id)
    session.commit()
    return PlanRead.model_validate(plan)


@router.delete("/plans/{plan_id}", response_model=MessageResponse)
def delete_plan(session: DbSession, plan_id: str) -> MessageResponse:
    """Admin: deletes a plan if no users are currently assigned to it."""
    plan_service.delete_plan(session, plan_id)
    session.commit()
    return MessageResponse(message=f"Plan '{plan_id}' deleted successfully.")


@router.post("/plans/reorder", response_model=list[PlanAdminRead])
def reorder_plans(session: DbSession, payload: PlanReorderPayload) -> list[PlanAdminRead]:
    """Admin: updates the display order of plans sequentially."""
    rows = plan_service.reorder_plans(session, payload.plan_ids)
    session.commit()
    results = []
    for item in rows:
        plan_dict = PlanRead.model_validate(item["plan"]).model_dump()
        plan_dict["subscriber_count"] = item["subscriber_count"]
        results.append(PlanAdminRead(**plan_dict))
    return results


@router.patch("/users/{user_id}/plan", response_model=AdminUserRead)
def assign_user_plan(
    session: DbSession, user_id: int, payload: UserPlanUpdate
) -> AdminUserRead:
    """Admin: manually assigns a plan and billing cycle to a user."""
    user = plan_service.assign_user_plan(
        session, user_id, plan_id=payload.plan_id, billing_cycle=payload.billing_cycle
    )
    session.commit()
    read_list = user_service.to_admin_read(session, [user])
    return read_list[0]

