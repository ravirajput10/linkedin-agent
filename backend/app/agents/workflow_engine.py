"""The deterministic workflow engine.

The engine owns control flow. It reads the persisted state, decides the single
next step, calls the AI only where reasoning is genuinely needed, validates what
comes back, applies a policy check, executes through the action executor, and
persists the new state before returning.

It never loops on model output, and it never resumes work it has already done —
a restart mid-campaign picks up from the last persisted state.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum, auto
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agents import policies
from app.agents.action_executor import ActionExecutor
from app.ai.agents import (
    CandidateEvaluatorAgent,
    CommentGeneratorAgent,
    ConnectionGeneratorAgent,
    PostEvaluatorAgent,
)
from app.config import settings
from app.database.models import (
    Approval,
    CandidateEvaluation,
    Comment,
    ConnectionMessage,
    Person,
    Post,
    PostEvaluation,
    ScheduledTask,
    Workflow,
    WorkflowStep,
)
from app.enums import (
    TERMINAL_STATES,
    ActionType,
    ApprovalStatus,
    ApprovalType,
    ConnectionMessageMode,
    ConnectionStatus,
    EventType,
    LogLevel,
    PostProcessingStatus,
    ScheduledTaskStatus,
    ScheduledTaskType,
    WorkflowState,
)
from app.errors import AppError, ErrorCode, RateLimitReachedError
from app.integrations.platform.base import SocialPlatformAdapter
from app.integrations.platform.factory import (
    get_platform_adapter,
    requires_connected_account,
)
from app.logging import get_logger
from app.services import events, rate_limiter
from app.workflows.discovery import sync_posts_for_person

logger = get_logger(__name__)


class StepStatus(StrEnum):
    CONTINUE = auto()
    WAITING_APPROVAL = auto()
    WAITING_TIMER = auto()
    TERMINAL = auto()
    FAILED = auto()


@dataclass(slots=True)
class StepOutcome:
    status: StepStatus
    state: WorkflowState
    detail: str = ""

    @property
    def should_continue(self) -> bool:
        return self.status is StepStatus.CONTINUE


class WorkflowEngine:
    def __init__(
        self,
        session: Session,
        adapter: SocialPlatformAdapter | None = None,
        *,
        agent_run_id: int | None = None,
    ) -> None:
        self.session = session
        # Falling back to the server-wide adapter is safe only when it has no
        # member identity. With Unipile active it would act as whichever
        # account is in the environment, so refuse instead of guessing: the
        # caller knows whose campaign this is, and this class does not.
        if adapter is None and requires_connected_account():
            raise AppError(
                "WorkflowEngine needs the campaign owner's adapter. "
                "Resolve it with factory.adapter_for_campaign().",
                code=ErrorCode.INTERNAL_ERROR,
                http_status=500,
            )
        self.adapter = adapter or get_platform_adapter()
        self.agent_run_id = agent_run_id
        self.executor = ActionExecutor(
            session, self.adapter, max_attempts=settings.max_action_attempts
        )
        self.candidate_evaluator = CandidateEvaluatorAgent()
        self.post_evaluator = PostEvaluatorAgent()
        self.comment_generator = CommentGeneratorAgent()
        self.connection_generator = ConnectionGeneratorAgent()

    # ------------------------------------------------------------- driving --

    async def run(self, workflow: Workflow, *, max_steps: int = 40) -> StepOutcome:
        """Advance until the workflow blocks, completes or fails.

        ``max_steps`` is a safety rail against a transition bug spinning; it is
        not the workflow's logic.
        """
        outcome = StepOutcome(StepStatus.CONTINUE, workflow.state)
        for _ in range(max_steps):
            outcome = await self.advance(workflow)
            if not outcome.should_continue:
                return outcome
        logger.warning("Workflow %s hit the step ceiling in one run.", workflow.id)
        return outcome

    async def advance(self, workflow: Workflow) -> StepOutcome:
        """Execute exactly one step from the current persisted state."""
        if workflow.state in TERMINAL_STATES:
            return StepOutcome(StepStatus.TERMINAL, workflow.state, "Workflow already finished.")

        campaign = workflow.campaign
        can_act = policies.campaign_can_act(campaign)
        if not can_act:
            return StepOutcome(StepStatus.WAITING_TIMER, workflow.state, can_act.reason)

        handler = self._handlers().get(workflow.state)
        if handler is None:
            return self._fail(
                workflow,
                AppError(
                    f"No handler for workflow state {workflow.state.value}.",
                    code=ErrorCode.INVALID_STATE_TRANSITION,
                ),
            )

        started = time.perf_counter()
        try:
            outcome = await handler(workflow)
        except RateLimitReachedError as exc:
            events.emit(
                self.session,
                EventType.AGENT_LOG,
                f"Paused: {exc.message}",
                campaign_id=campaign.id,
                person_id=workflow.person_id,
                workflow_id=workflow.id,
                level=LogLevel.WARNING,
                agent_run_id=self.agent_run_id,
            )
            return StepOutcome(StepStatus.WAITING_TIMER, workflow.state, exc.message)
        except AppError as exc:
            return self._fail(workflow, exc)
        except Exception as exc:
            logger.exception("Unhandled error advancing workflow %s", workflow.id)
            return self._fail(workflow, AppError(str(exc)))

        if workflow.steps:
            workflow.steps[-1].duration_ms = int((time.perf_counter() - started) * 1000)

        if outcome.should_continue:
            workflow.consecutive_failures = 0
        self.session.flush()
        return outcome

    def _handlers(self) -> dict[WorkflowState, Any]:
        return {
            WorkflowState.DISCOVERING: self._handle_candidate_found,
            WorkflowState.CANDIDATE_FOUND: self._handle_candidate_found,
            WorkflowState.EVALUATING_CANDIDATE: self._handle_candidate_found,
            WorkflowState.CANDIDATE_ACCEPTED: self._handle_find_posts,
            WorkflowState.FINDING_POSTS: self._handle_find_posts,
            WorkflowState.POST_1_FOUND: self._handle_like_step,
            WorkflowState.POST_1_LIKED: self._handle_next_after_like,
            WorkflowState.POST_2_FOUND: self._handle_like_step,
            WorkflowState.POST_2_LIKED: self._handle_next_after_like,
            WorkflowState.POST_3_FOUND: self._handle_evaluate_post,
            WorkflowState.POST_3_EVALUATING: self._handle_evaluate_post,
            WorkflowState.POST_3_ACCEPTED: self._handle_like_evaluated_post,
            WorkflowState.POST_3_REJECTED: self._handle_schedule_connection,
            WorkflowState.POST_3_LIKED: self._handle_generate_comment,
            WorkflowState.COMMENT_GENERATED: self._handle_comment_decision,
            WorkflowState.COMMENT_PENDING_APPROVAL: self._handle_comment_approval,
            WorkflowState.COMMENT_POSTED: self._handle_schedule_connection,
            WorkflowState.COMMENT_REJECTED: self._handle_schedule_connection,
            WorkflowState.CONNECTION_SCHEDULED: self._handle_wait_for_connection,
            WorkflowState.WAITING_FOR_CONNECTION: self._handle_wait_for_connection,
            WorkflowState.REVALIDATING: self._handle_revalidate,
            WorkflowState.CONNECTION_PENDING_APPROVAL: self._handle_connection_approval,
            WorkflowState.CONNECTION_READY: self._handle_send_connection,
            WorkflowState.CONNECTION_SENT: self._handle_complete,
        }

    # ------------------------------------------------------------ handlers --

    async def _enrich_person(self, person: Person) -> None:
        """Fill in the profile before judging it.

        Search results are thin — Unipile returns a headline and little else, no
        company, industry or summary. Evaluating on that makes the AI flag
        insufficient_data and reject people who plainly match, so the full
        profile is fetched once, on the candidates actually about to be scored.
        """
        if person.company and person.about:
            return
        if not person.external_id:
            return

        try:
            profile = await self.adapter.get_profile(person.external_id)
        except AppError as exc:
            logger.warning(
                "Could not enrich %s before evaluation: %s", person.full_name, exc.message
            )
            return

        person.headline = profile.headline or person.headline
        person.job_title = profile.job_title or person.job_title
        person.company = profile.company or person.company
        person.industry = profile.industry or person.industry
        person.location = profile.location or person.location
        person.about = profile.about or person.about
        person.connection_status = profile.connection_status
        person.last_synced_at = datetime.now(UTC)
        self.session.flush()

    async def _handle_candidate_found(self, workflow: Workflow) -> StepOutcome:
        campaign, person = workflow.campaign, workflow.person

        exclusion = policies.person_excluded(campaign, person)
        if exclusion.allowed:
            return self._transition(
                workflow, WorkflowState.CANDIDATE_REJECTED, exclusion.reason, StepStatus.TERMINAL
            )

        existing = self.session.scalar(
            select(CandidateEvaluation)
            .where(
                CandidateEvaluation.campaign_id == campaign.id,
                CandidateEvaluation.person_id == person.id,
            )
            .order_by(CandidateEvaluation.id.desc())
        )

        if existing is None:
            self._transition(workflow, WorkflowState.EVALUATING_CANDIDATE, "Evaluating candidate.")
            await self._enrich_person(person)
            result = await self.candidate_evaluator.run(
                session=self.session,
                campaign_id=campaign.id,
                person_id=person.id,
                workflow_id=workflow.id,
                person=person,
                campaign=campaign,
                discovery_reason=self._discovery_reason(campaign.id, person.id),
            )
            existing = CandidateEvaluation(
                campaign_id=campaign.id,
                person_id=person.id,
                is_match=result.data.match,
                score=result.data.score,
                matched_criteria=result.data.matched_criteria,
                reason=result.data.reason,
                risk_flags=result.data.risk_flags,
                **result.audit_fields,
                raw_output=result.data.model_dump(mode="json", by_alias=True),
            )
            self.session.add(existing)
            self.session.flush()

            link = self._person_link(campaign.id, person.id)
            if link is not None:
                link.match_score = result.data.score
                link.matched_criteria = result.data.matched_criteria

            events.emit(
                self.session,
                EventType.CANDIDATE_EVALUATED,
                f"{person.full_name} scored {result.data.score}/100",
                campaign_id=campaign.id,
                person_id=person.id,
                workflow_id=workflow.id,
                agent_run_id=self.agent_run_id,
                payload={
                    "score": result.data.score,
                    "match": result.data.match,
                    "matched_criteria": result.data.matched_criteria,
                },
            )

        decision = policies.candidate_accepted(existing, campaign.criteria)
        if not decision:
            return self._transition(
                workflow, WorkflowState.CANDIDATE_REJECTED, decision.reason, StepStatus.TERMINAL
            )

        if policies.approval_required(campaign.criteria, ApprovalType.CANDIDATE):
            approval = self._ensure_approval(
                workflow,
                ApprovalType.CANDIDATE,
                proposed_action="ENGAGE_CANDIDATE",
                ai_reasoning=existing.reason,
                ai_score=existing.score,
                content=None,
            )
            if approval.status is ApprovalStatus.PENDING:
                return StepOutcome(
                    StepStatus.WAITING_APPROVAL,
                    workflow.state,
                    "Waiting for candidate approval.",
                )
            if approval.status is not ApprovalStatus.APPROVED:
                return self._transition(
                    workflow,
                    WorkflowState.CANDIDATE_REJECTED,
                    "Candidate rejected by reviewer.",
                    StepStatus.TERMINAL,
                )

        rate_limiter.consume_person(self.session, campaign.id)
        return self._transition(workflow, WorkflowState.CANDIDATE_ACCEPTED, decision.reason)

    async def _handle_find_posts(self, workflow: Workflow) -> StepOutcome:
        campaign, person = workflow.campaign, workflow.person
        self._transition(workflow, WorkflowState.FINDING_POSTS, "Discovering posts.")

        needed = campaign.criteria.initial_posts_to_like + 1
        eligible = await sync_posts_for_person(
            self.session,
            adapter=self.adapter,
            campaign=campaign,
            person=person,
            limit=max(needed * 4, 20),
        )

        if not eligible:
            return self._transition(
                workflow,
                WorkflowState.SKIPPED,
                "No eligible posts found for this person.",
                StepStatus.TERMINAL,
            )

        workflow.context = {
            **workflow.context,
            "eligible_post_ids": [post.id for post in eligible],
            "likes_done": 0,
        }
        events.emit(
            self.session,
            EventType.POST_FOUND,
            f"{len(eligible)} eligible posts found for {person.full_name}",
            campaign_id=campaign.id,
            person_id=person.id,
            workflow_id=workflow.id,
            agent_run_id=self.agent_run_id,
            payload={"eligible_count": len(eligible)},
        )
        return self._transition(
            workflow, self._like_state(0, found=True), f"{len(eligible)} eligible posts."
        )

    async def _handle_like_step(self, workflow: Workflow) -> StepOutcome:
        campaign, person = workflow.campaign, workflow.person
        likes_done = int(workflow.context.get("likes_done", 0))
        post = self._post_at(workflow, likes_done)

        if post is None:
            if likes_done > 0:
                return self._transition(
                    workflow,
                    WorkflowState.CONNECTION_SCHEDULED,
                    f"Ran out of eligible posts after {likes_done} likes; advancing to connection.",
                )
            return self._transition(
                workflow,
                WorkflowState.SKIPPED,
                f"Ran out of eligible posts after {likes_done} likes.",
                StepStatus.TERMINAL,
            )

        result = await self.executor.like_post(campaign, person, post, workflow_id=workflow.id)
        if not result.succeeded:
            raise AppError(
                result.skipped_reason or "Like failed.", code=ErrorCode.LIKE_FAILED
            )

        post.processing_status = (
            PostProcessingStatus.WOULD_LIKE if result.is_dry_run else PostProcessingStatus.LIKED
        )
        workflow.context = {**workflow.context, "likes_done": likes_done + 1}
        self.session.flush()

        return self._transition(
            workflow,
            self._like_state(likes_done, found=False),
            f"Liked post {likes_done + 1}"
            + (" (dry run)" if result.is_dry_run else "")
            + ".",
        )

    async def _handle_next_after_like(self, workflow: Workflow) -> StepOutcome:
        criteria = workflow.campaign.criteria
        likes_done = int(workflow.context.get("likes_done", 0))

        if likes_done < criteria.initial_posts_to_like:
            return self._transition(
                workflow,
                self._like_state(likes_done, found=True),
                f"Moving to post {likes_done + 1}.",
            )

        post = self._post_at(workflow, likes_done)
        if post is None:
            if likes_done > 0:
                return self._transition(
                    workflow,
                    WorkflowState.CONNECTION_SCHEDULED,
                    f"Completed {likes_done} like(s). No additional post for comment; advancing to connection.",
                )
            return self._transition(
                workflow,
                WorkflowState.SKIPPED,
                "No post available for AI evaluation.",
                StepStatus.TERMINAL,
            )
        return self._transition(
            workflow, WorkflowState.POST_3_FOUND, "Post selected for AI evaluation."
        )

    async def _handle_evaluate_post(self, workflow: Workflow) -> StepOutcome:
        campaign, person = workflow.campaign, workflow.person
        likes_done = int(workflow.context.get("likes_done", 0))
        post = self._post_at(workflow, likes_done)
        if post is None:
            return self._transition(
                workflow, WorkflowState.SKIPPED, "No post to evaluate.", StepStatus.TERMINAL
            )

        self._transition(workflow, WorkflowState.POST_3_EVALUATING, "Evaluating post with AI.")

        evaluation = self.session.scalar(
            select(PostEvaluation)
            .where(PostEvaluation.post_id == post.id, PostEvaluation.campaign_id == campaign.id)
            .order_by(PostEvaluation.id.desc())
        )
        if evaluation is None:
            result = await self.post_evaluator.run(
                session=self.session,
                campaign_id=campaign.id,
                person_id=person.id,
                workflow_id=workflow.id,
                post=post,
                person=person,
                campaign=campaign,
            )
            evaluation = PostEvaluation(
                post_id=post.id,
                campaign_id=campaign.id,
                eligible=result.data.eligible,
                relevance_score=result.data.relevance_score,
                topics=result.data.topics,
                reason=result.data.reason,
                risk_flags=result.data.risk_flags,
                **result.audit_fields,
                raw_output=result.data.model_dump(mode="json", by_alias=True),
            )
            self.session.add(evaluation)
            post.processing_status = PostProcessingStatus.EVALUATED
            self.session.flush()

            events.emit(
                self.session,
                EventType.POST_EVALUATED,
                f"Post scored {result.data.relevance_score}/100 for {person.full_name}",
                campaign_id=campaign.id,
                person_id=person.id,
                workflow_id=workflow.id,
                agent_run_id=self.agent_run_id,
                payload={
                    "post_id": post.id,
                    "relevance_score": result.data.relevance_score,
                    "eligible": result.data.eligible,
                    "topics": result.data.topics,
                },
            )

        workflow.context = {
            **workflow.context,
            "evaluated_post_id": post.id,
            "post_relevant": bool(decision := policies.post_accepted(evaluation, campaign.criteria)),
        }

        if decision:
            return self._transition(workflow, WorkflowState.POST_3_ACCEPTED, decision.reason)

        # The score is always recorded; whether it blocks the action is the
        # campaign's choice. A candidate who passed evaluation is often worth
        # engaging with even when today's post is about something else.
        if policies.engage_despite_low_relevance(campaign.criteria, "like"):
            return self._transition(
                workflow,
                WorkflowState.POST_3_ACCEPTED,
                f"{decision.reason} Engaging anyway — this campaign does not "
                f"require post relevance for a like.",
            )

        post.processing_status = PostProcessingStatus.SKIPPED
        return self._transition(workflow, WorkflowState.POST_3_REJECTED, decision.reason)

    async def _handle_like_evaluated_post(self, workflow: Workflow) -> StepOutcome:
        campaign, person = workflow.campaign, workflow.person

        if not policies.should_like_evaluated_post(campaign.criteria):
            return self._transition(
                workflow, WorkflowState.POST_3_LIKED, "Liking the evaluated post is disabled."
            )

        post = self._evaluated_post(workflow)
        if post is None:
            return self._transition(
                workflow, WorkflowState.SKIPPED, "Evaluated post is missing.", StepStatus.TERMINAL
            )

        result = await self.executor.like_post(campaign, person, post, workflow_id=workflow.id)
        if not result.succeeded:
            raise AppError(result.skipped_reason or "Like failed.", code=ErrorCode.LIKE_FAILED)

        post.processing_status = (
            PostProcessingStatus.WOULD_LIKE if result.is_dry_run else PostProcessingStatus.LIKED
        )
        return self._transition(
            workflow,
            WorkflowState.POST_3_LIKED,
            "Liked the evaluated post" + (" (dry run)" if result.is_dry_run else "") + ".",
        )

    async def _handle_generate_comment(self, workflow: Workflow) -> StepOutcome:
        campaign, person = workflow.campaign, workflow.person

        if not policies.should_generate_comment(campaign.criteria):
            return self._transition(
                workflow, WorkflowState.COMMENT_REJECTED, "Comment generation is disabled."
            )

        # The like may have been allowed through on an off-topic post. Commenting
        # is far more exposed than a like, so it gets its own decision.
        if not workflow.context.get("post_relevant", True) and not (
            policies.engage_despite_low_relevance(campaign.criteria, "comment")
        ):
            return self._transition(
                workflow,
                WorkflowState.COMMENT_REJECTED,
                "Post scored below the relevance threshold and this campaign "
                "requires relevance before commenting.",
            )

        post = self._evaluated_post(workflow)
        if post is None:
            return self._transition(
                workflow, WorkflowState.SKIPPED, "Evaluated post is missing.", StepStatus.TERMINAL
            )

        comment = self._existing_comment(workflow)
        if comment is None:
            evaluation = self.session.scalar(
                select(PostEvaluation)
                .where(PostEvaluation.post_id == post.id)
                .order_by(PostEvaluation.id.desc())
            )
            result = await self.comment_generator.run(
                session=self.session,
                campaign_id=campaign.id,
                person_id=person.id,
                workflow_id=workflow.id,
                post=post,
                person=person,
                campaign=campaign,
                evaluation=evaluation,
            )
            comment = Comment(
                campaign_id=campaign.id,
                person_id=person.id,
                post_id=post.id,
                workflow_id=workflow.id,
                generated_text=result.data.comment,
                **result.audit_fields,
                raw_output=result.data.model_dump(mode="json", by_alias=True),
            )
            self.session.add(comment)
            self.session.flush()

            workflow.context = {**workflow.context, "comment_id": comment.id}
            events.emit(
                self.session,
                EventType.COMMENT_GENERATED,
                f"Comment drafted for {person.full_name}",
                campaign_id=campaign.id,
                person_id=person.id,
                workflow_id=workflow.id,
                agent_run_id=self.agent_run_id,
                payload={"comment_id": comment.id, "confidence": result.data.confidence},
            )

        return self._transition(workflow, WorkflowState.COMMENT_GENERATED, "Comment generated.")

    async def _handle_comment_decision(self, workflow: Workflow) -> StepOutcome:
        campaign = workflow.campaign
        comment = self._existing_comment(workflow)
        if comment is None:
            return self._transition(
                workflow, WorkflowState.COMMENT_REJECTED, "Comment draft is missing."
            )

        if policies.approval_required(campaign.criteria, ApprovalType.COMMENT):
            evaluation = self.session.scalar(
                select(PostEvaluation)
                .where(PostEvaluation.post_id == comment.post_id)
                .order_by(PostEvaluation.id.desc())
            )
            self._ensure_approval(
                workflow,
                ApprovalType.COMMENT,
                proposed_action="POST_COMMENT",
                ai_reasoning=evaluation.reason if evaluation else None,
                ai_score=evaluation.relevance_score if evaluation else None,
                content=comment.final_text,
                post_id=comment.post_id,
                comment_id=comment.id,
            )
            return self._transition(
                workflow,
                WorkflowState.COMMENT_PENDING_APPROVAL,
                "Waiting for comment approval.",
                StepStatus.WAITING_APPROVAL,
            )

        return await self._post_comment(workflow, comment)

    async def _handle_comment_approval(self, workflow: Workflow) -> StepOutcome:
        approval = self._find_approval(workflow, ApprovalType.COMMENT)
        if approval is None or approval.status is ApprovalStatus.PENDING:
            return StepOutcome(
                StepStatus.WAITING_APPROVAL, workflow.state, "Waiting for comment approval."
            )

        if approval.status is not ApprovalStatus.APPROVED:
            return self._transition(
                workflow, WorkflowState.COMMENT_REJECTED, "Comment rejected by reviewer."
            )

        comment = self._existing_comment(workflow)
        if comment is None:
            return self._transition(
                workflow, WorkflowState.COMMENT_REJECTED, "Comment draft is missing."
            )
        return await self._post_comment(workflow, comment)

    async def _post_comment(self, workflow: Workflow, comment: Comment) -> StepOutcome:
        campaign, person = workflow.campaign, workflow.person
        post = self.session.get(Post, comment.post_id)
        if post is None:
            return self._transition(
                workflow, WorkflowState.COMMENT_REJECTED, "Post is missing."
            )

        text = comment.final_text
        result = await self.executor.comment_on_post(
            campaign, person, post, text, workflow_id=workflow.id
        )
        if not result.succeeded:
            raise AppError(
                result.skipped_reason or "Comment failed.", code=ErrorCode.COMMENT_FAILED
            )

        comment.posted_text = text
        comment.posted_at = datetime.now(UTC)
        comment.external_id = result.action.external_id
        post.processing_status = (
            PostProcessingStatus.WOULD_COMMENT
            if result.is_dry_run
            else PostProcessingStatus.COMMENTED
        )
        self.session.flush()

        return self._transition(
            workflow,
            WorkflowState.COMMENT_POSTED,
            "Comment posted" + (" (dry run)" if result.is_dry_run else "") + ".",
        )

    async def _handle_schedule_connection(self, workflow: Workflow) -> StepOutcome:
        campaign = workflow.campaign
        delay = timedelta(hours=campaign.criteria.connection_delay_hours)
        due_at = datetime.now(UTC) + delay

        existing = self.session.scalar(
            select(ScheduledTask).where(
                ScheduledTask.workflow_id == workflow.id,
                ScheduledTask.task_type == ScheduledTaskType.CONNECTION,
                ScheduledTask.status == ScheduledTaskStatus.SCHEDULED,
            )
        )
        if existing is None:
            existing = ScheduledTask(
                campaign_id=campaign.id,
                person_id=workflow.person_id,
                workflow_id=workflow.id,
                task_type=ScheduledTaskType.CONNECTION,
                status=ScheduledTaskStatus.SCHEDULED,
                scheduled_at=due_at,
                payload={"delay_hours": campaign.criteria.connection_delay_hours},
            )
            self.session.add(existing)
            self.session.flush()

        workflow.context = {**workflow.context, "scheduled_task_id": existing.id}
        events.emit(
            self.session,
            EventType.CONNECTION_SCHEDULED,
            f"Connection scheduled for {existing.scheduled_at:%Y-%m-%d %H:%M UTC}",
            campaign_id=campaign.id,
            person_id=workflow.person_id,
            workflow_id=workflow.id,
            agent_run_id=self.agent_run_id,
            payload={"scheduled_at": existing.scheduled_at.isoformat()},
        )
        return self._transition(
            workflow,
            WorkflowState.CONNECTION_SCHEDULED,
            f"Connection scheduled for {existing.scheduled_at.isoformat()}.",
        )

    async def _handle_wait_for_connection(self, workflow: Workflow) -> StepOutcome:
        task = self.session.scalar(
            select(ScheduledTask)
            .where(
                ScheduledTask.workflow_id == workflow.id,
                ScheduledTask.task_type == ScheduledTaskType.CONNECTION,
            )
            .order_by(ScheduledTask.id.desc())
        )
        if task is None:
            return self._transition(
                workflow, WorkflowState.CONNECTION_SCHEDULED, "Rescheduling connection."
            )
        if task.status is ScheduledTaskStatus.CANCELLED:
            return self._transition(
                workflow,
                WorkflowState.CANCELLED,
                "Scheduled connection was cancelled.",
                StepStatus.TERMINAL,
            )

        if workflow.state is WorkflowState.CONNECTION_SCHEDULED:
            self._transition(workflow, WorkflowState.WAITING_FOR_CONNECTION, "Waiting.")

        if not policies.connection_due(workflow, task.scheduled_at):
            return StepOutcome(
                StepStatus.WAITING_TIMER,
                workflow.state,
                f"Connection due at {task.scheduled_at.isoformat()}.",
            )

        return self._transition(workflow, WorkflowState.REVALIDATING, "Connection is due.")

    async def _handle_revalidate(self, workflow: Workflow) -> StepOutcome:
        campaign, person = workflow.campaign, workflow.person

        if campaign.criteria.revalidate_before_connection:
            try:
                profile = await self.adapter.get_profile(person.external_id or "")
                person.connection_status = profile.connection_status
                person.last_activity_at = profile.last_activity_at or person.last_activity_at
                person.last_synced_at = datetime.now(UTC)
                self.session.flush()
                status = profile.connection_status
            except AppError as exc:
                logger.warning("Profile refresh failed during revalidation: %s", exc.message)
                status = person.connection_status or ConnectionStatus.UNKNOWN

            limit = rate_limiter.check_action(
                self.session, campaign, ActionType.SEND_CONNECTION
            )
            outcome = policies.revalidate_connection(
                campaign=campaign,
                person=person,
                connection_status=status,
                has_recent_activity=policies.has_recent_activity(person),
                daily_limit_available=limit.allowed,
            )
        else:
            outcome = policies.RevalidationOutcome(
                eligible=True,
                checks={"revalidation": "DISABLED"},
                reason="Revalidation is disabled for this campaign.",
            )

        events.emit(
            self.session,
            EventType.AGENT_LOG,
            f"Revalidation for {person.full_name}: "
            + ("eligible" if outcome.eligible else f"skipped — {outcome.reason}"),
            campaign_id=campaign.id,
            person_id=person.id,
            workflow_id=workflow.id,
            agent_run_id=self.agent_run_id,
            level=LogLevel.INFO if outcome.eligible else LogLevel.WARNING,
            payload={"checks": outcome.checks, "eligible": outcome.eligible},
        )

        workflow.context = {**workflow.context, "revalidation": outcome.checks}
        if not outcome.eligible:
            return self._transition(
                workflow, WorkflowState.SKIPPED, outcome.reason, StepStatus.TERMINAL
            )

        message = await self._prepare_connection_message(workflow)

        if policies.approval_required(campaign.criteria, ApprovalType.CONNECTION):
            self._ensure_approval(
                workflow,
                ApprovalType.CONNECTION,
                proposed_action="SEND_CONNECTION",
                ai_reasoning=outcome.reason,
                ai_score=None,
                content=message.final_text if message else None,
                connection_message_id=message.id if message else None,
            )
            return self._transition(
                workflow,
                WorkflowState.CONNECTION_PENDING_APPROVAL,
                "Waiting for connection approval.",
                StepStatus.WAITING_APPROVAL,
            )

        events.emit(
            self.session,
            EventType.CONNECTION_READY,
            f"Connection ready for {person.full_name}",
            campaign_id=campaign.id,
            person_id=person.id,
            workflow_id=workflow.id,
            agent_run_id=self.agent_run_id,
        )
        return self._transition(workflow, WorkflowState.CONNECTION_READY, outcome.reason)

    async def _handle_connection_approval(self, workflow: Workflow) -> StepOutcome:
        approval = self._find_approval(workflow, ApprovalType.CONNECTION)
        if approval is None or approval.status is ApprovalStatus.PENDING:
            return StepOutcome(
                StepStatus.WAITING_APPROVAL, workflow.state, "Waiting for connection approval."
            )
        if approval.status is not ApprovalStatus.APPROVED:
            return self._transition(
                workflow,
                WorkflowState.SKIPPED,
                "Connection rejected by reviewer.",
                StepStatus.TERMINAL,
            )
        return self._transition(
            workflow, WorkflowState.CONNECTION_READY, "Connection approved."
        )

    async def _handle_send_connection(self, workflow: Workflow) -> StepOutcome:
        campaign, person = workflow.campaign, workflow.person
        message = self._existing_connection_message(workflow)
        text = message.final_text if message else None

        result = await self.executor.send_connection(
            campaign, person, text, workflow_id=workflow.id
        )
        if not result.succeeded:
            raise AppError(
                result.skipped_reason or "Connection failed.", code=ErrorCode.CONNECTION_FAILED
            )

        if message is not None:
            message.sent_text = text
            message.sent_at = datetime.now(UTC)
        person.connection_status = ConnectionStatus.PENDING
        self.session.flush()

        self._close_scheduled_task(workflow, ScheduledTaskStatus.COMPLETED)
        return self._transition(
            workflow,
            WorkflowState.CONNECTION_SENT,
            "Connection request sent" + (" (dry run)" if result.is_dry_run else "") + ".",
        )

    async def _handle_complete(self, workflow: Workflow) -> StepOutcome:
        workflow.completed_at = datetime.now(UTC)
        events.emit(
            self.session,
            EventType.WORKFLOW_COMPLETED,
            f"Workflow completed for {workflow.person.full_name}",
            campaign_id=workflow.campaign_id,
            person_id=workflow.person_id,
            workflow_id=workflow.id,
            agent_run_id=self.agent_run_id,
        )
        return self._transition(
            workflow, WorkflowState.COMPLETED, "Workflow completed.", StepStatus.TERMINAL
        )

    # ------------------------------------------------------------- helpers --

    async def _prepare_connection_message(self, workflow: Workflow) -> ConnectionMessage | None:
        campaign, person = workflow.campaign, workflow.person
        mode = campaign.criteria.connection_message_mode

        existing = self._existing_connection_message(workflow)
        if existing is not None:
            return existing

        if mode is ConnectionMessageMode.NONE:
            return None

        if mode is ConnectionMessageMode.TEMPLATE:
            template = campaign.criteria.connection_message_template or ""
            text = template.replace("{{first_name}}", person.full_name.split()[0]).replace(
                "{{company}}", person.company or ""
            )
            message = ConnectionMessage(
                campaign_id=campaign.id,
                person_id=person.id,
                workflow_id=workflow.id,
                mode=mode,
                generated_text=text[:300],
            )
            self.session.add(message)
            self.session.flush()
            workflow.context = {**workflow.context, "connection_message_id": message.id}
            return message

        reference_post = self._evaluated_post(workflow)
        result = await self.connection_generator.run(
            session=self.session,
            campaign_id=campaign.id,
            person_id=person.id,
            workflow_id=workflow.id,
            person=person,
            campaign=campaign,
            reference_post=reference_post,
        )
        message = ConnectionMessage(
            campaign_id=campaign.id,
            person_id=person.id,
            workflow_id=workflow.id,
            mode=mode,
            generated_text=result.data.message,
            **result.audit_fields,
            raw_output=result.data.model_dump(mode="json", by_alias=True),
        )
        self.session.add(message)
        self.session.flush()
        workflow.context = {**workflow.context, "connection_message_id": message.id}
        return message

    def _like_state(self, likes_done: int, *, found: bool) -> WorkflowState:
        """Map a like index onto the named POST_1/POST_2 states.

        Configurations asking for more than two initial likes reuse the POST_2
        states; the counter in ``context`` remains authoritative.
        """
        if likes_done == 0:
            return WorkflowState.POST_1_FOUND if found else WorkflowState.POST_1_LIKED
        return WorkflowState.POST_2_FOUND if found else WorkflowState.POST_2_LIKED

    def _post_at(self, workflow: Workflow, index: int) -> Post | None:
        ids: list[int] = list(workflow.context.get("eligible_post_ids", []))
        if index >= len(ids):
            return None
        return self.session.get(Post, ids[index])

    def _evaluated_post(self, workflow: Workflow) -> Post | None:
        post_id = workflow.context.get("evaluated_post_id")
        return self.session.get(Post, post_id) if post_id else None

    def _existing_comment(self, workflow: Workflow) -> Comment | None:
        comment_id = workflow.context.get("comment_id")
        if comment_id:
            return self.session.get(Comment, comment_id)
        return self.session.scalar(
            select(Comment)
            .where(Comment.workflow_id == workflow.id)
            .order_by(Comment.id.desc())
        )

    def _existing_connection_message(self, workflow: Workflow) -> ConnectionMessage | None:
        message_id = workflow.context.get("connection_message_id")
        if message_id:
            return self.session.get(ConnectionMessage, message_id)
        return self.session.scalar(
            select(ConnectionMessage)
            .where(ConnectionMessage.workflow_id == workflow.id)
            .order_by(ConnectionMessage.id.desc())
        )

    def _person_link(self, campaign_id: int, person_id: int):
        from app.database.models import PersonCampaign

        return self.session.scalar(
            select(PersonCampaign).where(
                PersonCampaign.campaign_id == campaign_id,
                PersonCampaign.person_id == person_id,
            )
        )

    def _discovery_reason(self, campaign_id: int, person_id: int) -> str:
        link = self._person_link(campaign_id, person_id)
        return (link.discovery_reason if link else None) or "(not recorded)"

    def _find_approval(self, workflow: Workflow, approval_type: ApprovalType) -> Approval | None:
        return self.session.scalar(
            select(Approval)
            .where(
                Approval.workflow_id == workflow.id,
                Approval.approval_type == approval_type,
            )
            .order_by(Approval.id.desc())
        )

    def _ensure_approval(
        self,
        workflow: Workflow,
        approval_type: ApprovalType,
        *,
        proposed_action: str,
        ai_reasoning: str | None,
        ai_score: int | None,
        content: str | None,
        post_id: int | None = None,
        comment_id: int | None = None,
        connection_message_id: int | None = None,
    ) -> Approval:
        existing = self._find_approval(workflow, approval_type)
        if existing is not None:
            return existing

        approval = Approval(
            campaign_id=workflow.campaign_id,
            person_id=workflow.person_id,
            workflow_id=workflow.id,
            post_id=post_id,
            comment_id=comment_id,
            connection_message_id=connection_message_id,
            approval_type=approval_type,
            status=ApprovalStatus.PENDING,
            proposed_action=proposed_action,
            ai_reasoning=ai_reasoning,
            ai_score=ai_score,
            content=content,
        )
        self.session.add(approval)
        self.session.flush()

        events.emit(
            self.session,
            EventType.APPROVAL_REQUIRED,
            f"{approval_type.value.title()} approval needed for {workflow.person.full_name}",
            campaign_id=workflow.campaign_id,
            person_id=workflow.person_id,
            workflow_id=workflow.id,
            agent_run_id=self.agent_run_id,
            payload={"approval_id": approval.id, "approval_type": approval_type.value},
        )
        return approval

    def _close_scheduled_task(self, workflow: Workflow, status: ScheduledTaskStatus) -> None:
        task = self.session.scalar(
            select(ScheduledTask)
            .where(
                ScheduledTask.workflow_id == workflow.id,
                ScheduledTask.task_type == ScheduledTaskType.CONNECTION,
                ScheduledTask.status.in_(
                    [ScheduledTaskStatus.SCHEDULED, ScheduledTaskStatus.RUNNING]
                ),
            )
            .order_by(ScheduledTask.id.desc())
        )
        if task is not None:
            task.status = status
            task.executed_at = datetime.now(UTC)
            self.session.flush()

    def _transition(
        self,
        workflow: Workflow,
        to_state: WorkflowState,
        summary: str,
        status: StepStatus = StepStatus.CONTINUE,
        payload: dict[str, Any] | None = None,
    ) -> StepOutcome:
        from_state = workflow.state
        workflow.previous_state = from_state
        workflow.state = to_state
        if workflow.started_at is None:
            workflow.started_at = datetime.now(UTC)

        self.session.add(
            WorkflowStep(
                workflow_id=workflow.id,
                from_state=from_state,
                to_state=to_state,
                summary=summary,
                payload=payload,
            )
        )
        self.session.flush()

        events.emit(
            self.session,
            EventType.WORKFLOW_STATE_CHANGED,
            f"{from_state.value} -> {to_state.value}: {summary}",
            campaign_id=workflow.campaign_id,
            person_id=workflow.person_id,
            workflow_id=workflow.id,
            agent_run_id=self.agent_run_id,
            level=LogLevel.DEBUG,
            payload={"from": from_state.value, "to": to_state.value},
        )
        return StepOutcome(status, to_state, summary)

    def _fail(self, workflow: Workflow, exc: AppError) -> StepOutcome:
        workflow.consecutive_failures += 1
        workflow.last_error_code = exc.code.value
        workflow.last_error_message = exc.message
        self.session.flush()

        rate_limiter.record_failure(self.session, workflow.campaign_id)
        events.emit(
            self.session,
            EventType.WORKFLOW_FAILED,
            f"Workflow step failed ({exc.code.value}): {exc.message}",
            campaign_id=workflow.campaign_id,
            person_id=workflow.person_id,
            workflow_id=workflow.id,
            agent_run_id=self.agent_run_id,
            level=LogLevel.ERROR,
            payload={
                "error_code": exc.code.value,
                "consecutive_failures": workflow.consecutive_failures,
                "transient": exc.is_transient,
            },
        )

        if policies.should_pause_workflow(workflow, settings.workflow_failure_threshold):
            return self._transition(
                workflow,
                WorkflowState.FAILED,
                f"Paused after {workflow.consecutive_failures} consecutive failures: "
                f"{exc.message}",
                StepStatus.TERMINAL,
            )
        return StepOutcome(StepStatus.FAILED, workflow.state, exc.message)
