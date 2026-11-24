from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.database import Base
from app.database.types import TimestampMixin, enum_column
from app.enums import WorkflowState

if TYPE_CHECKING:
    from app.database.models.campaign import Campaign
    from app.database.models.person import Person


class Workflow(TimestampMixin, Base):
    """Persisted engagement workflow for one person inside one campaign.

    The row is the single source of truth for resumability: after a crash the
    engine reloads ``state`` and continues from there rather than replaying
    completed steps.
    """

    __tablename__ = "workflows"
    __table_args__ = (UniqueConstraint("campaign_id", "person_id", name="workflow_person"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False, index=True
    )
    person_id: Mapped[int] = mapped_column(
        ForeignKey("people.id", ondelete="CASCADE"), nullable=False, index=True
    )

    state: Mapped[WorkflowState] = mapped_column(
        enum_column(WorkflowState), default=WorkflowState.CANDIDATE_FOUND, nullable=False, index=True
    )
    previous_state: Mapped[WorkflowState | None] = mapped_column(enum_column(WorkflowState))

    #: Free-form progress context: post ids by sequence, comment id, etc.
    context: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)

    consecutive_failures: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_error_code: Mapped[str | None] = mapped_column(String(64))
    last_error_message: Mapped[str | None] = mapped_column(Text)

    started_at: Mapped[datetime | None] = mapped_column()
    completed_at: Mapped[datetime | None] = mapped_column()
    #: Set while a worker holds the workflow, to keep concurrent runs out.
    locked_at: Mapped[datetime | None] = mapped_column()
    locked_by: Mapped[str | None] = mapped_column(String(200))

    campaign: Mapped[Campaign] = relationship(back_populates="workflows")
    person: Mapped[Person] = relationship()
    steps: Mapped[list[WorkflowStep]] = relationship(
        back_populates="workflow",
        cascade="all, delete-orphan",
        order_by="WorkflowStep.id",
    )


class WorkflowStep(TimestampMixin, Base):
    """Append-only audit trail of every state transition."""

    __tablename__ = "workflow_steps"

    id: Mapped[int] = mapped_column(primary_key=True)
    workflow_id: Mapped[int] = mapped_column(
        ForeignKey("workflows.id", ondelete="CASCADE"), nullable=False, index=True
    )

    from_state: Mapped[WorkflowState | None] = mapped_column(enum_column(WorkflowState))
    to_state: Mapped[WorkflowState] = mapped_column(enum_column(WorkflowState), nullable=False)
    summary: Mapped[str | None] = mapped_column(Text)
    payload: Mapped[dict | None] = mapped_column(JSONB)
    duration_ms: Mapped[int | None] = mapped_column(Integer)

    workflow: Mapped[Workflow] = relationship(back_populates="steps")
