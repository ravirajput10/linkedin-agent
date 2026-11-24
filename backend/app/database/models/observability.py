from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, Float, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database.database import Base
from app.database.types import TimestampMixin, enum_column
from app.enums import AgentRunStatus, LogLevel


class AgentRun(TimestampMixin, Base):
    """One execution of the agent controller over a campaign."""

    __tablename__ = "agent_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False, index=True
    )

    status: Mapped[AgentRunStatus] = mapped_column(
        enum_column(AgentRunStatus), default=AgentRunStatus.RUNNING, nullable=False, index=True
    )
    trigger: Mapped[str] = mapped_column(String(50), default="manual", nullable=False)

    started_at: Mapped[datetime] = mapped_column(nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column()

    candidates_discovered: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    candidates_matched: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    candidates_processed: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    posts_analyzed: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    actions_executed: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    failures: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    error_code: Mapped[str | None] = mapped_column(String(64))
    error_message: Mapped[str | None] = mapped_column(Text)


class AgentLog(TimestampMixin, Base):
    """Human-readable audit trail surfaced on the Agent Activity page."""

    __tablename__ = "agent_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    campaign_id: Mapped[int | None] = mapped_column(
        ForeignKey("campaigns.id", ondelete="CASCADE"), index=True
    )
    person_id: Mapped[int | None] = mapped_column(ForeignKey("people.id", ondelete="SET NULL"))
    workflow_id: Mapped[int | None] = mapped_column(
        ForeignKey("workflows.id", ondelete="CASCADE"), index=True
    )
    agent_run_id: Mapped[int | None] = mapped_column(
        ForeignKey("agent_runs.id", ondelete="CASCADE"), index=True
    )

    level: Mapped[LogLevel] = mapped_column(
        enum_column(LogLevel), default=LogLevel.INFO, nullable=False, index=True
    )
    event_type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict | None] = mapped_column(JSONB)


class AIExecution(TimestampMixin, Base):
    """One LLM call: which agent, which prompt version, which provider, what it cost."""

    __tablename__ = "ai_executions"

    id: Mapped[int] = mapped_column(primary_key=True)
    campaign_id: Mapped[int | None] = mapped_column(
        ForeignKey("campaigns.id", ondelete="CASCADE"), index=True
    )
    person_id: Mapped[int | None] = mapped_column(ForeignKey("people.id", ondelete="SET NULL"))
    workflow_id: Mapped[int | None] = mapped_column(
        ForeignKey("workflows.id", ondelete="CASCADE"), index=True
    )

    agent_name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    provider: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    model: Mapped[str] = mapped_column(String(200), nullable=False)
    prompt_version: Mapped[str] = mapped_column(String(20), nullable=False)

    request_at: Mapped[datetime] = mapped_column(nullable=False)
    response_at: Mapped[datetime | None] = mapped_column()
    latency_ms: Mapped[int | None] = mapped_column(Integer)

    success: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    attempt_count: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    error_code: Mapped[str | None] = mapped_column(String(64))
    error_message: Mapped[str | None] = mapped_column(Text)

    input_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)
    estimated_cost_usd: Mapped[float | None] = mapped_column(Numeric(12, 6))
    gpu_seconds: Mapped[float | None] = mapped_column(Float)

    #: SHA-256 of the rendered prompts, so a decision can be traced to its input
    #: without storing the full personal content of every request.
    input_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    output: Mapped[dict | None] = mapped_column(JSONB)


class AppSetting(TimestampMixin, Base):
    """Runtime-editable settings that override nothing secret."""

    __tablename__ = "settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)
    value: Mapped[dict] = mapped_column(JSONB, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
