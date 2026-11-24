from __future__ import annotations

from fastapi import APIRouter, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, DbSession, OwnerScope, Pagination
from app.database.models import Approval, Campaign, Person, Post, PostEvaluation
from app.enums import ApprovalStatus, ApprovalType
from app.schemas.common import Page
from app.schemas.engagement import (
    ApprovalDecision,
    ApprovalDetail,
    ApprovalRead,
    BulkApproveRequest,
    BulkApproveResponse,
    ExpireStaleRequest,
    ExpireStaleResponse,
    PersonSummary,
    PostEvaluationRead,
    PostRead,
    RegenerateRequest,
)
from app.services import approval_service
from app.services.dispatch import dispatch_workflow_advance

router = APIRouter(prefix="/approvals", tags=["approvals"])


def _to_detail(session: Session, approval: Approval) -> ApprovalDetail:
    person = session.get(Person, approval.person_id)
    campaign = session.get(Campaign, approval.campaign_id)
    post = session.get(Post, approval.post_id) if approval.post_id else None
    evaluation = (
        session.scalar(
            select(PostEvaluation)
            .where(PostEvaluation.post_id == post.id)
            .order_by(PostEvaluation.id.desc())
        )
        if post
        else None
    )

    return ApprovalDetail(
        **ApprovalRead.model_validate(approval).model_dump(),
        person=PersonSummary.model_validate(person),
        campaign_name=campaign.name if campaign else "",
        post=PostRead.model_validate(post) if post else None,
        post_evaluation=PostEvaluationRead.model_validate(evaluation) if evaluation else None,
    )


@router.get("", response_model=Page[ApprovalDetail])
def list_approvals(
    session: DbSession,
    pagination: Pagination,
    owner_id: OwnerScope,
    approval_type: ApprovalType | None = Query(default=None, alias="type"),
    approval_status: ApprovalStatus | None = Query(default=ApprovalStatus.PENDING, alias="status"),
    campaign_id: int | None = Query(default=None),
) -> Page[ApprovalDetail]:
    items, total = approval_service.list_approvals(
        session,
        approval_type=approval_type,
        status=approval_status,
        campaign_id=campaign_id,
        owner_id=owner_id,
        offset=pagination.offset,
        limit=pagination.page_size,
    )
    return Page[ApprovalDetail](
        items=[_to_detail(session, item) for item in items],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.get("/counts", response_model=dict[str, int])
def approval_counts(session: DbSession, owner_id: OwnerScope) -> dict[str, int]:
    counts = approval_service.counts_by_type(session, owner_id=owner_id)
    return {approval_type.value: counts.get(approval_type.value, 0) for approval_type in ApprovalType}


@router.post("/bulk-approve", response_model=BulkApproveResponse)
def bulk_approve(
    session: DbSession,
    current_user: CurrentUser,
    owner_id: OwnerScope,
    payload: BulkApproveRequest | None = None,
) -> BulkApproveResponse:
    """FR-6.7: Bulk approve pending approvals by type or ids."""
    approvals = approval_service.bulk_approve(
        session,
        approval_type=payload.approval_type if payload else None,
        approval_ids=payload.approval_ids if payload else None,
        decided_by=current_user.email,
        owner_id=owner_id,
    )
    workflow_ids = [a.workflow_id for a in approvals if a.workflow_id]
    session.commit()

    for wf_id in workflow_ids:
        dispatch_workflow_advance(wf_id)

    return BulkApproveResponse(
        approved_count=len(approvals),
        items=[a.id for a in approvals],
    )


@router.post("/expire-stale", response_model=ExpireStaleResponse)
def expire_stale(
    session: DbSession,
    owner_id: OwnerScope,
    payload: ExpireStaleRequest | None = None,
) -> ExpireStaleResponse:
    """FR-6.9: Expire pending approvals older than N hours (default 48h)."""
    older_than = payload.older_than_hours if payload else 48
    expired = approval_service.expire_stale_approvals(
        session,
        older_than_hours=older_than,
        owner_id=owner_id,
    )
    session.commit()
    return ExpireStaleResponse(
        expired_count=len(expired),
        items=[a.id for a in expired],
    )


@router.get("/{approval_id}", response_model=ApprovalDetail)
def get_approval(
    session: DbSession, approval_id: int, owner_id: OwnerScope
) -> ApprovalDetail:
    return _to_detail(
        session, approval_service.get_approval(session, approval_id, owner_id=owner_id)
    )


@router.post("/{approval_id}/approve", response_model=ApprovalDetail)
def approve(
    session: DbSession,
    approval_id: int,
    current_user: CurrentUser,
    owner_id: OwnerScope,
    payload: ApprovalDecision | None = None,
) -> ApprovalDetail:
    approval = approval_service.approve(
        session,
        approval_id,
        edited_content=payload.edited_content if payload else None,
        note=payload.note if payload else None,
        decided_by=current_user.email,
        owner_id=owner_id,
    )
    detail = _to_detail(session, approval)
    session.commit()

    if approval.workflow_id:
        dispatch_workflow_advance(approval.workflow_id)
    return detail


@router.post("/{approval_id}/reject", response_model=ApprovalDetail)
def reject(
    session: DbSession,
    approval_id: int,
    current_user: CurrentUser,
    owner_id: OwnerScope,
    payload: ApprovalDecision | None = None,
) -> ApprovalDetail:
    approval = approval_service.reject(
        session,
        approval_id,
        note=payload.note if payload else None,
        decided_by=current_user.email,
        owner_id=owner_id,
    )
    detail = _to_detail(session, approval)
    session.commit()

    if approval.workflow_id:
        dispatch_workflow_advance(approval.workflow_id)
    return detail


@router.post("/{approval_id}/skip-person", response_model=ApprovalDetail)
def skip_person(
    session: DbSession,
    approval_id: int,
    current_user: CurrentUser,
    owner_id: OwnerScope,
    payload: ApprovalDecision | None = None,
) -> ApprovalDetail:
    """FR-6.6: Skip this person from campaign and reject pending approval."""
    approval = approval_service.skip_person(
        session,
        approval_id,
        note=payload.note if payload else None,
        decided_by=current_user.email,
        owner_id=owner_id,
    )
    detail = _to_detail(session, approval)
    session.commit()

    if approval.workflow_id:
        dispatch_workflow_advance(approval.workflow_id)
    return detail


@router.post("/{approval_id}/regenerate", response_model=ApprovalDetail)
async def regenerate(
    session: DbSession,
    approval_id: int,
    owner_id: OwnerScope,
    payload: RegenerateRequest | None = None,
) -> ApprovalDetail:
    approval = await approval_service.regenerate(
        session,
        approval_id,
        feedback=payload.feedback if payload else None,
        owner_id=owner_id,
    )
    return _to_detail(session, approval)
