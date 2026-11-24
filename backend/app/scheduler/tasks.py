"""Celery tasks.

Each task opens its own session, does one bounded unit of work, and commits.
Nothing here holds state between invocations.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select

from app.agents.agent_controller import AgentController, resume_workflow
from app.agents.policies import retry_delay_seconds
from app.agents.workflow_engine import WorkflowEngine
from app.database import session_scope
from app.database.models import Campaign, ScheduledTask, Workflow
from app.enums import (
    TERMINAL_STATES,
    CampaignStatus,
    EventType,
    LogLevel,
    ScheduledTaskStatus,
    WorkflowState,
)
from app.errors import AppError
from app.logging import get_logger
from app.scheduler.celery_app import celery_app
from app.services import events
from app.workflows import connection as connection_workflow

logger = get_logger(__name__)

#: A scheduled task that keeps finding its workflow unfinished is stuck on
#: something the scheduler cannot resolve. Give up and surface it rather
#: than retrying for the rest of time.
MAX_SCHEDULED_TASK_ATTEMPTS = 5


def _run(coro: Any) -> Any:
    """Bridge Celery's synchronous worker into the async engine."""
    return asyncio.run(coro)


# ---------------------------------------------------------------- campaigns --


@celery_app.task(name="app.scheduler.tasks.run_campaign", bind=True, max_retries=3)
def run_campaign(self, campaign_id: int, trigger: str = "manual") -> dict[str, Any]:
    """Discover candidates and advance their workflows for one campaign."""
    try:
        with session_scope() as session:
            controller = AgentController(session)
            summary = _run(controller.run_campaign(campaign_id, trigger=trigger))
            return {
                "agent_run_id": summary.agent_run_id,
                "candidates_discovered": summary.candidates_discovered,
                "candidates_processed": summary.candidates_processed,
                "workflows_completed": summary.workflows_completed,
                "workflows_waiting": summary.workflows_waiting,
                "workflows_failed": summary.workflows_failed,
                "stopped_reason": summary.stopped_reason,
            }
    except AppError as exc:
        if exc.is_transient:
            raise self.retry(
                exc=exc, countdown=retry_delay_seconds(self.request.retries + 1)
            ) from exc
        raise


@celery_app.task(name="app.scheduler.tasks.tick_running_campaigns")
def tick_running_campaigns() -> dict[str, Any]:
    """Beat entry point: nudge every running campaign."""
    with session_scope() as session:
        campaign_ids = list(
            session.scalars(
                select(Campaign.id).where(Campaign.status == CampaignStatus.RUNNING)
            )
        )
    for campaign_id in campaign_ids:
        run_campaign.delay(campaign_id, trigger="scheduled")
    return {"dispatched": len(campaign_ids)}


# ---------------------------------------------------------------- workflows --


@celery_app.task(name="app.scheduler.tasks.advance_workflow", bind=True, max_retries=3)
def advance_workflow(self, workflow_id: int) -> dict[str, Any]:
    """Resume one workflow — used after an approval decision."""
    try:
        with session_scope() as session:
            workflow = _run(resume_workflow(session, workflow_id))
            return {"workflow_id": workflow.id, "state": workflow.state.value}
    except AppError as exc:
        if exc.is_transient:
            raise self.retry(
                exc=exc, countdown=retry_delay_seconds(self.request.retries + 1)
            ) from exc
        raise


# ---------------------------------------------------------------- scheduler --


@celery_app.task(name="app.scheduler.tasks.process_due_scheduled_tasks")
def process_due_scheduled_tasks(limit: int = 50) -> dict[str, Any]:
    """Beat entry point: run every scheduled task whose time has arrived."""
    with session_scope() as session:
        due = connection_workflow.due_tasks(session, limit=limit)
        task_ids = [task.id for task in due]
        for task in due:
            connection_workflow.mark_running(session, task)

    for task_id in task_ids:
        execute_scheduled_task.delay(task_id)
    return {"dispatched": len(task_ids)}


