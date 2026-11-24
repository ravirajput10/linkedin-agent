from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, Query, Request
from sqlalchemy import func, select
from sse_starlette.sse import EventSourceResponse

from app.api.deps import BearerToken, DbSession, NotAuthenticatedError, OwnerScope, Pagination
from app.database import SessionLocal
from app.database.models import AgentLog, User
from app.enums import LogLevel
from app.logging import get_logger
from app.schemas.common import Page
from app.schemas.observability import ActivityRead
from app.security import decode_token
from app.services import events, scoping

logger = get_logger(__name__)
router = APIRouter(prefix="/activity", tags=["activity"])

POLL_INTERVAL_SECONDS = 1.0
KEEPALIVE_SECONDS = 15.0


@router.get("", response_model=Page[ActivityRead])
def list_activity(
    session: DbSession,
    pagination: Pagination,
    owner_id: OwnerScope,
    campaign_id: int | None = Query(default=None),
    level: LogLevel | None = Query(default=None),
    event_type: str | None = Query(default=None),
) -> Page[ActivityRead]:
    stmt = scoping.restrict_nullable(select(AgentLog), AgentLog.campaign_id, owner_id)
    count_stmt = scoping.restrict_nullable(
        select(func.count()).select_from(AgentLog), AgentLog.campaign_id, owner_id
    )

    conditions = []
    if campaign_id is not None:
        conditions.append(AgentLog.campaign_id == campaign_id)
    if level is not None:
        conditions.append(AgentLog.level == level)
    if event_type:
        conditions.append(AgentLog.event_type == event_type)
    for condition in conditions:
        stmt = stmt.where(condition)
        count_stmt = count_stmt.where(condition)

    total = session.scalar(count_stmt) or 0
    items = list(
        session.scalars(
            stmt.order_by(AgentLog.id.desc()).offset(pagination.offset).limit(pagination.page_size)
        )
    )
    return Page[ActivityRead](
        items=[ActivityRead.model_validate(item) for item in items],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.get("/export")
@router.get("/export-csv")
def export_activity_csv(
    session: DbSession,
    owner_id: OwnerScope,
    campaign_id: int | None = Query(default=None),
    level: LogLevel | None = Query(default=None),
    event_type: str | None = Query(default=None),
):
    """Export activity logs as a downloadable CSV stream (FR-7.9)."""
    import csv
    import io
    from fastapi.responses import Response

    stmt = scoping.restrict_nullable(select(AgentLog), AgentLog.campaign_id, owner_id)
    conditions = []
    if campaign_id is not None:
        conditions.append(AgentLog.campaign_id == campaign_id)
    if level is not None:
        conditions.append(AgentLog.level == level)
    if event_type:
        conditions.append(AgentLog.event_type == event_type)
    for condition in conditions:
        stmt = stmt.where(condition)

    items = list(session.scalars(stmt.order_by(AgentLog.id.desc()).limit(5000)))

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["id", "created_at", "level", "event_type", "campaign_id", "person_id", "message"])
    for item in items:
        writer.writerow([
            item.id,
            item.created_at.isoformat() if item.created_at else "",
            item.level.value if hasattr(item.level, "value") else str(item.level),
            item.event_type,
            item.campaign_id or "",
            item.person_id or "",
            item.message,
        ])

    csv_data = output.getvalue()
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="agent-activity.csv"'},
    )


def _stream_owner_id(
    session, credentials: BearerToken, token: str | None
) -> int:
    """Authenticate an SSE subscriber.

    ``EventSource`` cannot set request headers, so this one endpoint also
    accepts the access token as a query parameter. It is the same short-lived
    token, but it does end up in server logs and browser history, which is why
    no other route takes it this way.
    """
    raw = token or (credentials.credentials if credentials else None)
    if not raw:
        raise NotAuthenticatedError("Sign in to stream agent activity.")

    claims = decode_token(raw, expected_type="access")
    user = session.get(User, claims.subject)
    if user is None or not user.can_log_in:
        raise NotAuthenticatedError("This session is no longer valid.")
    return user.id


@router.get("/stream")
async def stream_activity(
    request: Request,
    session: DbSession,
    credentials: BearerToken,
    campaign_id: int | None = Query(default=None),
    after_id: int | None = Query(default=None),
    token: str | None = Query(default=None),
) -> EventSourceResponse:
    """Server-sent events, tailing ``agent_logs``.

    Using the table as the transport means events emitted by a Celery worker
    reach the browser without a separate message bus.
    """
    owner_id = _stream_owner_id(session, credentials, token)

    async def publisher() -> AsyncIterator[dict]:
        cursor = after_id
        if cursor is None:
            with SessionLocal() as read_session:
                cursor = events.latest_id(read_session, campaign_id, owner_id)

        idle = 0.0
        while True:
            if await request.is_disconnected():
                break

            with SessionLocal() as read_session:
                new_events = events.read_since(
                    read_session,
                    after_id=cursor or 0,
                    campaign_id=campaign_id,
                    owner_id=owner_id,
                )
                payloads = [
                    ActivityRead.model_validate(entry).model_dump(mode="json")
                    for entry in new_events
                ]
                if new_events:
                    cursor = new_events[-1].id

            if payloads:
                idle = 0.0
                for payload in payloads:
                    yield {
                        "event": payload["event_type"],
                        "id": str(payload["id"]),
                        "data": json.dumps(payload),
                    }
            else:
                idle += POLL_INTERVAL_SECONDS
                if idle >= KEEPALIVE_SECONDS:
                    idle = 0.0
                    yield {"event": "ping", "data": json.dumps({"cursor": cursor})}

            await asyncio.sleep(POLL_INTERVAL_SECONDS)

    return EventSourceResponse(publisher())
