from __future__ import annotations

from datetime import datetime

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database.database import Base
from app.database.types import TimestampMixin, enum_column
from app.enums import ApprovalStatus, ApprovalType, ConnectionMessageMode


class Comment(TimestampMixin, Base):
    """An AI-generated comment, from draft through to posted."""

    __tablename__ = "comments"

    id: Mapped[int] = mapped_column(primary_key=True)
    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False, index=True
    )
    person_id: Mapped[int] = mapped_column(
        ForeignKey("people.id", ondelete="CASCADE"), nullable=False, index=True
    )
    post_id: Mapped[int] = mapped_column(
        ForeignKey("posts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    workflow_id: Mapped[int | None] = mapped_column(
        ForeignKey("workflows.id", ondelete="CASCADE"), index=True
    )
    ai_execution_id: Mapped[int | None] = mapped_column(
        ForeignKey("ai_executions.id", ondelete="SET NULL")
    )

    generated_text: Mapped[str] = mapped_column(Text, nullable=False)
    #: Populated when a human edits the draft before approving it.
    edited_text: Mapped[str | None] = mapped_column(Text)
    posted_text: Mapped[str | None] = mapped_column(Text)

    regeneration_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    posted_at: Mapped[datetime | None] = mapped_column()
    external_id: Mapped[str | None] = mapped_column(String(300))

    agent_name: Mapped[str] = mapped_column(String(100), nullable=False)
    prompt_version: Mapped[str] = mapped_column(String(20), nullable=False)
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    model: Mapped[str] = mapped_column(String(200), nullable=False)
    input_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    raw_output: Mapped[dict | None] = mapped_column(JSONB)

    @property
    def final_text(self) -> str:
        return self.posted_text or self.edited_text or self.generated_text


class ConnectionMessage(TimestampMixin, Base):
    """A personalised connection request message."""

    __tablename__ = "connection_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False, index=True
    )
    person_id: Mapped[int] = mapped_column(
        ForeignKey("people.id", ondelete="CASCADE"), nullable=False, index=True
    )
    workflow_id: Mapped[int | None] = mapped_column(
        ForeignKey("workflows.id", ondelete="CASCADE"), index=True
    )
    ai_execution_id: Mapped[int | None] = mapped_column(
        ForeignKey("ai_executions.id", ondelete="SET NULL")
    )

    mode: Mapped[ConnectionMessageMode] = mapped_column(
        enum_column(ConnectionMessageMode), nullable=False
    )
    generated_text: Mapped[str | None] = mapped_column(Text)
    edited_text: Mapped[str | None] = mapped_column(Text)
    sent_text: Mapped[str | None] = mapped_column(Text)

    regeneration_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    sent_at: Mapped[datetime | None] = mapped_column()

    agent_name: Mapped[str | None] = mapped_column(String(100))
    prompt_version: Mapped[str | None] = mapped_column(String(20))
    provider: Mapped[str | None] = mapped_column(String(50))
    model: Mapped[str | None] = mapped_column(String(200))
    input_hash: Mapped[str | None] = mapped_column(String(64))
    raw_output: Mapped[dict | None] = mapped_column(JSONB)

    @property
    def final_text(self) -> str | None:
        return self.sent_text or self.edited_text or self.generated_text


class Approval(TimestampMixin, Base):
    """A pending human decision.

    One table backs all three Approval Center tabs; ``approval_type`` selects
    the tab and ``comment_id`` / ``connection_message_id`` carry the subject.
    """

    __tablename__ = "approvals"

    id: Mapped[int] = mapped_column(primary_key=True)
    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False, index=True
    )
    person_id: Mapped[int] = mapped_column(
        ForeignKey("people.id", ondelete="CASCADE"), nullable=False, index=True
    )
    workflow_id: Mapped[int | None] = mapped_column(
        ForeignKey("workflows.id", ondelete="CASCADE"), index=True
    )
    post_id: Mapped[int | None] = mapped_column(ForeignKey("posts.id", ondelete="SET NULL"))
    comment_id: Mapped[int | None] = mapped_column(ForeignKey("comments.id", ondelete="CASCADE"))
    connection_message_id: Mapped[int | None] = mapped_column(
        ForeignKey("connection_messages.id", ondelete="CASCADE")
    )

    approval_type: Mapped[ApprovalType] = mapped_column(
        enum_column(ApprovalType), nullable=False, index=True
    )
    status: Mapped[ApprovalStatus] = mapped_column(
        enum_column(ApprovalStatus), default=ApprovalStatus.PENDING, nullable=False, index=True
    )

    proposed_action: Mapped[str] = mapped_column(String(100), nullable=False)
    ai_reasoning: Mapped[str | None] = mapped_column(Text)
    ai_score: Mapped[int | None] = mapped_column(Integer)
    content: Mapped[str | None] = mapped_column(Text)
    context: Mapped[dict | None] = mapped_column(JSONB)

    decided_at: Mapped[datetime | None] = mapped_column()
    decided_by: Mapped[str | None] = mapped_column(String(200))
    decision_note: Mapped[str | None] = mapped_column(Text)
