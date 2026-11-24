"""Celery application.

Multi-day waits live in the ``scheduled_tasks`` table, not in worker memory. A
beat task sweeps for due rows, so nothing is lost when a worker restarts.
"""

from __future__ import annotations

from celery import Celery
from celery.schedules import crontab

from app.config import settings
from app.logging import configure_logging

configure_logging()

celery_app = Celery(
    "linkedin_agent",
    broker=settings.broker_url,
    backend=settings.result_backend,
    include=["app.scheduler.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_time_limit=15 * 60,
    task_soft_time_limit=13 * 60,
    result_expires=7 * 24 * 3600,
    broker_connection_retry_on_startup=True,
    # Tests and single-process development run tasks inline.
    task_always_eager=settings.celery_task_always_eager,
    task_eager_propagates=settings.celery_task_always_eager,
)

celery_app.conf.beat_schedule = {
    "process-due-scheduled-tasks": {
        "task": "app.scheduler.tasks.process_due_scheduled_tasks",
        "schedule": crontab(minute="*/5"),
    },
    "tick-running-campaigns": {
        "task": "app.scheduler.tasks.tick_running_campaigns",
        "schedule": crontab(minute="*/15"),
    },
}
