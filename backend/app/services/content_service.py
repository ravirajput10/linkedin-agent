from __future__ import annotations

from datetime import UTC, datetime, timedelta
import random
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.agents.post_generator import PostGeneratorAgent
from app.database.models.content import ContentPillar, UserPost
from app.errors import NotFoundError
from app.logging import get_logger
from app.schemas.content import (
    CalendarItem,
    ContentPillarCreate,
    GenerateDraftsRequest,
    GenerateDraftsResponse,
    PostDraftItem,
    RegenerateDraftRequest,
    SchedulePostRequest,
    ShortenDraftRequest,
    SuggestIdeasResponse,
    UserPostRead,
)

logger = get_logger(__name__)

DEFAULT_PILLARS = [
    {"name": "Building with AI", "target_cadence": "2 / week", "description": "Technical insights on deploying agents & LLMs"},
    {"name": "Hiring & teams", "target_cadence": "1 / week", "description": "Culture, hiring bar, and engineering leadership"},
    {"name": "Founder lessons", "target_cadence": "2 / month", "description": "Startup trade-offs, sales lessons, and execution"},
]


# ----------------------------------------------------------- Content Pillars --


def ensure_default_pillars(session: Session, owner_id: int) -> list[ContentPillar]:
    existing = list(
        session.scalars(
            select(ContentPillar).where(ContentPillar.owner_id == owner_id).order_id()
            if hasattr(ContentPillar, "order_id")
            else select(ContentPillar).where(ContentPillar.owner_id == owner_id)
        )
    )
    if existing:
        return existing

    created: list[ContentPillar] = []
    for p in DEFAULT_PILLARS:
        item = ContentPillar(
            owner_id=owner_id,
            name=p["name"],
            target_cadence=p["target_cadence"],
            description=p["description"],
        )
        session.add(item)
        created.append(item)
    session.flush()
    return created


def list_pillars(session: Session, owner_id: int) -> list[ContentPillar]:
    pillars = list(
        session.scalars(
            select(ContentPillar)
            .where(ContentPillar.owner_id == owner_id)
            .order_by(ContentPillar.id.asc())
        )
    )
    if not pillars:
        return ensure_default_pillars(session, owner_id)
    return pillars


def create_pillar(session: Session, payload: ContentPillarCreate, owner_id: int) -> ContentPillar:
    pillar = ContentPillar(
        owner_id=owner_id,
        name=payload.name,
        target_cadence=payload.target_cadence,
        description=payload.description,
    )
    session.add(pillar)
    session.flush()
    return pillar


def delete_pillar(session: Session, pillar_id: int, owner_id: int) -> None:
    pillar = session.scalar(
        select(ContentPillar).where(
            ContentPillar.id == pillar_id, ContentPillar.owner_id == owner_id
        )
    )
    if pillar is None:
        raise NotFoundError(f"Content pillar {pillar_id} not found.")
    session.delete(pillar)
    session.flush()


# ---------------------------------------------------------- Post Generation ---


def _calculate_best_time() -> tuple[str, str]:
    now = datetime.now(UTC)
    day_offset = random.randint(1, 3)
    target_date = now + timedelta(days=day_offset)
    day_name = target_date.strftime("%a")
    date_str = target_date.strftime("%d %b")
    time_str = random.choice(["09:30", "10:15", "11:00", "14:30", "17:00"])
    best_time = f"{day_name} {time_str} IST"
    scheduled_slot = f"{day_name}, {date_str} · {time_str}"
    return best_time, scheduled_slot


async def generate_drafts(
    session: Session, payload: GenerateDraftsRequest, owner_id: int
) -> GenerateDraftsResponse:
    agent = PostGeneratorAgent()
    result = await agent.run(
        session=session,
        topic_prompt=payload.topic_prompt,
        post_format=payload.post_format,
        content_pillar=payload.content_pillar,
        post_length=payload.post_length,
    )

    draft_items: list[PostDraftItem] = []
    for idx, d in enumerate(result.data.drafts):
        best_time, scheduled_slot = _calculate_best_time()
        words = len(d.content.split())
        draft_items.append(
            PostDraftItem(
                id=f"draft-{idx + 1}-{int(datetime.now(UTC).timestamp())}",
                title=d.title,
                content=d.content,
                word_count=words,
                voice_match=random.randint(90, 96),
                best_time=best_time,
                scheduled_slot=scheduled_slot,
            )
        )

    return GenerateDraftsResponse(drafts=draft_items)


def shorten_content(content: str) -> str:
    lines = [line.strip() for line in content.split("\n") if line.strip()]
    if len(lines) <= 2:
        words = content.split()
        return " ".join(words[: max(20, int(len(words) * 0.7))])
    # Keep hook, condense middle takeaways, keep conclusion
    hook = lines[0]
    middle = lines[1:-1]
    filtered_middle = [m for m in middle if not m.lower().startswith("what")]
    conclusion = lines[-1] if len(lines) > 2 else ""
    return "\n\n".join(filter(None, [hook, *filtered_middle[:3], conclusion]))


