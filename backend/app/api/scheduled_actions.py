from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import DbSession, OwnerScope, Pagination
from app.database.models import Campaign, Person, ScheduledTask
from app.enums import ScheduledTaskStatus, ScheduledTaskType
from app.errors import ConflictError, NotFoundError, ValidationError
from app.schemas.common import Page
from app.schemas.engagement import (
    PersonSummary,
    RescheduleRequest,
    ScheduledActionDetail,
    ScheduledActionRead,
)
from app.services import scoping
from app.services.dispatch import dispatch_scheduled_task
from app.workflows import connection as connection_workflow

router = APIRouter(prefix="/scheduled-actions", tags=["scheduled-actions"])


def _to_detail(session: Session, task: ScheduledTask) -> ScheduledActionDetail:
    person = session.get(Person, task.person_id) if task.person_id else None
    campaign = session.get(Campaign, task.campaign_id)
    return ScheduledActionDetail(
        **ScheduledActionRead.model_validate(task).model_dump(),
        person=PersonSummary.model_validate(person) if person else None,
        campaign_name=campaign.name if campaign else "",
    )


def _get(session: Session, task_id: int, owner_id: int | None) -> ScheduledTask:
    task = session.scalar(
        scoping.restrict(
            select(ScheduledTask).where(ScheduledTask.id == task_id),
            ScheduledTask.campaign_id,
            owner_id,
        )
    )
    if task is None:
        raise NotFoundError(f"Scheduled action {task_id} not found.")
    return task


@router.get("", response_model=Page[ScheduledActionDetail])
def list_scheduled_actions(
    session: DbSession,
    pagination: Pagination,
    owner_id: OwnerScope,
    campaign_id: int | None = Query(default=None),
    task_status: ScheduledTaskStatus | None = Query(default=None, alias="status"),
    task_type: ScheduledTaskType | None = Query(default=None, alias="type"),
) -> Page[ScheduledActionDetail]:
    stmt = scoping.restrict(select(ScheduledTask), ScheduledTask.campaign_id, owner_id)
    count_stmt = scoping.restrict(
        select(func.count()).select_from(ScheduledTask), ScheduledTask.campaign_id, owner_id
    )

    conditions = []
    if campaign_id is not None:
        conditions.append(ScheduledTask.campaign_id == campaign_id)
    if task_status is not None:
        conditions.append(ScheduledTask.status == task_status)
    if task_type is not None:
        conditions.append(ScheduledTask.task_type == task_type)
    for condition in conditions:
        stmt = stmt.where(condition)
        count_stmt = count_stmt.where(condition)

    total = session.scalar(count_stmt) or 0
    tasks = list(
        session.scalars(
            stmt.order_by(ScheduledTask.scheduled_at)
            .offset(pagination.offset)
            .limit(pagination.page_size)
        )
    )
    return Page[ScheduledActionDetail](
        items=[_to_detail(session, task) for task in tasks],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.get("/{task_id}", response_model=ScheduledActionDetail)
def get_scheduled_action(
    session: DbSession, task_id: int, owner_id: OwnerScope
) -> ScheduledActionDetail:
    return _to_detail(session, _get(session, task_id, owner_id))


@router.post("/{task_id}/cancel", response_model=ScheduledActionDetail)
def cancel_scheduled_action(
    session: DbSession, task_id: int, owner_id: OwnerScope
) -> ScheduledActionDetail:
    task = _get(session, task_id, owner_id)
    if task.status not in (ScheduledTaskStatus.SCHEDULED, ScheduledTaskStatus.RUNNING):
        raise ConflictError(f"Scheduled action is {task.status.value}; nothing to cancel.")
    connection_workflow.cancel(session, task)
    return _to_detail(session, task)


@router.post("/{task_id}/reschedule", response_model=ScheduledActionDetail)
def reschedule_scheduled_action(
    session: DbSession, task_id: int, payload: RescheduleRequest, owner_id: OwnerScope
) -> ScheduledActionDetail:
    task = _get(session, task_id, owner_id)
    if task.status is ScheduledTaskStatus.COMPLETED:
        raise ConflictError("A completed action cannot be rescheduled.")

    when = payload.scheduled_at
    if when.tzinfo is None:
        when = when.replace(tzinfo=UTC)
    if when < datetime.now(UTC):
        raise ValidationError("Reschedule time must be in the future.")

    connection_workflow.reschedule(session, task, when)
    return _to_detail(session, task)


@router.post("/{task_id}/run-now", response_model=ScheduledActionDetail)
def run_scheduled_action_now(
    session: DbSession, task_id: int, owner_id: OwnerScope
) -> ScheduledActionDetail:
    task = _get(session, task_id, owner_id)
    if task.status is not ScheduledTaskStatus.SCHEDULED:
        raise ConflictError(f"Scheduled action is {task.status.value}; nothing to run.")

    connection_workflow.reschedule(session, task, datetime.now(UTC))
    detail = _to_detail(session, task)
    session.commit()
    dispatch_scheduled_task(task.id)
    return detail
