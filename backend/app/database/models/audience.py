from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.database import Base
from app.database.types import TimestampMixin

if TYPE_CHECKING:
    from app.database.models.person import Person
    from app.database.models.user import User


class Audience(TimestampMixin, Base):
    """A target group of prospects discovered from a prompt, criteria, or CSV."""

    __tablename__ = "audiences"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    original_prompt: Mapped[str] = mapped_column(Text, default="", nullable=False)
    filters_json: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    refresh_schedule: Mapped[str] = mapped_column(String(50), default="daily", nullable=False)
    last_refreshed_at: Mapped[datetime | None] = mapped_column()
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    owner: Mapped[User] = relationship(foreign_keys=[owner_id])
    members: Mapped[list[AudienceMember]] = relationship(
        back_populates="audience", cascade="all, delete-orphan"
    )


class AudienceMember(TimestampMixin, Base):
    """A person included in a saved audience with fit scoring and status."""

    __tablename__ = "audience_members"
    __table_args__ = (
        UniqueConstraint("audience_id", "person_id", name="uq_audience_person"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    audience_id: Mapped[int] = mapped_column(
        ForeignKey("audiences.id", ondelete="CASCADE"), nullable=False, index=True
    )
    person_id: Mapped[int] = mapped_column(
        ForeignKey("people.id", ondelete="CASCADE"), nullable=False, index=True
    )

    fit_score: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    match_reason: Mapped[str | None] = mapped_column(Text)
    matched_criteria: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    excluded: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    exclusion_reason: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(50), default="search", nullable=False)

    audience: Mapped[Audience] = relationship(back_populates="members")
    person: Mapped[Person] = relationship(foreign_keys=[person_id])
