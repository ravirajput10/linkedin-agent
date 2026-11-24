from __future__ import annotations

from fastapi import APIRouter, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import DbSession, OwnerScope, Pagination
from app.database.models import (
    CandidateEvaluation,
    Person,
    PersonCampaign,
    Post,
    Workflow,
)
from app.enums import WorkflowState
from app.errors import NotFoundError
from app.schemas.common import Page
from app.schemas.engagement import (
    CandidateDetail,
    CandidateEvaluationRead,
    CandidateRead,
    PersonSummary,
    PostDetail,
    WorkflowRead,
    WorkflowStepRead,
)
from app.services import scoping
from app.services.dashboard_service import STEP_LABELS

router = APIRouter(tags=["candidates"])


def _workflow_for(session: Session, campaign_id: int, person_id: int) -> Workflow | None:
    return session.scalar(
        select(Workflow).where(
            Workflow.campaign_id == campaign_id, Workflow.person_id == person_id
        )
    )


def _next_action(workflow: Workflow | None) -> str | None:
    if workflow is None:
        return None
    return STEP_LABELS.get(workflow.state, workflow.state.value)


def _to_candidate(session: Session, link: PersonCampaign) -> CandidateRead:
    workflow = _workflow_for(session, link.campaign_id, link.person_id)
    return CandidateRead(
        person=PersonSummary.model_validate(link.person),
        campaign_id=link.campaign_id,
        match_score=link.match_score,
        matched_criteria=link.matched_criteria or [],
        discovery_reason=link.discovery_reason,
        workflow=WorkflowRead.model_validate(workflow) if workflow else None,
        next_action=_next_action(workflow),
    )


@router.get("/campaigns/{campaign_id}/candidates", response_model=Page[CandidateRead])
def list_campaign_candidates(
    session: DbSession,
    campaign_id: int,
    pagination: Pagination,
    owner_id: OwnerScope,
    state: WorkflowState | None = Query(default=None),
    min_score: int | None = Query(default=None, ge=0, le=100),
) -> Page[CandidateRead]:
    scoping.assert_owns_campaign(session, campaign_id, owner_id)
    stmt = select(PersonCampaign).where(PersonCampaign.campaign_id == campaign_id)
    count_stmt = (
        select(func.count()).select_from(PersonCampaign).where(
            PersonCampaign.campaign_id == campaign_id
        )
    )

    if min_score is not None:
        stmt = stmt.where(PersonCampaign.match_score >= min_score)
        count_stmt = count_stmt.where(PersonCampaign.match_score >= min_score)

    if state is not None:
        workflow_ids = select(Workflow.person_id).where(
            Workflow.campaign_id == campaign_id, Workflow.state == state
        )
        stmt = stmt.where(PersonCampaign.person_id.in_(workflow_ids))
        count_stmt = count_stmt.where(PersonCampaign.person_id.in_(workflow_ids))

    total = session.scalar(count_stmt) or 0
    links = list(
        session.scalars(
            stmt.order_by(PersonCampaign.match_score.desc().nullslast())
            .offset(pagination.offset)
            .limit(pagination.page_size)
        )
    )
    return Page[CandidateRead](
        items=[_to_candidate(session, link) for link in links],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.get("/candidates", response_model=Page[CandidateRead])
def list_candidates(
    session: DbSession,
    pagination: Pagination,
    owner_id: OwnerScope,
    campaign_id: int | None = Query(default=None),
    search: str | None = Query(default=None, min_length=1, max_length=200),
) -> Page[CandidateRead]:
    stmt = select(PersonCampaign).join(Person, Person.id == PersonCampaign.person_id)
    count_stmt = (
        select(func.count())
        .select_from(PersonCampaign)
        .join(Person, Person.id == PersonCampaign.person_id)
    )
    stmt = scoping.restrict(stmt, PersonCampaign.campaign_id, owner_id)
    count_stmt = scoping.restrict(count_stmt, PersonCampaign.campaign_id, owner_id)

    if campaign_id is not None:
        stmt = stmt.where(PersonCampaign.campaign_id == campaign_id)
        count_stmt = count_stmt.where(PersonCampaign.campaign_id == campaign_id)
    if search:
        pattern = f"%{search}%"
        condition = Person.full_name.ilike(pattern) | Person.company.ilike(pattern)
        stmt = stmt.where(condition)
        count_stmt = count_stmt.where(condition)

    total = session.scalar(count_stmt) or 0
    links = list(
        session.scalars(
            stmt.order_by(PersonCampaign.created_at.desc())
            .offset(pagination.offset)
            .limit(pagination.page_size)
        )
    )
    return Page[CandidateRead](
        items=[_to_candidate(session, link) for link in links],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.get("/candidates/{person_id}", response_model=CandidateDetail)
def get_candidate(
    session: DbSession,
    person_id: int,
    owner_id: OwnerScope,
    campaign_id: int | None = Query(default=None),
) -> CandidateDetail:
    stmt = select(PersonCampaign).where(PersonCampaign.person_id == person_id)
    if campaign_id is not None:
        stmt = stmt.where(PersonCampaign.campaign_id == campaign_id)
    # A person can appear in several campaigns, including other people's.
    # Scoping here keeps the detail page to the viewer's own link.
    stmt = scoping.restrict(stmt, PersonCampaign.campaign_id, owner_id)
    link = session.scalar(stmt.order_by(PersonCampaign.created_at.desc()))
    if link is None:
        raise NotFoundError(f"Candidate {person_id} not found.")

    workflow = _workflow_for(session, link.campaign_id, person_id)
    evaluation = session.scalar(
        select(CandidateEvaluation)
        .where(
            CandidateEvaluation.campaign_id == link.campaign_id,
            CandidateEvaluation.person_id == person_id,
        )
        .order_by(CandidateEvaluation.id.desc())
    )
    posts = list(
        session.scalars(
            scoping.restrict(
                select(Post).where(Post.person_id == person_id), Post.campaign_id, owner_id
            )
            .order_by(Post.published_at.desc().nullslast())
            .limit(50)
        )
    )

    base = _to_candidate(session, link)
    return CandidateDetail(
        **base.model_dump(),
        evaluation=CandidateEvaluationRead.model_validate(evaluation) if evaluation else None,
        posts=[PostDetail.model_validate(post) for post in posts],
        timeline=[WorkflowStepRead.model_validate(step) for step in (workflow.steps if workflow else [])],
    )


@router.get("/candidates/{person_id}/posts", response_model=Page[PostDetail])
def list_candidate_posts(
    session: DbSession,
    person_id: int,
    pagination: Pagination,
    owner_id: OwnerScope,
    eligible_only: bool = Query(default=False),
) -> Page[PostDetail]:
    stmt = scoping.restrict(
        select(Post).where(Post.person_id == person_id), Post.campaign_id, owner_id
    )
    count_stmt = scoping.restrict(
        select(func.count()).select_from(Post).where(Post.person_id == person_id),
        Post.campaign_id,
        owner_id,
    )
    if eligible_only:
        stmt = stmt.where(Post.is_eligible.is_(True))
        count_stmt = count_stmt.where(Post.is_eligible.is_(True))

    total = session.scalar(count_stmt) or 0
    posts = list(
        session.scalars(
            stmt.order_by(Post.published_at.desc().nullslast())
            .offset(pagination.offset)
            .limit(pagination.page_size)
        )
    )
    return Page[PostDetail](
        items=[PostDetail.model_validate(post) for post in posts],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )
