from __future__ import annotations

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from app.api.deps import DbSession, OwnerScope, Pagination
from app.database.models import Post, PostEvaluation
from app.enums import PostProcessingStatus
from app.errors import NotFoundError
from app.schemas.common import Page
from app.schemas.engagement import PostDetail, PostEvaluationRead
from app.services import scoping

router = APIRouter(prefix="/posts", tags=["posts"])


@router.get("", response_model=Page[PostDetail])
def list_posts(
    session: DbSession,
    pagination: Pagination,
    owner_id: OwnerScope,
    campaign_id: int | None = Query(default=None),
    person_id: int | None = Query(default=None),
    processing_status: PostProcessingStatus | None = Query(default=None, alias="status"),
    eligible_only: bool = Query(default=False),
    min_score: int | None = Query(default=None, ge=0, le=100),
) -> Page[PostDetail]:
    stmt = scoping.restrict(select(Post), Post.campaign_id, owner_id)
    count_stmt = scoping.restrict(
        select(func.count()).select_from(Post), Post.campaign_id, owner_id
    )

    conditions = []
    if campaign_id is not None:
        conditions.append(Post.campaign_id == campaign_id)
    if person_id is not None:
        conditions.append(Post.person_id == person_id)
    if processing_status is not None:
        conditions.append(Post.processing_status == processing_status)
    if eligible_only:
        conditions.append(Post.is_eligible.is_(True))
    if min_score is not None:
        scored = select(PostEvaluation.post_id).where(
            PostEvaluation.relevance_score >= min_score
        )
        conditions.append(Post.id.in_(scored))

    for condition in conditions:
        stmt = stmt.where(condition)
        count_stmt = count_stmt.where(condition)

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


@router.get("/{post_id}", response_model=PostDetail)
def get_post(session: DbSession, post_id: int, owner_id: OwnerScope) -> PostDetail:
    post = session.scalar(
        scoping.restrict(select(Post).where(Post.id == post_id), Post.campaign_id, owner_id)
    )
    if post is None:
        raise NotFoundError(f"Post {post_id} not found.")
    return PostDetail.model_validate(post)


@router.get("/{post_id}/evaluations", response_model=list[PostEvaluationRead])
def list_post_evaluations(
    session: DbSession, post_id: int, owner_id: OwnerScope
) -> list[PostEvaluationRead]:
    get_post(session, post_id, owner_id)  # 404s before any evaluation is read
    evaluations = session.scalars(
        select(PostEvaluation)
        .where(PostEvaluation.post_id == post_id)
        .order_by(PostEvaluation.id.desc())
    )
    return [PostEvaluationRead.model_validate(item) for item in evaluations]