async def run_scheduled_task(
    session, scheduled_task_id: int, *, adapter=None
) -> dict[str, Any]:
    """Advance one due scheduled task. Celery-free, so it is directly testable.

    Raises :class:`AppError` on failure; the Celery wrapper decides whether that
    is worth retrying.
    """
    task = session.get(ScheduledTask, scheduled_task_id)
    if task is None:
        return {"status": "missing"}
    if task.status is ScheduledTaskStatus.CANCELLED:
        return {"status": "cancelled"}

    workflow = session.get(Workflow, task.workflow_id) if task.workflow_id else None
    if workflow is None:
        connection_workflow.mark_finished(
            session, task, ScheduledTaskStatus.FAILED, error_message="Workflow is missing."
        )
        return {"status": "missing_workflow"}

    if workflow.state in TERMINAL_STATES:
        connection_workflow.mark_finished(
            session,
            task,
            ScheduledTaskStatus.SKIPPED,
            result={"reason": f"Workflow already {workflow.state.value}."},
        )
        return {"status": "skipped", "state": workflow.state.value}

    events.emit(
        session,
        EventType.AGENT_LOG,
        f"Scheduled {task.task_type.value} job is due for {workflow.person.full_name}.",
        campaign_id=task.campaign_id,
        person_id=task.person_id,
        workflow_id=workflow.id,
    )

    try:
        outcome = await WorkflowEngine(session, adapter).run(workflow)
    except AppError as exc:
        connection_workflow.mark_finished(
            session,
            task,
            ScheduledTaskStatus.FAILED,
            error_code=exc.code.value,
            error_message=exc.message,
        )
        raise

    if task.status is ScheduledTaskStatus.RUNNING:
        finished = workflow.state in TERMINAL_STATES or workflow.state in (
            WorkflowState.CONNECTION_SENT,
            WorkflowState.COMPLETED,
        )
        result = {"state": workflow.state.value, "detail": outcome.detail}

        if finished:
            connection_workflow.mark_finished(
                session, task, ScheduledTaskStatus.COMPLETED, result=result
            )
        elif task.attempt_count >= MAX_SCHEDULED_TASK_ATTEMPTS:
            connection_workflow.mark_finished(
                session,
                task,
                ScheduledTaskStatus.FAILED,
                result=result,
                error_message=(
                    f"Workflow stalled at {workflow.state.value} after "
                    f"{task.attempt_count} attempts; needs a human."
                ),
            )
            events.emit(
                session,
                EventType.WORKFLOW_FAILED,
                f"Scheduled {task.task_type.value} gave up at "
                f"{workflow.state.value} after {task.attempt_count} attempts.",
                campaign_id=task.campaign_id,
                person_id=task.person_id,
                workflow_id=workflow.id,
                level=LogLevel.ERROR,
            )
        else:
            # Still waiting on something — usually a human approval. Leaving
            # scheduled_at in the past would make every 5-minute beat sweep
            # re-run this forever, burning an AI call each time, so back off.
            when = datetime.now(UTC) + timedelta(
                seconds=retry_delay_seconds(task.attempt_count, base=300, cap=21_600)
            )
            connection_workflow.reschedule(session, task, when)
            task.result = result
            session.flush()

    return {"status": "processed", "state": workflow.state.value}


@celery_app.task(name="app.scheduler.tasks.execute_scheduled_task", bind=True, max_retries=3)
def execute_scheduled_task(self, scheduled_task_id: int) -> dict[str, Any]:
    """Revalidate and, if still eligible, complete the delayed connection."""
    try:
        with session_scope() as session:
            return _run(run_scheduled_task(session, scheduled_task_id))
    except AppError as exc:
        if exc.is_transient and self.request.retries < 3:
            raise self.retry(
                exc=exc, countdown=retry_delay_seconds(self.request.retries + 1)
            ) from exc
        raise


# -------------------------------------------------------------- monitoring --


@celery_app.task(name="app.scheduler.tasks.monitor_candidate")
def monitor_candidate(person_id: int, campaign_id: int) -> dict[str, Any]:
    """Refresh a person's profile and activity between engagement and connection."""
    from app.integrations.platform.factory import adapter_for_campaign

    with session_scope() as session:
        from app.database.models import Person

        person = session.get(Person, person_id)
        if person is None:
            return {"status": "missing"}

        async def _fetch():
            # Resolved and used inside one asyncio.run: an httpx client binds to
            # the loop that first touches it, so building it in a different one
            # would leave an unusable connection pool.
            adapter = await adapter_for_campaign(session, campaign_id)
            return await adapter.get_profile(person.external_id or "")

        try:
            profile = _run(_fetch())
        except AppError as exc:
            events.emit(
                session,
                EventType.AGENT_LOG,
                f"Activity monitor failed for {person.full_name}: {exc.message}",
                campaign_id=campaign_id,
                person_id=person_id,
                level=LogLevel.WARNING,
            )
            return {"status": "error", "code": exc.code.value}

        person.connection_status = profile.connection_status
        person.last_activity_at = profile.last_activity_at or person.last_activity_at
        person.last_synced_at = datetime.now(UTC)
        session.flush()
        return {
            "status": "ok",
            "connection_status": profile.connection_status.value,
            "last_activity_at": (
                person.last_activity_at.isoformat() if person.last_activity_at else None
            ),
        }
