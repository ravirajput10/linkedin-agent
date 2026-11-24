"""Scheduled-task lifecycle, against PostgreSQL.

These cover the behaviour that only showed up once a real Celery broker was
running: an unfinished workflow used to put its task back to SCHEDULED with a
due date still in the past, so every beat sweep re-ran it forever.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.database.models import (
    Campaign,
    CampaignCriteria,
    Person,
    ScheduledTask,
    Workflow,
)
from app.enums import (
    CampaignStatus,
    ScheduledTaskStatus,
    ScheduledTaskType,
    WorkflowState,
)
from app.scheduler.tasks import MAX_SCHEDULED_TASK_ATTEMPTS, run_scheduled_task
from app.workflows import connection as connection_workflow

pytestmark = pytest.mark.integration


def make_due_task(db, state: WorkflowState, *, attempts: int = 0) -> ScheduledTask:
    campaign = Campaign(
        name="Scheduler test",
        status=CampaignStatus.RUNNING,
        dry_run=True,
        instruction="x" * 20,
    )
    db.add(campaign)
    db.flush()
    db.add(CampaignCriteria(campaign_id=campaign.id))
    person = Person(
        platform="mock",
        external_id="mock-p-001",
        profile_url="https://mock.local/in/p1",
        full_name="Ananya Rao",
    )
    db.add(person)
    db.flush()
    workflow = Workflow(
        campaign_id=campaign.id, person_id=person.id, state=state, context={}
    )
    db.add(workflow)
    db.flush()
    task = ScheduledTask(
        campaign_id=campaign.id,
        person_id=person.id,
        workflow_id=workflow.id,
        task_type=ScheduledTaskType.CONNECTION,
        status=ScheduledTaskStatus.SCHEDULED,
        scheduled_at=datetime.now(UTC) - timedelta(minutes=5),
        attempt_count=attempts,
    )
    db.add(task)
    db.flush()
    return task


def test_due_tasks_are_found_and_locked(db) -> None:
    task = make_due_task(db, WorkflowState.WAITING_FOR_CONNECTION)
    due = connection_workflow.due_tasks(db)
    assert task.id in {item.id for item in due}


def test_tasks_not_yet_due_are_left_alone(db) -> None:
    task = make_due_task(db, WorkflowState.WAITING_FOR_CONNECTION)
    task.scheduled_at = datetime.now(UTC) + timedelta(hours=12)
    db.flush()
    assert task.id not in {item.id for item in connection_workflow.due_tasks(db)}


async def test_a_terminal_workflow_completes_its_task(db) -> None:
    task = make_due_task(db, WorkflowState.COMPLETED)
    connection_workflow.mark_running(db, task)
    db.flush()

    await run_scheduled_task(db, task.id)
    db.refresh(task)
    assert task.status is ScheduledTaskStatus.SKIPPED


async def test_an_unfinished_workflow_backs_off_instead_of_re_running_forever(db) -> None:
    """The bug a live broker exposed: due date stayed in the past."""
    task = make_due_task(db, WorkflowState.WAITING_FOR_CONNECTION)
    connection_workflow.mark_running(db, task)
    task.attempt_count = 2
    db.flush()

    before = datetime.now(UTC)
    await run_scheduled_task(db, task.id)
    db.refresh(task)

    assert task.status is ScheduledTaskStatus.SCHEDULED
    due = task.scheduled_at
    if due.tzinfo is None:
        due = due.replace(tzinfo=UTC)
    assert due > before, "must move into the future, or beat re-runs it every sweep"


async def test_a_stuck_task_eventually_gives_up(db) -> None:
    task = make_due_task(
        db, WorkflowState.WAITING_FOR_CONNECTION, attempts=MAX_SCHEDULED_TASK_ATTEMPTS
    )
    connection_workflow.mark_running(db, task)
    db.flush()

    await run_scheduled_task(db, task.id)
    db.refresh(task)

    assert task.status is ScheduledTaskStatus.FAILED
    assert "needs a human" in (task.error_message or "")


async def test_a_cancelled_task_is_not_executed(db) -> None:
    task = make_due_task(db, WorkflowState.WAITING_FOR_CONNECTION)
    connection_workflow.cancel(db, task)
    db.flush()

    assert await run_scheduled_task(db, task.id) == {"status": "cancelled"}


def test_rescheduling_clears_a_previous_error(db) -> None:
    task = make_due_task(db, WorkflowState.WAITING_FOR_CONNECTION)
    connection_workflow.mark_finished(
        db, task, ScheduledTaskStatus.FAILED, error_code="X", error_message="boom"
    )
    connection_workflow.reschedule(db, task, datetime.now(UTC) + timedelta(hours=1))

    assert task.status is ScheduledTaskStatus.SCHEDULED
    assert task.error_code is None and task.error_message is None
