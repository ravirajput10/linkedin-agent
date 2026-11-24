from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.database import Base
from app.database.types import TimestampMixin, enum_column
from app.enums import ConnectionStatus

if TYPE_CHECKING:
    from app.database.models.campaign import Campaign
    from app.database.models.post import Post


class Person(TimestampMixin, Base):
    """A discovered profile. Unique per platform identity, shared across campaigns."""

    __tablename__ = "people"
    __table_args__ = (UniqueConstraint("platform", "profile_url", name="person_profile"),)

    id: Mapped[int] = mapped_column(primary_key=True)

    platform: Mapped[str] = mapped_column(String(50), default="linkedin", nullable=False)
    external_id: Mapped[str | None] = mapped_column(String(200), index=True)
    profile_url: Mapped[str] = mapped_column(String(1000), nullable=False)

    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    headline: Mapped[str | None] = mapped_column(Text)
    job_title: Mapped[str | None] = mapped_column(String(300))
    company: Mapped[str | None] = mapped_column(String(300))
    industry: Mapped[str | None] = mapped_column(String(200))
    location: Mapped[str | None] = mapped_column(String(300))
    about: Mapped[str | None] = mapped_column(Text)
    avatar_url: Mapped[str | None] = mapped_column(String(1000))

    connection_status: Mapped[ConnectionStatus] = mapped_column(
        enum_column(ConnectionStatus), default=ConnectionStatus.UNKNOWN, nullable=False
    )
    last_activity_at: Mapped[datetime | None] = mapped_column()
    last_synced_at: Mapped[datetime | None] = mapped_column()

    raw_profile: Mapped[dict | None] = mapped_column(JSONB)

    campaign_links: Mapped[list[PersonCampaign]] = relationship(
        back_populates="person", cascade="all, delete-orphan"
    )
    posts: Mapped[list[Post]] = relationship(
        back_populates="person", cascade="all, delete-orphan"
    )


class PersonCampaign(TimestampMixin, Base):
    """Membership of a person in a campaign, with discovery provenance."""

    __tablename__ = "person_campaigns"
    __table_args__ = (UniqueConstraint("campaign_id", "person_id", name="person_campaign"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False, index=True
    )
    person_id: Mapped[int] = mapped_column(
        ForeignKey("people.id", ondelete="CASCADE"), nullable=False, index=True
    )

    discovery_reason: Mapped[str | None] = mapped_column(Text)
    discovery_query: Mapped[str | None] = mapped_column(Text)
    matched_criteria: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    match_score: Mapped[int | None] = mapped_column(Integer)
    excluded: Mapped[bool] = mapped_column(default=False, nullable=False)
    exclusion_reason: Mapped[str | None] = mapped_column(Text)

    campaign: Mapped[Campaign] = relationship(back_populates="person_links")
    person: Mapped[Person] = relationship(back_populates="campaign_links")


class CandidateEvaluation(TimestampMixin, Base):
    """Persisted AI judgement about whether a person matches a campaign."""

    __tablename__ = "candidate_evaluations"

    id: Mapped[int] = mapped_column(primary_key=True)
    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False, index=True
    )
    person_id: Mapped[int] = mapped_column(
        ForeignKey("people.id", ondelete="CASCADE"), nullable=False, index=True
    )
    ai_execution_id: Mapped[int | None] = mapped_column(
        ForeignKey("ai_executions.id", ondelete="SET NULL")
    )

    is_match: Mapped[bool] = mapped_column(nullable=False)
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    matched_criteria: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    risk_flags: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)

    agent_name: Mapped[str] = mapped_column(String(100), nullable=False)
    prompt_version: Mapped[str] = mapped_column(String(20), nullable=False)
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    model: Mapped[str] = mapped_column(String(200), nullable=False)
    input_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    raw_output: Mapped[dict | None] = mapped_column(JSONB)
