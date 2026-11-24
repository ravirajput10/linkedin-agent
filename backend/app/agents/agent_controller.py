"""Campaign-level orchestration.

The controller decides *which* workflows to touch in a run; the workflow engine
decides what happens inside each one. Both are bounded: the controller processes
at most ``max_people_per_run`` people and stops when a daily limit is hit.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.agents.policies import campaign_can_act
from app.agents.workflow_engine import StepStatus, WorkflowEngine
from app.database.models import AgentRun, Campaign, Workflow
from app.enums import (
    TERMINAL_STATES,
    TIMER_WAIT_STATES,
    AgentRunStatus,
    CampaignStatus,
    EventType,
    LogLevel,
    WorkflowState,
)
from app.errors import AppError, NotFoundError
from app.integrations.platform.base import SocialPlatformAdapter
from app.integrations.platform.factory import (
    adapter_for_campaign,
    adapter_for_owner,
)
from app.logging import get_logger
from app.services import events, rate_limiter
from app.workflows.discovery import discover_candidates

logger = get_logger(__name__)

#: A worker holding a workflow longer than this is presumed dead.
LOCK_TIMEOUT = timedelta(minutes=30)


@dataclass
class RunSummary:
    agent_run_id: int
    candidates_discovered: int = 0
    candidates_processed: int = 0
    workflows_completed: int = 0
    workflows_waiting: int = 0
    workflows_failed: int = 0
    stopped_reason: str | None = None
    details: list[str] = field(default_factory=list)


class AgentController:
    def __init__(self, session: Session, adapter: SocialPlatformAdapter | None = None) -> None:
        """``adapter`` pins one explicitly; otherwise it is resolved per campaign.

        Resolution is deferred to ``run_campaign`` because the right adapter
        depends on who owns the campaign — with Unipile active, acting through
        the server-wide account would engage people as the wrong member.
        """
        self.session = session
        self._explicit_adapter = adapter
        self.adapter: SocialPlatformAdapter | None = adapter

    # ---------------------------------------------------------------- runs --

    def start_run(self, campaign: Campaign, *, trigger: str = "manual") -> AgentRun:
        run = AgentRun(
            campaign_id=campaign.id,
            status=AgentRunStatus.RUNNING,
            trigger=trigger,
            started_at=datetime.now(UTC),
        )
        self.session.add(run)
        self.session.flush()
        return run

    def finish_run(
        self, run: AgentRun, summary: RunSummary, *, error: AppError | None = None
    ) -> None:
        run.finished_at = datetime.now(UTC)
        run.status = AgentRunStatus.FAILED if error else AgentRunStatus.COMPLETED
        run.candidates_discovered = summary.candidates_discovered
        run.candidates_processed = summary.candidates_processed
        run.failures = summary.workflows_failed
        if error:
            run.error_code = error.code.value
            run.error_message = error.message
        self.session.flush()

    # ----------------------------------------------------------- execution --

    async def run_campaign(self, campaign_id: int, *, trigger: str = "manual") -> RunSummary:
        campaign = self.session.get(Campaign, campaign_id)
        if campaign is None:
            raise NotFoundError(f"Campaign {campaign_id} not found.")

        if self._explicit_adapter is None:
            self.adapter = await adapter_for_owner(
                self.session, campaign.owner_id, context=f"Campaign '{campaign.name}'"
            )

        can_act = campaign_can_act(campaign)
        run = self.start_run(campaign, trigger=trigger)
        summary = RunSummary(agent_run_id=run.id)

        if not can_act:
            summary.stopped_reason = can_act.reason
            self.finish_run(run, summary)
            return summary

        events.emit(
            self.session,
            EventType.AGENT_LOG,
            f"Agent run started for '{campaign.name}'"
            + (" in DRY RUN mode" if campaign.dry_run else ""),
            campaign_id=campaign.id,
            agent_run_id=run.id,
        )

        try:
            await self._discover_if_needed(campaign, run, summary)
            await self._process_workflows(campaign, run, summary)
        except AppError as exc:
            logger.exception("Agent run %s failed", run.id)
            events.emit(
                self.session,
                EventType.WORKFLOW_FAILED,
                f"Agent run failed: {exc.message}",
                campaign_id=campaign.id,
                agent_run_id=run.id,
                level=LogLevel.ERROR,
            )
            self.finish_run(run, summary, error=exc)
            return summary

        self._maybe_complete_campaign(campaign, summary)
        self.finish_run(run, summary)

        events.emit(
            self.session,
            EventType.AGENT_LOG,
            f"Agent run finished: {summary.candidates_processed} people processed, "
            f"{summary.workflows_completed} completed, {summary.workflows_waiting} waiting.",
            campaign_id=campaign.id,
            agent_run_id=run.id,
        )
        return summary

    async def _discover_if_needed(
        self, campaign: Campaign, run: AgentRun, summary: RunSummary
    ) -> None:
        pending = self.session.scalar(
            select(func.count())
            .select_from(Workflow)
            .where(
                Workflow.campaign_id == campaign.id,
                Workflow.state.notin_(list(TERMINAL_STATES) + list(TIMER_WAIT_STATES)),
            )
        )
        if pending and pending >= campaign.criteria.max_people_per_run:
            summary.details.append(f"{pending} workflows already pending; skipping discovery.")
            return

        person_limit = rate_limiter.check_person(self.session, campaign)
        if not person_limit.allowed:
            summary.stopped_reason = person_limit.reason
            summary.details.append(person_limit.reason or "")
            return

        wanted = min(campaign.criteria.max_people_per_run, person_limit.remaining)
        if wanted <= 0:
            return

        workflows = await discover_candidates(
            self.session,
            adapter=self.adapter,
            campaign=campaign,
            limit=wanted,
            agent_run_id=run.id,
        )
        summary.candidates_discovered = len(workflows)
        run.candidates_discovered = len(workflows)
        self.session.flush()

    async def _process_workflows(
        self, campaign: Campaign, run: AgentRun, summary: RunSummary
    ) -> None:
        engine = WorkflowEngine(self.session, self.adapter, agent_run_id=run.id)
        budget = campaign.criteria.max_people_per_run

        for workflow in self._claimable_workflows(campaign, limit=budget):
            self._claim(workflow, run.id)
            outcome = await engine.run(workflow)
            self._release(workflow)

            summary.candidates_processed += 1
            match outcome.status:
                case StepStatus.TERMINAL if outcome.state is WorkflowState.COMPLETED:
                    summary.workflows_completed += 1
                case StepStatus.WAITING_APPROVAL | StepStatus.WAITING_TIMER:
                    summary.workflows_waiting += 1
                case StepStatus.FAILED:
                    summary.workflows_failed += 1

            summary.details.append(
                f"{workflow.person.full_name}: {outcome.state.value} — {outcome.detail}"
            )

            self.session.commit()

            person_limit = rate_limiter.check_person(self.session, campaign)
            if not person_limit.allowed:
                summary.stopped_reason = person_limit.reason
                break

        run.candidates_processed = summary.candidates_processed
        run.actions_executed = summary.workflows_completed
        self.session.flush()

    def _claimable_workflows(self, campaign: Campaign, *, limit: int) -> list[Workflow]:
        """Workflows this run may advance, skipping any another worker holds."""
        cutoff = datetime.now(UTC) - LOCK_TIMEOUT
        stmt = (
            select(Workflow)
            .where(
                Workflow.campaign_id == campaign.id,
                Workflow.state.notin_(list(TERMINAL_STATES)),
                Workflow.state.notin_(list(TIMER_WAIT_STATES)),
                (Workflow.locked_at.is_(None)) | (Workflow.locked_at < cutoff),
            )
            .order_by(Workflow.updated_at)
            .limit(limit)
            .with_for_update(skip_locked=True)
        )
        return list(self.session.scalars(stmt))

    def _claim(self, workflow: Workflow, run_id: int) -> None:
        workflow.locked_at = datetime.now(UTC)
        workflow.locked_by = f"run-{run_id}"
        self.session.flush()

    def _release(self, workflow: Workflow) -> None:
        workflow.locked_at = None
        workflow.locked_by = None
        self.session.flush()

    def _maybe_complete_campaign(self, campaign: Campaign, summary: RunSummary) -> None:
        remaining = self.session.scalar(
            select(func.count())
            .select_from(Workflow)
            .where(
                Workflow.campaign_id == campaign.id,
                Workflow.state.notin_(list(TERMINAL_STATES)),
            )
        )
        if remaining:
            return
        if summary.candidates_discovered == 0 and summary.candidates_processed == 0:
            return

        campaign.status = CampaignStatus.COMPLETED
        campaign.completed_at = datetime.now(UTC)
        self.session.flush()
        events.emit(
            self.session,
            EventType.CAMPAIGN_STATUS_CHANGED,
            f"Campaign '{campaign.name}' completed.",
            campaign_id=campaign.id,
        )


async def resume_workflow(
    session: Session, workflow_id: int, adapter: SocialPlatformAdapter | None = None
) -> Workflow:
    """Advance a single workflow — used after an approval decision."""
    workflow = session.get(Workflow, workflow_id)
    if workflow is None:
        raise NotFoundError(f"Workflow {workflow_id} not found.")

    if adapter is None:
        adapter = await adapter_for_campaign(session, workflow.campaign_id)
    engine = WorkflowEngine(session, adapter)
    await engine.run(workflow)
    return workflow
