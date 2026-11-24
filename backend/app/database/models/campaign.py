from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.database import Base
from app.database.types import TimestampMixin, enum_column
from app.enums import (
    ApprovalMode,
    CampaignStatus,
    CommentLength,
    CommentStyle,
    ConnectionMessageMode,
)

if TYPE_CHECKING:
    from app.database.models.audience import Audience
    from app.database.models.person import PersonCampaign
    from app.database.models.workflow import Workflow


class Campaign(TimestampMixin, Base):
    __tablename__ = "campaigns"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    audience_id: Mapped[int | None] = mapped_column(
        ForeignKey("audiences.id", ondelete="SET NULL"), nullable=True, index=True
    )

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    instruction: Mapped[str] = mapped_column(Text, nullable=False)

    status: Mapped[CampaignStatus] = mapped_column(
        enum_column(CampaignStatus), default=CampaignStatus.DRAFT, nullable=False, index=True
    )

    dry_run: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    started_at: Mapped[datetime | None] = mapped_column()
    paused_at: Mapped[datetime | None] = mapped_column()
    stopped_at: Mapped[datetime | None] = mapped_column()
    completed_at: Mapped[datetime | None] = mapped_column()
    last_error: Mapped[str | None] = mapped_column(Text)

    audience: Mapped[Audience | None] = relationship(foreign_keys=[audience_id])
    criteria: Mapped[CampaignCriteria] = relationship(
        back_populates="campaign", uselist=False, cascade="all, delete-orphan"
    )
    exclusions: Mapped[list[CampaignExclusion]] = relationship(
        back_populates="campaign", cascade="all, delete-orphan"
    )
    person_links: Mapped[list[PersonCampaign]] = relationship(
        back_populates="campaign", cascade="all, delete-orphan"
    )
    workflows: Mapped[list[Workflow]] = relationship(
        back_populates="campaign", cascade="all, delete-orphan"
    )



class CampaignCriteria(TimestampMixin, Base):
    """Structured criteria produced by the campaign parser and edited by the user."""

    __tablename__ = "campaign_criteria"

    id: Mapped[int] = mapped_column(primary_key=True)
    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("campaigns.id", ondelete="CASCADE"), unique=True, nullable=False, index=True
    )

    # -- target people --------------------------------------------------------
    job_titles: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    industries: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    locations: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    company_sizes: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    people_keywords: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    seniority_levels: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)

    # -- post criteria --------------------------------------------------------
    include_topics: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    exclude_topics: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    include_keywords: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    exclude_keywords: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    post_types: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    minimum_relevance_score: Mapped[int] = mapped_column(Integer, default=75, nullable=False)
    minimum_candidate_score: Mapped[int] = mapped_column(Integer, default=70, nullable=False)
    min_post_age_hours: Mapped[int | None] = mapped_column(Integer)
    max_post_age_days: Mapped[int | None] = mapped_column(Integer, default=30)

    # -- engagement settings --------------------------------------------------
    initial_posts_to_like: Mapped[int] = mapped_column(Integer, default=2, nullable=False)
    evaluate_post_index: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    like_evaluated_post_if_relevant: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False
    )
    generate_comment: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    #: When False, the AI's relevance score is recorded but does not gate the
    #: action. A candidate who passed evaluation is worth engaging with even if
    #: today's post happens to be off-topic.
    require_relevance_for_like: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False, server_default="true"
    )
    require_relevance_for_comment: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False, server_default="true"
    )

    # -- comment settings -----------------------------------------------------
    comment_approval: Mapped[ApprovalMode] = mapped_column(
        enum_column(ApprovalMode), default=ApprovalMode.REQUIRED, nullable=False
    )
    comment_length: Mapped[CommentLength] = mapped_column(
        enum_column(CommentLength), default=CommentLength.SHORT, nullable=False
    )
    comment_style: Mapped[CommentStyle] = mapped_column(
        enum_column(CommentStyle), default=CommentStyle.PROFESSIONAL, nullable=False
    )

    # -- candidate approval ---------------------------------------------------
    candidate_approval: Mapped[ApprovalMode] = mapped_column(
        enum_column(ApprovalMode), default=ApprovalMode.AUTOMATIC, nullable=False
    )

    # -- connection settings --------------------------------------------------
    connection_delay_hours: Mapped[int] = mapped_column(Integer, default=48, nullable=False)
    revalidate_before_connection: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False
    )
    connection_message_mode: Mapped[ConnectionMessageMode] = mapped_column(
        enum_column(ConnectionMessageMode),
        default=ConnectionMessageMode.AI_GENERATED,
        nullable=False,
    )
    connection_message_template: Mapped[str | None] = mapped_column(Text)
    connection_approval: Mapped[ApprovalMode] = mapped_column(
        enum_column(ApprovalMode), default=ApprovalMode.REQUIRED, nullable=False
    )

    # -- rate limits ----------------------------------------------------------
    max_people_per_day: Mapped[int] = mapped_column(Integer, default=20, nullable=False)
    daily_intake_limit: Mapped[int] = mapped_column(Integer, default=20, nullable=False)

    single_campaign_lock: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    max_likes_per_day: Mapped[int] = mapped_column(Integer, default=60, nullable=False)
    max_comments_per_day: Mapped[int] = mapped_column(Integer, default=15, nullable=False)
    max_connections_per_day: Mapped[int] = mapped_column(Integer, default=15, nullable=False)
    max_people_per_run: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    min_action_delay_seconds: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    max_action_delay_seconds: Mapped[int] = mapped_column(Integer, default=180, nullable=False)


    campaign: Mapped[Campaign] = relationship(back_populates="criteria")


class CampaignExclusion(TimestampMixin, Base):
    """People, companies or keywords the campaign must never engage with."""

    __tablename__ = "campaign_exclusions"
    __table_args__ = (
        UniqueConstraint("campaign_id", "exclusion_type", "value", name="campaign_exclusion"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False, index=True
    )
    exclusion_type: Mapped[str] = mapped_column(String(50), nullable=False)
    value: Mapped[str] = mapped_column(String(500), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)

    campaign: Mapped[Campaign] = relationship(back_populates="exclusions")
