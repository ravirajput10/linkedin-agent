from __future__ import annotations

from fastapi import APIRouter, Query, status

from app.api.deps import CurrentUser, DbSession, OwnerScope
from app.schemas.content import (
    CalendarItem,
    ContentPillarCreate,
    ContentPillarRead,
    GenerateDraftsRequest,
    GenerateDraftsResponse,
    PostDraftItem,
    RegenerateDraftRequest,
    SchedulePostRequest,
    ShortenDraftRequest,
    SuggestIdeasResponse,
    UserPostRead,
)
from app.services import content_service

router = APIRouter(tags=["content-studio"])


# ----------------------------------------------------------- Content Pillars --


@router.get("/content-pillars", response_model=list[ContentPillarRead])
def list_content_pillars(
    session: DbSession,
    owner_id: OwnerScope,
) -> list[ContentPillarRead]:
    pillars = content_service.list_pillars(session, owner_id)
    return [ContentPillarRead.model_validate(p) for p in pillars]


@router.post(
    "/content-pillars",
    response_model=ContentPillarRead,
    status_code=status.HTTP_201_CREATED,
)
def create_content_pillar(
    session: DbSession,
    payload: ContentPillarCreate,
    current_user: CurrentUser,
) -> ContentPillarRead:
    pillar = content_service.create_pillar(session, payload, current_user.id)
    session.commit()
    return ContentPillarRead.model_validate(pillar)


@router.delete("/content-pillars/{pillar_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_content_pillar(
    session: DbSession,
    pillar_id: int,
    current_user: CurrentUser,
) -> None:
    content_service.delete_pillar(session, pillar_id, current_user.id)
    session.commit()


# ------------------------------------------------------------ Post Drafting ---


@router.post("/content-studio/generate-drafts", response_model=GenerateDraftsResponse)
async def generate_drafts(
    session: DbSession,
    payload: GenerateDraftsRequest,
    owner_id: OwnerScope,
) -> GenerateDraftsResponse:
    return await content_service.generate_drafts(session, payload, owner_id)


@router.post("/content-studio/shorten")
def shorten_draft(
    payload: ShortenDraftRequest,
) -> dict[str, str]:
    shortened = content_service.shorten_content(payload.content)
    return {"content": shortened}


@router.post("/content-studio/regenerate", response_model=PostDraftItem)
async def regenerate_draft(
    session: DbSession,
    payload: RegenerateDraftRequest,
    owner_id: OwnerScope,
) -> PostDraftItem:
    return await content_service.regenerate_single_draft(session, payload, owner_id)


@router.get("/content-studio/ideas", response_model=SuggestIdeasResponse)
def suggest_ideas(
    pillar: str | None = Query(default=None),
) -> SuggestIdeasResponse:
    ideas = content_service.suggest_ideas(pillar)
    return SuggestIdeasResponse(ideas=ideas)


# ---------------------------------------------------- Schedule & Calendar ---


@router.post(
    "/content-studio/posts",
    response_model=UserPostRead,
    status_code=status.HTTP_201_CREATED,
)
def schedule_post(
    session: DbSession,
    payload: SchedulePostRequest,
    current_user: CurrentUser,
) -> UserPostRead:
    post = content_service.schedule_post(session, payload, current_user.id)
    session.commit()
    return UserPostRead.model_validate(post)


@router.get("/content-studio/posts", response_model=list[UserPostRead])
def list_user_posts(
    session: DbSession,
    owner_id: OwnerScope,
) -> list[UserPostRead]:
    posts = content_service.list_user_posts(session, owner_id)
    return [UserPostRead.model_validate(p) for p in posts]


@router.get("/content-studio/calendar", response_model=list[CalendarItem])
def get_calendar(
    session: DbSession,
    owner_id: OwnerScope,
) -> list[CalendarItem]:
    return content_service.get_calendar(session, owner_id)


@router.post(
    "/content-studio/posts/{post_id}/approve",
    response_model=UserPostRead,
)
def approve_post(
    session: DbSession,
    post_id: int,
    current_user: CurrentUser,
) -> UserPostRead:
    post = content_service.approve_user_post(session, post_id, current_user.id)
    session.commit()
    return UserPostRead.model_validate(post)


@router.post(
    "/content-studio/posts/{post_id}/reject",
    response_model=UserPostRead,
)
def reject_post(
    session: DbSession,
    post_id: int,
    current_user: CurrentUser,
) -> UserPostRead:
    post = content_service.reject_user_post(session, post_id, current_user.id)
    session.commit()
    return UserPostRead.model_validate(post)


@router.delete(
    "/content-studio/posts/{post_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_post(
    session: DbSession,
    post_id: int,
    current_user: CurrentUser,
) -> None:
    content_service.delete_user_post(session, post_id, current_user.id)
    session.commit()
