"""Hands work to Celery, with a local fallback when no broker is running.

In deployment, Redis and a worker are always present and every dispatch becomes
a Celery task. On a developer laptop the broker is often not running, and
silently doing nothing would be worse than useless — so the work runs in a
background thread instead, and the log says so.
"""

from __future__ import annotations

import asyncio
import threading
from typing import Any

from app.config import settings
from app.logging import get_logger

logger = get_logger(__name__)


def _run_in_thread(name: str, target: Any, *args: Any) -> None:
    thread = threading.Thread(target=target, args=args, name=name, daemon=True)
    thread.start()
    logger.warning(
        "Celery broker at %s is unavailable; running %s in a local background thread. "
        "Start Redis and a Celery worker for durable scheduling.",
        settings.broker_url,
        name,
    )


def _local_campaign_run(campaign_id: int, trigger: str) -> None:
    from app.agents.agent_controller import AgentController
    from app.database import session_scope
    from app.database.models import Campaign
    from app.enums import EventType, LogLevel
    from app.services import events

    try:
        with session_scope() as session:
            asyncio.run(AgentController(session).run_campaign(campaign_id, trigger=trigger))
    except Exception as exc:
        logger.exception("Local campaign run failed for campaign %s", campaign_id)
        try:
            with session_scope() as session:
                camp = session.get(Campaign, campaign_id)
                if camp:
                    camp.last_error = str(exc)
                events.emit(
                    session,
                    EventType.WORKFLOW_FAILED,
                    f"Campaign run failed: {exc}",
                    campaign_id=campaign_id,
                    level=LogLevel.ERROR,
                )
        except Exception:
            logger.exception("Failed to persist error for campaign %s", campaign_id)


def _local_workflow_advance(workflow_id: int) -> None:
    from app.agents.agent_controller import resume_workflow
    from app.database import session_scope

    try:
        with session_scope() as session:
            asyncio.run(resume_workflow(session, workflow_id))
    except Exception:
        logger.exception("Local workflow advance failed for workflow %s", workflow_id)


def dispatch_campaign_run(campaign_id: int, *, trigger: str = "manual") -> str | None:
    from app.scheduler.tasks import run_campaign

    try:
        result = run_campaign.delay(campaign_id, trigger)
        return str(result.id)
    except Exception as exc:
        logger.debug("Celery dispatch failed: %s", exc)
        _run_in_thread(f"campaign-run-{campaign_id}", _local_campaign_run, campaign_id, trigger)
        return None


def dispatch_workflow_advance(workflow_id: int) -> str | None:
    from app.scheduler.tasks import advance_workflow

    try:
        result = advance_workflow.delay(workflow_id)
        return str(result.id)
    except Exception as exc:
        logger.debug("Celery dispatch failed: %s", exc)
        _run_in_thread(f"workflow-advance-{workflow_id}", _local_workflow_advance, workflow_id)
        return None


def dispatch_scheduled_task(scheduled_task_id: int) -> str | None:
    from app.scheduler.tasks import execute_scheduled_task

    try:
        result = execute_scheduled_task.delay(scheduled_task_id)
        return str(result.id)
    except Exception as exc:
        logger.debug("Celery dispatch failed: %s", exc)
        return None
