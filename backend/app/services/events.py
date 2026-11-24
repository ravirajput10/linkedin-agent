"""Agent event stream.

Events are written to ``agent_logs`` and the SSE endpoint tails that table.
Durable storage is the transport, so the API process sees events emitted by
Celery workers without needing a message bus, and the Activity page can replay
history that predates the browser connecting.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database.models import AgentLog
from app.enums import EventType, LogLevel
from app.logging import get_logger, redact

logger = get_logger(__name__)


def emit(
    session: Session,
    event_type: EventType | str,
    message: str,
    *,
    campaign_id: int | None = None,
    person_id: int | None = None,
    workflow_id: int | None = None,
    agent_run_id: int | None = None,
    level: LogLevel = LogLevel.INFO,
    payload: dict[str, Any] | None = None,
) -> AgentLog:
    """Record one agent event. Flushed immediately so tailing clients see it."""
    event_name = event_type.value if isinstance(event_type, EventType) else str(event_type)
    entry = AgentLog(
        campaign_id=campaign_id,
        person_id=person_id,
        workflow_id=workflow_id,
        agent_run_id=agent_run_id,
        level=level,
        event_type=event_name,
        message=message,
        payload=redact(payload) if payload else None,
    )
    session.add(entry)
    session.flush()

    log_at = {
        LogLevel.DEBUG: logger.debug,
        LogLevel.INFO: logger.info,
        LogLevel.WARNING: logger.warning,
        LogLevel.ERROR: logger.error,
    }[level]
    log_at("[%s] %s", event_name, message)
    return entry


def read_since(
    session: Session,
    *,
    after_id: int = 0,
    campaign_id: int | None = None,
    owner_id: int | None = None,
    limit: int = 200,
) -> list[AgentLog]:
    from app.services import scoping

    stmt = scoping.restrict_nullable(
        select(AgentLog).where(AgentLog.id > after_id), AgentLog.campaign_id, owner_id
    )
    if campaign_id is not None:
        stmt = stmt.where(AgentLog.campaign_id == campaign_id)
    return list(session.scalars(stmt.order_by(AgentLog.id).limit(limit)))


def latest_id(
    session: Session, campaign_id: int | None = None, owner_id: int | None = None
) -> int:
    from app.services import scoping

    stmt = scoping.restrict_nullable(select(AgentLog.id), AgentLog.campaign_id, owner_id)
    if campaign_id is not None:
        stmt = stmt.where(AgentLog.campaign_id == campaign_id)
    return session.scalar(stmt.order_by(AgentLog.id.desc()).limit(1)) or 0
