from __future__ import annotations

from datetime import datetime

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.database import Base
from app.database.types import TimestampMixin


class ContentPillar(TimestampMixin, Base):
    """User-defined content themes / pillars with target publishing cadences."""

    __tablename__ = "content_pillars"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    target_cadence: Mapped[str] = mapped_column(String(50), default="1 / week", nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

    posts: Mapped[list[UserPost]] = relationship(
        back_populates="pillar", cascade="all, delete-orphan"
    )


class UserPost(TimestampMixin, Base):
    """User-authored LinkedIn posts created in Content Studio.

    Distinct from prospect posts: these represent original content drafted,
    scheduled, approved, and published on the authenticated user's behalf.
    """

    __tablename__ = "user_posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    pillar_id: Mapped[int | None] = mapped_column(
        ForeignKey("content_pillars.id", ondelete="SET NULL"), index=True
    )

    title: Mapped[str] = mapped_column(String(300), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    post_format: Mapped[str] = mapped_column(String(50), default="Text post", nullable=False)
    status: Mapped[str] = mapped_column(String(50), default="DRAFT", nullable=False, index=True)

    voice_match_score: Mapped[int] = mapped_column(Integer, default=90, nullable=False)
    best_time: Mapped[str | None] = mapped_column(String(100))
    scheduled_for: Mapped[datetime | None] = mapped_column(index=True)
    published_at: Mapped[datetime | None] = mapped_column(index=True)
    external_id: Mapped[str | None] = mapped_column(String(300))
    metrics: Mapped[dict | None] = mapped_column(JSONB)

    pillar: Mapped[ContentPillar | None] = relationship(back_populates="posts")

    @property
    def image_url(self) -> str | None:
        if self.metrics and isinstance(self.metrics, dict):
            return self.metrics.get("image_url")
        return None
