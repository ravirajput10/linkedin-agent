from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Date, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database.database import Base
from app.database.types import TimestampMixin, enum_column
from app.enums import ScheduledTaskStatus, ScheduledTaskType


class ScheduledTask(TimestampMixin, Base):
    """A durable future job. The database — not an in-memory timer — owns the delay."""

    __tablename__ = "scheduled_tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False, index=True
    )
    person_id: Mapped[int | None] = mapped_column(
        ForeignKey("people.id", ondelete="CASCADE"), index=True
    )
    workflow_id: Mapped[int | None] = mapped_column(
        ForeignKey("workflows.id", ondelete="CASCADE"), index=True
    )

    task_type: Mapped[ScheduledTaskType] = mapped_column(
        enum_column(ScheduledTaskType), nullable=False, index=True
    )
    status: Mapped[ScheduledTaskStatus] = mapped_column(
        enum_column(ScheduledTaskStatus),
        default=ScheduledTaskStatus.SCHEDULED,
        nullable=False,
        index=True,
    )

    scheduled_at: Mapped[datetime] = mapped_column(nullable=False, index=True)
    executed_at: Mapped[datetime | None] = mapped_column()
    attempt_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    payload: Mapped[dict | None] = mapped_column(JSONB)
    result: Mapped[dict | None] = mapped_column(JSONB)
    error_code: Mapped[str | None] = mapped_column(String(64))
    error_message: Mapped[str | None] = mapped_column(Text)
    celery_task_id: Mapped[str | None] = mapped_column(String(120))


class DailyUsage(TimestampMixin, Base):
    """Per-campaign, per-day counters enforcing the rate limits."""

    __tablename__ = "daily_usage"
    __table_args__ = (UniqueConstraint("campaign_id", "usage_date", name="daily_usage_day"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False, index=True
    )
    usage_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)

    people_processed: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    likes_sent: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    comments_sent: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    connections_sent: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    ai_requests: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    failures: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