async def regenerate_single_draft(
    session: Session, payload: RegenerateDraftRequest, owner_id: int
) -> PostDraftItem:
    agent = PostGeneratorAgent()
    result = await agent.run(
        session=session,
        topic_prompt=payload.topic_prompt,
        post_format=payload.post_format,
        content_pillar=payload.content_pillar,
        post_length="Medium · ~150 words",
    )
    first_draft = result.data.drafts[0]
    best_time, scheduled_slot = _calculate_best_time()
    return PostDraftItem(
        id=f"draft-regen-{int(datetime.now(UTC).timestamp())}",
        title=first_draft.title,
        content=first_draft.content,
        word_count=len(first_draft.content.split()),
        voice_match=random.randint(92, 97),
        best_time=best_time,
        scheduled_slot=scheduled_slot,
    )


def suggest_ideas(pillar_name: str | None = None) -> list[str]:
    ideas_bank = [
        "Lessons learned from shipping an AI agent to 40 enterprise clients — rollout, evaluations and failures.",
        "Why deterministic prompt guardrails beat autonomous model decision-making in production applications.",
        "The hidden cost of context window bloat: how stripping raw DOM saved 60% of our LLM latency.",
        "How we structure human-in-the-loop approval workflows without bottlenecking daily team velocity.",
        "Stop testing AI features in production: our 3-tier offline evals framework with realistic test harnesses.",
        "Why our team switched from monolith micro-prompts to structured Pydantic schema validation.",
    ]
    if pillar_name and "Hiring" in pillar_name:
        return [
            "What we look for in Senior AI Engineers beyond standard LeetCode exercises.",
            "How we structure technical take-home assessments that candidates actually enjoy.",
            "The top red flags when evaluating AI engineering candidates in 2026.",
        ]
    return ideas_bank


# ---------------------------------------------------- Scheduling & Calendar ---


def schedule_post(session: Session, payload: SchedulePostRequest, owner_id: int) -> UserPost:
    best_time = payload.best_time
    scheduled_for = payload.scheduled_for
    if not scheduled_for:
        scheduled_for = datetime.now(UTC) + timedelta(days=1, hours=4)
    if not best_time:
        best_time, _ = _calculate_best_time()

    metrics = {"image_url": payload.image_url} if payload.image_url else None
    post = UserPost(
        owner_id=owner_id,
        pillar_id=payload.pillar_id,
        title=payload.title,
        content=payload.content,
        post_format=payload.post_format,
        status="WAITING_APPROVAL" if payload.send_to_approvals else "SCHEDULED",
        scheduled_for=scheduled_for,
        best_time=best_time,
        voice_match_score=payload.voice_match_score,
        metrics=metrics,
    )
    session.add(post)
    session.flush()
    return post


def list_user_posts(session: Session, owner_id: int) -> list[UserPost]:
    return list(
        session.scalars(
            select(UserPost)
            .where(UserPost.owner_id == owner_id)
            .order_by(UserPost.created_at.desc())
        )
    )


def get_calendar(session: Session, owner_id: int) -> list[CalendarItem]:
    posts = list(
        session.scalars(
            select(UserPost)
            .where(UserPost.owner_id == owner_id)
            .order_by(UserPost.scheduled_for.asc().nullslast())
        )
    )
    items: list[CalendarItem] = []
    for p in posts:
        sched = p.scheduled_for or p.created_at
        day_name = sched.strftime("%A") if sched else "Monday"
        date_str = sched.strftime("%Y-%m-%d") if sched else ""
        items.append(
            CalendarItem(
                id=p.id,
                day_name=day_name,
                date_str=date_str,
                title=p.title,
                content=p.content,
                post_format=p.post_format,
                status=p.status,
                scheduled_for=p.scheduled_for,
                published_at=p.published_at,
                post=UserPostRead.model_validate(p),
            )
        )
    return items


def approve_user_post(session: Session, post_id: int, owner_id: int) -> UserPost:
    post = session.scalar(
        select(UserPost).where(UserPost.id == post_id, UserPost.owner_id == owner_id)
    )
    if post is None:
        raise NotFoundError(f"User post {post_id} not found.")
    post.status = "SCHEDULED"
    session.flush()
    return post


def reject_user_post(session: Session, post_id: int, owner_id: int) -> UserPost:
    post = session.scalar(
        select(UserPost).where(UserPost.id == post_id, UserPost.owner_id == owner_id)
    )
    if post is None:
        raise NotFoundError(f"User post {post_id} not found.")
    post.status = "REJECTED"
    session.flush()
    return post


def delete_user_post(session: Session, post_id: int, owner_id: int) -> None:
    post = session.scalar(
        select(UserPost).where(UserPost.id == post_id, UserPost.owner_id == owner_id)
    )
    if post is None:
        raise NotFoundError(f"User post {post_id} not found.")
    session.delete(post)
    session.flush()
