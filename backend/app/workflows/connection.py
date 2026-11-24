"""Due-date handling for the delayed connection job."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database.models import ScheduledTask
from app.enums import ScheduledTaskStatus, ScheduledTaskType


def due_tasks(
    session: Session,
    *,
    task_type: ScheduledTaskType = ScheduledTaskType.CONNECTION,
    now: datetime | None = None,
    limit: int = 50,
) -> list[ScheduledTask]:
    """Scheduled tasks whose time has come, locked against concurrent workers."""
    moment = now or datetime.now(UTC)
    stmt = (
        select(ScheduledTask)
        .where(
            ScheduledTask.task_type == task_type,
            ScheduledTask.status == ScheduledTaskStatus.SCHEDULED,
            ScheduledTask.scheduled_at <= moment,
        )
        .order_by(ScheduledTask.scheduled_at)
        .limit(limit)
        .with_for_update(skip_locked=True)
    )
    return list(session.scalars(stmt))


def mark_running(session: Session, task: ScheduledTask) -> None:
    task.status = ScheduledTaskStatus.RUNNING
    task.attempt_count += 1
    session.flush()


def mark_finished(
    session: Session,
    task: ScheduledTask,
    status: ScheduledTaskStatus,
    *,
    result: dict | None = None,
    error_code: str | None = None,
    error_message: str | None = None,
) -> None:
    task.status = status
    task.executed_at = datetime.now(UTC)
    task.result = result
    task.error_code = error_code
    task.error_message = error_message
    session.flush()


def reschedule(session: Session, task: ScheduledTask, when: datetime) -> None:
    task.scheduled_at = when
    task.status = ScheduledTaskStatus.SCHEDULED
    task.error_code = None
    task.error_message = None
    session.flush()


def cancel(session: Session, task: ScheduledTask) -> None:
    task.status = ScheduledTaskStatus.CANCELLED
    task.executed_at = datetime.now(UTC)
    session.flush()
