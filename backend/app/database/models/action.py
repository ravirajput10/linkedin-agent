from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database.database import Base
from app.database.types import TimestampMixin, enum_column
from app.enums import ActionStatus, ActionType


class Action(TimestampMixin, Base):
    """Every external side effect the agent attempts.

    ``idempotency_key`` is unique, so re-running a workflow step can never
    produce a second like or a duplicate comment.
    """

    __tablename__ = "actions"
    __table_args__ = (UniqueConstraint("idempotency_key", name="action_idempotency"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False, index=True
    )
    person_id: Mapped[int | None] = mapped_column(
        ForeignKey("people.id", ondelete="SET NULL"), index=True
    )
    post_id: Mapped[int | None] = mapped_column(
        ForeignKey("posts.id", ondelete="SET NULL"), index=True
    )
    workflow_id: Mapped[int | None] = mapped_column(
        ForeignKey("workflows.id", ondelete="CASCADE"), index=True
    )

    action_type: Mapped[ActionType] = mapped_column(enum_column(ActionType), nullable=False)
    status: Mapped[ActionStatus] = mapped_column(
        enum_column(ActionStatus), default=ActionStatus.PENDING, nullable=False, index=True
    )

    idempotency_key: Mapped[str] = mapped_column(String(255), nullable=False)
    dry_run: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    payload: Mapped[dict | None] = mapped_column(JSONB)
    result: Mapped[dict | None] = mapped_column(JSONB)
    external_id: Mapped[str | None] = mapped_column(String(300))

    attempt_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    executed_at: Mapped[datetime | None] = mapped_column()
    error_code: Mapped[str | None] = mapped_column(String(64))
    error_message: Mapped[str | None] = mapped_column(Text)
