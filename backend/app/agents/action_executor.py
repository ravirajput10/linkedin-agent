"""The only component allowed to cause an external side effect.

Every call goes through :meth:`ActionExecutor.execute`, which:

1. looks up or creates an ``actions`` row keyed by a deterministic idempotency key
2. returns immediately if that action already succeeded
3. checks the campaign's daily rate limit
4. short-circuits in dry-run mode, recording what *would* have happened
5. calls the platform adapter
6. persists the outcome and consumes the rate-limit budget
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.agents import policies
from app.database.models import Action, Campaign, Person, Post
from app.enums import ActionStatus, ActionType, EventType, LogLevel
from app.errors import AppError, ErrorCode, PlatformError, RateLimitReachedError
from app.integrations.platform.base import ActionOutcome, SocialPlatformAdapter
from app.logging import get_logger
from app.services import events, rate_limiter

logger = get_logger(__name__)


def build_idempotency_key(
    action_type: ActionType,
    campaign_id: int,
    *,
    person_id: int | None = None,
    post_id: int | None = None,
    discriminator: str | None = None,
) -> str:
    """Stable across restarts, so a replayed step finds its previous attempt."""
    parts = [action_type.value, f"c{campaign_id}"]
    if person_id is not None:
        parts.append(f"p{person_id}")
    if post_id is not None:
        parts.append(f"o{post_id}")
    if discriminator:
        parts.append(discriminator)
    return ":".join(parts)


@dataclass(slots=True)
class ExecutionResult:
    action: Action
    executed: bool
    skipped_reason: str | None = None

    @property
    def succeeded(self) -> bool:
        return self.action.status in (ActionStatus.SUCCESS, ActionStatus.SKIPPED_DRY_RUN)

    @property
    def is_dry_run(self) -> bool:
        return self.action.status is ActionStatus.SKIPPED_DRY_RUN


class ActionExecutor:
    def __init__(
        self,
        session: Session,
        adapter: SocialPlatformAdapter,
        *,
        max_attempts: int = 3,
    ) -> None:
        self.session = session
        self.adapter = adapter
        self.max_attempts = max_attempts

    # -- public -------------------------------------------------------------

    async def like_post(
        self, campaign: Campaign, person: Person, post: Post, *, workflow_id: int | None = None
    ) -> ExecutionResult:
        return await self.execute(
            ActionType.LIKE_POST,
            campaign,
            person=person,
            post=post,
            workflow_id=workflow_id,
            payload={"post_external_id": post.external_id},
        )

    async def comment_on_post(
        self,
        campaign: Campaign,
        person: Person,
        post: Post,
        text: str,
        *,
        workflow_id: int | None = None,
    ) -> ExecutionResult:
        return await self.execute(
            ActionType.COMMENT_POST,
            campaign,
            person=person,
            post=post,
            workflow_id=workflow_id,
            payload={"post_external_id": post.external_id, "text": text},
        )

    async def send_connection(
        self,
        campaign: Campaign,
        person: Person,
        message: str | None,
        *,
        workflow_id: int | None = None,
    ) -> ExecutionResult:
        return await self.execute(
            ActionType.SEND_CONNECTION,
            campaign,
            person=person,
            workflow_id=workflow_id,
            payload={"person_external_id": person.external_id, "message": message},
        )

    # -- core ---------------------------------------------------------------

    async def execute(
        self,
        action_type: ActionType,
        campaign: Campaign,
        *,
        person: Person | None = None,
        post: Post | None = None,
        workflow_id: int | None = None,
        payload: dict[str, Any] | None = None,
        discriminator: str | None = None,
    ) -> ExecutionResult:
        key = build_idempotency_key(
            action_type,
            campaign.id,
            person_id=person.id if person else None,
            post_id=post.id if post else None,
            discriminator=discriminator,
        )
        action = self._get_or_create(
            key,
            action_type,
            campaign,
            person=person,
            post=post,
            workflow_id=workflow_id,
            payload=payload,
        )

        if action.status in (ActionStatus.SUCCESS, ActionStatus.SKIPPED_DRY_RUN):
            logger.info("Action %s already completed; skipping.", key)
            return ExecutionResult(action, executed=False, skipped_reason="Already completed.")

        if action.status is ActionStatus.CANCELLED:
            return ExecutionResult(action, executed=False, skipped_reason="Action was cancelled.")

        if action.attempt_count >= self.max_attempts:
            return ExecutionResult(
                action,
                executed=False,
                skipped_reason=f"Exhausted {self.max_attempts} attempts.",
            )

        limit = rate_limiter.check_action(self.session, campaign, action_type)
        if not limit.allowed:
            action.status = ActionStatus.FAILED
            action.error_code = ErrorCode.RATE_LIMIT_REACHED.value
            action.error_message = limit.reason
            self.session.flush()
            raise RateLimitReachedError(
                limit.reason or "Daily limit reached.",
                details={"counter": limit.counter, "used": limit.used, "limit": limit.limit},
            )

        action.status = ActionStatus.RUNNING
        action.attempt_count += 1
        self.session.flush()

        events.emit(
            self.session,
            EventType.ACTION_STARTED,
            f"{action_type.value} starting"
            + (f" for {person.full_name}" if person else "")
            + (" (dry run)" if campaign.dry_run else ""),
            campaign_id=campaign.id,
            person_id=person.id if person else None,
            workflow_id=workflow_id,
            payload={"action_type": action_type.value, "action_id": action.id},
        )

        if campaign.dry_run:
            return self._complete_dry_run(action, campaign, person, workflow_id, payload)

        try:
            outcome = await self._dispatch(action_type, payload or {})
        except PlatformError as exc:
            return self._fail(action, campaign, person, workflow_id, exc)
        except AppError as exc:
            return self._fail(action, campaign, person, workflow_id, exc)

        return self._complete(action, campaign, person, workflow_id, outcome)

    # -- internals ----------------------------------------------------------

    def _get_or_create(
        self,
        key: str,
        action_type: ActionType,
        campaign: Campaign,
        *,
        person: Person | None,
        post: Post | None,
        workflow_id: int | None,
        payload: dict[str, Any] | None,
    ) -> Action:
        existing = self.session.scalar(select(Action).where(Action.idempotency_key == key))
        if existing is not None:
            return existing

        action = Action(
            campaign_id=campaign.id,
            person_id=person.id if person else None,
            post_id=post.id if post else None,
            workflow_id=workflow_id,
            action_type=action_type,
            status=ActionStatus.PENDING,
            idempotency_key=key,
            dry_run=campaign.dry_run,
            payload=payload,
        )
        self.session.add(action)
        try:
            self.session.flush()
        except IntegrityError:
            # Another worker created it between the SELECT and the INSERT.
            self.session.rollback()
            found = self.session.scalar(select(Action).where(Action.idempotency_key == key))
            if found is None:
                raise
            return found
        return action

    async def _dispatch(self, action_type: ActionType, payload: dict[str, Any]) -> ActionOutcome:
        match action_type:
            case ActionType.LIKE_POST:
                return await self.adapter.like_post(payload["post_external_id"])
            case ActionType.COMMENT_POST:
                return await self.adapter.comment_on_post(
                    payload["post_external_id"], payload["text"]
                )
            case ActionType.SEND_CONNECTION:
                return await self.adapter.send_connection(
                    payload["person_external_id"], payload.get("message")
                )
        raise AppError(f"No dispatch for action type {action_type}.")

    def _complete_dry_run(
        self,
        action: Action,
        campaign: Campaign,
        person: Person | None,
        workflow_id: int | None,
        payload: dict[str, Any] | None,
    ) -> ExecutionResult:
        action.status = ActionStatus.SKIPPED_DRY_RUN
        action.executed_at = datetime.now(UTC)
        action.result = {"dry_run": True, "would_have": payload}
        self.session.flush()

        events.emit(
            self.session,
            EventType.ACTION_COMPLETED,
            f"DRY RUN — would {_verb(action.action_type)}"
            + (f" for {person.full_name}" if person else ""),
            campaign_id=campaign.id,
            person_id=person.id if person else None,
            workflow_id=workflow_id,
            payload={"action_type": action.action_type.value, "dry_run": True},
        )
        return ExecutionResult(action, executed=True)

    def _complete(
        self,
        action: Action,
        campaign: Campaign,
        person: Person | None,
        workflow_id: int | None,
        outcome: ActionOutcome,
    ) -> ExecutionResult:
        action.status = ActionStatus.SUCCESS if outcome.success else ActionStatus.FAILED
        action.executed_at = datetime.now(UTC)
        action.external_id = outcome.external_id
        action.result = outcome.model_dump()
        if not outcome.success:
            action.error_message = outcome.detail
        self.session.flush()

        if outcome.success and not outcome.already_done:
            rate_limiter.consume_action(self.session, campaign.id, action.action_type)

        events.emit(
            self.session,
            EventType.ACTION_COMPLETED,
            f"{_verb(action.action_type).capitalize()}"
            + (f" for {person.full_name}" if person else "")
            + (" (already done)" if outcome.already_done else ""),
            campaign_id=campaign.id,
            person_id=person.id if person else None,
            workflow_id=workflow_id,
            level=LogLevel.INFO if outcome.success else LogLevel.WARNING,
            payload={
                "action_type": action.action_type.value,
                "external_id": outcome.external_id,
                "already_done": outcome.already_done,
            },
        )
        return ExecutionResult(action, executed=True)

    def _fail(
        self,
        action: Action,
        campaign: Campaign,
        person: Person | None,
        workflow_id: int | None,
        exc: AppError,
    ) -> ExecutionResult:
        action.status = ActionStatus.FAILED
        action.executed_at = datetime.now(UTC)
        action.error_code = exc.code.value
        action.error_message = exc.message
        self.session.flush()

        rate_limiter.record_failure(self.session, campaign.id)
        events.emit(
            self.session,
            EventType.ACTION_COMPLETED,
            f"{action.action_type.value} failed: {exc.message}",
            campaign_id=campaign.id,
            person_id=person.id if person else None,
            workflow_id=workflow_id,
            level=LogLevel.ERROR,
            payload={
                "action_type": action.action_type.value,
                "error_code": exc.code.value,
                "attempt": action.attempt_count,
                "retry_in_seconds": policies.retry_delay_seconds(action.attempt_count)
                if exc.is_transient
                else None,
            },
        )
        return ExecutionResult(action, executed=True, skipped_reason=exc.message)


def _verb(action_type: ActionType) -> str:
    return {
        ActionType.LIKE_POST: "like the post",
        ActionType.COMMENT_POST: "post the comment",
        ActionType.SEND_CONNECTION: "send the connection request",
    }[action_type]
