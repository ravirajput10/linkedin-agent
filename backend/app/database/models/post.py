from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.database import Base
from app.database.types import TimestampMixin, enum_column
from app.enums import PostProcessingStatus, PostType

if TYPE_CHECKING:
    from app.database.models.person import Person


class Post(TimestampMixin, Base):
    __tablename__ = "posts"
    __table_args__ = (UniqueConstraint("platform", "external_id", name="post_external"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    person_id: Mapped[int] = mapped_column(
        ForeignKey("people.id", ondelete="CASCADE"), nullable=False, index=True
    )
    campaign_id: Mapped[int | None] = mapped_column(
        ForeignKey("campaigns.id", ondelete="CASCADE"), index=True
    )

    platform: Mapped[str] = mapped_column(String(50), default="linkedin", nullable=False)
    external_id: Mapped[str] = mapped_column(String(300), nullable=False)
    post_url: Mapped[str | None] = mapped_column(String(1000))

    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    post_type: Mapped[PostType] = mapped_column(
        enum_column(PostType), default=PostType.TEXT, nullable=False
    )
    published_at: Mapped[datetime | None] = mapped_column(index=True)

    like_count: Mapped[int | None] = mapped_column(Integer)
    comment_count: Mapped[int | None] = mapped_column(Integer)

    #: Position in the campaign's engagement sequence for this person (1, 2, 3...).
    sequence_index: Mapped[int | None] = mapped_column(Integer)

    is_eligible: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    ineligibility_reason: Mapped[str | None] = mapped_column(Text)
    processing_status: Mapped[PostProcessingStatus] = mapped_column(
        enum_column(PostProcessingStatus),
        default=PostProcessingStatus.DISCOVERED,
        nullable=False,
        index=True,
    )

    raw_post: Mapped[dict | None] = mapped_column(JSONB)

    person: Mapped[Person] = relationship(back_populates="posts")
    evaluations: Mapped[list[PostEvaluation]] = relationship(
        back_populates="post", cascade="all, delete-orphan"
    )


class PostEvaluation(TimestampMixin, Base):
    """Persisted AI judgement about a single post."""

    __tablename__ = "post_evaluations"

    id: Mapped[int] = mapped_column(primary_key=True)
    post_id: Mapped[int] = mapped_column(
        ForeignKey("posts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False, index=True
    )
    ai_execution_id: Mapped[int | None] = mapped_column(
        ForeignKey("ai_executions.id", ondelete="SET NULL")
    )

    eligible: Mapped[bool] = mapped_column(nullable=False)
    relevance_score: Mapped[int] = mapped_column(Integer, nullable=False)
    topics: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    risk_flags: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)

    agent_name: Mapped[str] = mapped_column(String(100), nullable=False)
    prompt_version: Mapped[str] = mapped_column(String(20), nullable=False)
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    model: Mapped[str] = mapped_column(String(200), nullable=False)
    input_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    raw_output: Mapped[dict | None] = mapped_column(JSONB)

    post: Mapped[Post] = relationship(back_populates="evaluations")
