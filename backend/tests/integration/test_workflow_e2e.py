"""End-to-end workflow tests against PostgreSQL, the mock platform and the mock LLM.

Skipped automatically when no database is reachable.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.agents.agent_controller import AgentController
from app.agents.workflow_engine import StepStatus, WorkflowEngine
from app.database.models import (
    Action,
    Approval,
    Campaign,
    CampaignCriteria,
    Comment,
    ConnectionMessage,
    DailyUsage,
    Person,
    Post,
    ScheduledTask,
    Workflow,
)
from app.enums import (
    ActionStatus,
    ActionType,
    ApprovalMode,
    ApprovalStatus,
    ApprovalType,
    CampaignStatus,
    ScheduledTaskStatus,
    WorkflowState,
)
from app.services import approval_service, rate_limiter
from app.workflows.discovery import discover_candidates

pytestmark = pytest.mark.integration


def make_campaign(db, **criteria_overrides) -> Campaign:
    campaign = Campaign(
        name="Java + AI CTO Outreach",
        instruction="Find CTOs in SaaS companies in India posting about Java and AI.",
        status=CampaignStatus.RUNNING,
        dry_run=False,
    )
    db.add(campaign)
    db.flush()

    defaults = {
        "job_titles": ["CTO", "VP of Engineering", "Engineering Manager"],
        "industries": ["SaaS", "Software"],
        "locations": ["India"],
        "people_keywords": ["Java", "AI", "microservices"],
        "include_topics": ["Java", "AI", "Microservices", "Architecture"],
        "exclude_topics": ["Recruitment", "Jobs", "Spam"],
        "exclude_keywords": [],
        "minimum_relevance_score": 60,
        "minimum_candidate_score": 60,
        "initial_posts_to_like": 2,
        "evaluate_post_index": 3,
        "candidate_approval": ApprovalMode.AUTOMATIC,
        "comment_approval": ApprovalMode.REQUIRED,
        "connection_approval": ApprovalMode.REQUIRED,
        "connection_delay_hours": 48,
        "max_people_per_run": 3,
    }
    criteria = CampaignCriteria(campaign_id=campaign.id, **(defaults | criteria_overrides))
    db.add(criteria)
    db.flush()
    db.refresh(campaign)
    return campaign


async def drive(db, platform, workflow: Workflow, *, loops: int = 6):
    engine = WorkflowEngine(db, platform)
    outcome = None
    for _ in range(loops):
        outcome = await engine.run(workflow)
        if outcome.status in (StepStatus.TERMINAL, StepStatus.WAITING_APPROVAL, StepStatus.WAITING_TIMER):
            break
    return outcome


async def discover_one(db, platform, campaign) -> Workflow:
    """Discover candidates without advancing any workflow.

    ``AgentController.run_campaign`` both discovers *and* processes, which is
    correct in production but leaves a single workflow at whatever state the
    controller happened to reach. Tests that assert on one candidate drive it
    themselves, step by step, so the assertion means what it says.
    """
    workflows = await discover_candidates(
        db,
        adapter=platform,
        campaign=campaign,
        limit=campaign.criteria.max_people_per_run,
    )
    assert workflows, "mock discovery returned no candidates"
    return workflows[0]


# ------------------------------------------------------------- discovery --


async def test_discovery_creates_people_and_workflows(db, llm, platform) -> None:
    campaign = make_campaign(db)
    controller = AgentController(db, platform)
    summary = await controller.run_campaign(campaign.id)

    assert summary.candidates_discovered > 0
    assert db.scalar(select(Person).limit(1)) is not None
    assert db.scalars(select(Workflow).where(Workflow.campaign_id == campaign.id)).all()


async def test_paused_campaign_does_no_work(db, llm, platform) -> None:
    campaign = make_campaign(db)
    campaign.status = CampaignStatus.PAUSED
    db.flush()

    summary = await AgentController(db, platform).run_campaign(campaign.id)
    assert summary.candidates_discovered == 0
    assert "PAUSED" in (summary.stopped_reason or "")


# ------------------------------------------------------------- engagement --


async def test_full_engagement_sequence_to_comment_approval(db, llm, platform) -> None:
    """Like, like, evaluate, like, draft comment, then stop and wait for a human."""
    campaign = make_campaign(db)
    workflow = await discover_one(db, platform, campaign)

    outcome = await drive(db, platform, workflow)
    assert outcome.status is StepStatus.WAITING_APPROVAL
    assert workflow.state is WorkflowState.COMMENT_PENDING_APPROVAL

    likes = db.scalars(
        select(Action).where(
            Action.workflow_id == workflow.id, Action.action_type == ActionType.LIKE_POST
        )
    ).all()
    assert len(likes) == 3, "two initial likes plus the evaluated post"
    assert all(action.status is ActionStatus.SUCCESS for action in likes)

    approval = db.scalar(
        select(Approval).where(
            Approval.workflow_id == workflow.id,
            Approval.approval_type == ApprovalType.COMMENT,
        )
    )
    assert approval is not None
    assert approval.status is ApprovalStatus.PENDING
    assert approval.content


async def test_engagement_honours_a_different_like_count(db, llm, platform) -> None:
    campaign = make_campaign(db, initial_posts_to_like=1)
    workflow = await discover_one(db, platform, campaign)

    await drive(db, platform, workflow)
    likes = db.scalars(
        select(Action).where(
            Action.workflow_id == workflow.id, Action.action_type == ActionType.LIKE_POST
        )
    ).all()
    assert len(likes) == 2, "one initial like plus the evaluated post"


async def test_irrelevant_post_skips_the_comment_and_still_schedules_a_connection(
    db, llm, platform
) -> None:
    """A strong candidate whose third post is off-topic.

    The comment is skipped, but the connection is still scheduled — the person
    qualified, only this particular post did not.
    """
    campaign = make_campaign(db, minimum_candidate_score=60, minimum_relevance_score=75)
    workflow = await discover_one(db, platform, campaign)

    llm.script(
        {
            "match": True,
            "score": 92,
            "matchedCriteria": ["CTO", "SaaS", "India"],
            "reason": "Engineering leader at an Indian SaaS company writing about Java.",
            "riskFlags": [],
        },
        {
            "eligible": False,
            "relevanceScore": 31,
            "topics": ["Personal update"],
            "reason": "A conference photo caption with no technical content.",
            "riskFlags": ["low_substance"],
        },
    )

    await drive(db, platform, workflow)

    assert workflow.state in (
        WorkflowState.CONNECTION_SCHEDULED,
        WorkflowState.WAITING_FOR_CONNECTION,
    )
    assert db.scalar(select(Comment).where(Comment.workflow_id == workflow.id)) is None
    assert (
        db.scalar(select(ScheduledTask).where(ScheduledTask.workflow_id == workflow.id))
        is not None
    )


async def test_rejected_candidate_never_engages(db, platform) -> None:
    from app.ai.provider_factory import set_llm_provider_override
    from app.ai.providers.mock_provider import MockLLMProvider

    set_llm_provider_override(MockLLMProvider(forced_score=20))
    try:
        campaign = make_campaign(db, minimum_candidate_score=70)
        workflow = await discover_one(db, platform, campaign)

        await drive(db, platform, workflow)
        assert workflow.state is WorkflowState.CANDIDATE_REJECTED
        assert not db.scalars(
            select(Action).where(Action.workflow_id == workflow.id)
        ).all()
    finally:
        set_llm_provider_override(None)


# ----------------------------------------------------------- idempotency --


async def test_reprocessing_does_not_duplicate_likes(db, llm, platform) -> None:
    campaign = make_campaign(db)
    workflow = await discover_one(db, platform, campaign)

    await drive(db, platform, workflow)
    first_count = len(
        db.scalars(select(Action).where(Action.workflow_id == workflow.id)).all()
    )
    likes_on_platform = len(platform.liked_posts)

    # Rewind the state machine and replay the like steps.
    workflow.state = WorkflowState.POST_1_FOUND
    workflow.context = {**workflow.context, "likes_done": 0}
    db.flush()
    await drive(db, platform, workflow)

    assert len(platform.liked_posts) == likes_on_platform, "no extra platform calls"
    assert (
        len(db.scalars(select(Action).where(Action.workflow_id == workflow.id)).all())
        == first_count
    )


# --------------------------------------------------------- resumability --


async def test_workflow_resumes_from_the_persisted_state(db, llm, platform) -> None:
    """Simulate a crash after post #2: a fresh engine must not re-like #1 or #2."""
    campaign = make_campaign(db)
    workflow = await discover_one(db, platform, campaign)

    engine = WorkflowEngine(db, platform)
    for _ in range(8):
        await engine.advance(workflow)
        if workflow.state is WorkflowState.POST_2_LIKED:
            break
    assert workflow.state is WorkflowState.POST_2_LIKED
    likes_before = len(platform.liked_posts)
    workflow_id = workflow.id

    db.expunge_all()  # everything in memory is gone, as after a restart

    reloaded = db.get(Workflow, workflow_id)
    assert reloaded.state is WorkflowState.POST_2_LIKED
    await drive(db, platform, reloaded)

    assert len(platform.liked_posts) == likes_before + 1, "only the evaluated post was liked"
    assert reloaded.state is WorkflowState.COMMENT_PENDING_APPROVAL


# ------------------------------------------------------------- approvals --


async def test_approving_a_comment_posts_it_and_schedules_the_connection(
    db, llm, platform
) -> None:
    campaign = make_campaign(db)
    workflow = await discover_one(db, platform, campaign)
    await drive(db, platform, workflow)
    assert workflow.state is WorkflowState.COMMENT_PENDING_APPROVAL

    approval = db.scalar(
        select(Approval).where(
            Approval.workflow_id == workflow.id,
            Approval.approval_type == ApprovalType.COMMENT,
        )
    )
    approval_service.approve(db, approval.id, edited_content="A precise, edited observation.")

    await drive(db, platform, workflow)

    comment = db.scalar(select(Comment).where(Comment.workflow_id == workflow.id))
    assert comment.posted_text == "A precise, edited observation."
    assert comment.posted_at is not None
    assert "A precise, edited observation." in platform.comments[
        db.get(Post, comment.post_id).external_id
    ]
    assert workflow.state in (
        WorkflowState.CONNECTION_SCHEDULED,
        WorkflowState.WAITING_FOR_CONNECTION,
    )


async def test_rejecting_a_comment_skips_posting_but_keeps_the_connection(
    db, llm, platform
) -> None:
    campaign = make_campaign(db)
    workflow = await discover_one(db, platform, campaign)
    await drive(db, platform, workflow)

    approval = db.scalar(
        select(Approval).where(
            Approval.workflow_id == workflow.id,
            Approval.approval_type == ApprovalType.COMMENT,
        )
    )
    approval_service.reject(db, approval.id, note="Too generic.")
    await drive(db, platform, workflow)

    comment = db.scalar(select(Comment).where(Comment.workflow_id == workflow.id))
    assert comment.posted_at is None
    assert not platform.comments
    assert db.scalar(
        select(ScheduledTask).where(ScheduledTask.workflow_id == workflow.id)
    ) is not None


async def test_automatic_approval_posts_without_a_human(db, llm, platform) -> None:
    campaign = make_campaign(db, comment_approval=ApprovalMode.AUTOMATIC)
    workflow = await discover_one(db, platform, campaign)
    await drive(db, platform, workflow)

    comment = db.scalar(select(Comment).where(Comment.workflow_id == workflow.id))
    assert comment.posted_at is not None
    assert platform.comments


# ------------------------------------------------ 48-hour connection job --


async def test_connection_is_scheduled_for_the_configured_delay(db, llm, platform) -> None:
    campaign = make_campaign(db, comment_approval=ApprovalMode.AUTOMATIC, connection_delay_hours=48)
    workflow = await discover_one(db, platform, campaign)
    await drive(db, platform, workflow)

    task = db.scalar(select(ScheduledTask).where(ScheduledTask.workflow_id == workflow.id))
    assert task is not None
    assert task.status is ScheduledTaskStatus.SCHEDULED

    delay = task.scheduled_at - datetime.now(UTC)
    assert timedelta(hours=47) < delay < timedelta(hours=49)


async def test_workflow_waits_until_the_connection_is_due(db, llm, platform) -> None:
    campaign = make_campaign(db, comment_approval=ApprovalMode.AUTOMATIC)
    workflow = await discover_one(db, platform, campaign)
    await drive(db, platform, workflow)

    outcome = await WorkflowEngine(db, platform).run(workflow)
    assert outcome.status is StepStatus.WAITING_TIMER
    assert workflow.state is WorkflowState.WAITING_FOR_CONNECTION


async def test_due_connection_revalidates_and_requests_approval(db, llm, platform) -> None:
    campaign = make_campaign(db, comment_approval=ApprovalMode.AUTOMATIC)
    workflow = await discover_one(db, platform, campaign)
    await drive(db, platform, workflow)

    task = db.scalar(select(ScheduledTask).where(ScheduledTask.workflow_id == workflow.id))
    task.scheduled_at = datetime.now(UTC) - timedelta(minutes=1)
    db.flush()

    await drive(db, platform, workflow)
    assert workflow.state is WorkflowState.CONNECTION_PENDING_APPROVAL
    assert workflow.context["revalidation"]["already_connected"] == "NO"

    message = db.scalar(
        select(ConnectionMessage).where(ConnectionMessage.workflow_id == workflow.id)
    )
    assert message is not None
    assert len(message.generated_text) <= 300


async def test_approving_the_connection_completes_the_workflow(db, llm, platform) -> None:
    campaign = make_campaign(db, comment_approval=ApprovalMode.AUTOMATIC)
    workflow = await discover_one(db, platform, campaign)
    await drive(db, platform, workflow)

    task = db.scalar(select(ScheduledTask).where(ScheduledTask.workflow_id == workflow.id))
    task.scheduled_at = datetime.now(UTC) - timedelta(minutes=1)
    db.flush()
    await drive(db, platform, workflow)

    approval = db.scalar(
        select(Approval).where(
            Approval.workflow_id == workflow.id,
            Approval.approval_type == ApprovalType.CONNECTION,
        )
    )
    approval_service.approve(db, approval.id)
    await drive(db, platform, workflow)

    assert workflow.state is WorkflowState.COMPLETED
    assert workflow.completed_at is not None

    person = db.get(Person, workflow.person_id)
    assert person.external_id in platform.connections

    task = db.scalar(select(ScheduledTask).where(ScheduledTask.workflow_id == workflow.id))
    assert task.status is ScheduledTaskStatus.COMPLETED


async def test_revalidation_skips_an_already_connected_person(db, llm, platform) -> None:
    from app.enums import ConnectionStatus

    campaign = make_campaign(db, comment_approval=ApprovalMode.AUTOMATIC)
    workflow = await discover_one(db, platform, campaign)
    await drive(db, platform, workflow)

    person = db.get(Person, workflow.person_id)
    platform.connections[person.external_id] = ConnectionStatus.CONNECTED

    task = db.scalar(select(ScheduledTask).where(ScheduledTask.workflow_id == workflow.id))
    task.scheduled_at = datetime.now(UTC) - timedelta(minutes=1)
    db.flush()

    await drive(db, platform, workflow)
    assert workflow.state is WorkflowState.SKIPPED
    assert workflow.context["revalidation"]["already_connected"] == "YES"


# ----------------------------------------------------------- rate limits --


async def test_daily_like_limit_stops_further_likes(db, llm, platform) -> None:
    campaign = make_campaign(db, max_likes_per_day=1)
    workflow = await discover_one(db, platform, campaign)

    outcome = await drive(db, platform, workflow)
    assert outcome.status is StepStatus.WAITING_TIMER
    assert "Daily limit reached" in outcome.detail
    assert len(platform.liked_posts) == 1


async def test_usage_counters_track_real_actions(db, llm, platform) -> None:
    campaign = make_campaign(db, comment_approval=ApprovalMode.AUTOMATIC)
    workflow = await discover_one(db, platform, campaign)
    await drive(db, platform, workflow)

    usage = db.scalar(select(DailyUsage).where(DailyUsage.campaign_id == campaign.id))
    assert usage.likes_sent == 3
    assert usage.comments_sent == 1
    assert usage.people_processed >= 1


async def test_rate_limiter_reports_remaining_budget(db) -> None:
    campaign = make_campaign(db, max_likes_per_day=5)
    check = rate_limiter.check_action(db, campaign, ActionType.LIKE_POST)
    assert check.allowed and check.remaining == 5

    for _ in range(5):
        rate_limiter.consume_action(db, campaign.id, ActionType.LIKE_POST)

    check = rate_limiter.check_action(db, campaign, ActionType.LIKE_POST)
    assert not check.allowed and check.remaining == 0


# --------------------------------------------------------------- dry run --


async def test_dry_run_records_intent_without_touching_the_platform(db, llm, platform) -> None:
    campaign = make_campaign(db, comment_approval=ApprovalMode.AUTOMATIC)
    campaign.dry_run = True
    db.flush()

    workflow = await discover_one(db, platform, campaign)
    await drive(db, platform, workflow)

    actions = db.scalars(select(Action).where(Action.workflow_id == workflow.id)).all()
    assert actions
    assert all(action.status is ActionStatus.SKIPPED_DRY_RUN for action in actions)
    assert all(action.result["dry_run"] is True for action in actions)

    assert not platform.liked_posts, "no likes reached the platform"
    assert not platform.comments, "no comments reached the platform"

    # The reasoning still ran, so the user can see what would have happened.
    assert db.scalar(select(Comment).where(Comment.workflow_id == workflow.id)) is not None


# ----------------------------------------------- relevance gating overrides --


async def test_off_topic_post_is_skipped_when_relevance_is_required(db, llm, platform) -> None:
    """The default: a low-scoring post stops the engagement."""
    campaign = make_campaign(db, require_relevance_for_like=True, minimum_relevance_score=75)
    workflow = await discover_one(db, platform, campaign)

    llm.script(
        {"match": True, "score": 90, "matchedCriteria": ["CTO"], "reason": "Fits.", "riskFlags": []},
        {
            "eligible": False,
            "relevanceScore": 20,
            "topics": ["Conference photo"],
            "reason": "A conference selfie with no technical content.",
            "riskFlags": [],
        },
    )
    await drive(db, platform, workflow)

    assert db.scalar(select(Comment).where(Comment.workflow_id == workflow.id)) is None
    likes = db.scalars(
        select(Action).where(
            Action.workflow_id == workflow.id, Action.action_type == ActionType.LIKE_POST
        )
    ).all()
    assert len(likes) == 2, "only the two unconditional likes"


async def test_off_topic_post_is_still_liked_when_relevance_is_not_required(
    db, llm, platform
) -> None:
    """A matched person is worth engaging with even on an off-topic day."""
    campaign = make_campaign(
        db,
        require_relevance_for_like=False,
        require_relevance_for_comment=True,
        minimum_relevance_score=75,
    )
    workflow = await discover_one(db, platform, campaign)

    llm.script(
        {"match": True, "score": 90, "matchedCriteria": ["CTO"], "reason": "Fits.", "riskFlags": []},
        {
            "eligible": False,
            "relevanceScore": 20,
            "topics": ["Conference photo"],
            "reason": "A conference selfie with no technical content.",
            "riskFlags": [],
        },
    )
    await drive(db, platform, workflow)

    likes = db.scalars(
        select(Action).where(
            Action.workflow_id == workflow.id, Action.action_type == ActionType.LIKE_POST
        )
    ).all()
    assert len(likes) == 3, "the third post was liked despite scoring 20"

    # ...but commenting still required relevance, so no comment was written.
    assert db.scalar(select(Comment).where(Comment.workflow_id == workflow.id)) is None


async def test_both_overrides_off_engages_fully_on_an_off_topic_post(db, llm, platform) -> None:
    campaign = make_campaign(
        db,
        require_relevance_for_like=False,
        require_relevance_for_comment=False,
        comment_approval=ApprovalMode.AUTOMATIC,
        minimum_relevance_score=75,
    )
    workflow = await discover_one(db, platform, campaign)

    llm.script(
        {"match": True, "score": 90, "matchedCriteria": ["CTO"], "reason": "Fits.", "riskFlags": []},
        {
            "eligible": False,
            "relevanceScore": 20,
            "topics": ["Conference photo"],
            "reason": "Off topic.",
            "riskFlags": [],
        },
    )
    await drive(db, platform, workflow)

    comment = db.scalar(select(Comment).where(Comment.workflow_id == workflow.id))
    assert comment is not None, "commented even though the post scored 20"
    assert comment.posted_at is not None


async def test_the_score_is_recorded_even_when_it_does_not_gate(db, llm, platform) -> None:
    """Overriding the gate must not hide the judgement from the audit trail."""
    campaign = make_campaign(db, require_relevance_for_like=False, minimum_relevance_score=75)
    workflow = await discover_one(db, platform, campaign)

    llm.script(
        {"match": True, "score": 90, "matchedCriteria": ["CTO"], "reason": "Fits.", "riskFlags": []},
        {
            "eligible": False,
            "relevanceScore": 20,
            "topics": ["Conference photo"],
            "reason": "Off topic.",
            "riskFlags": [],
        },
    )
    await drive(db, platform, workflow)

    from app.database.models import PostEvaluation

    evaluation = db.scalar(
        select(PostEvaluation).where(PostEvaluation.campaign_id == campaign.id)
    )
    assert evaluation is not None
    assert evaluation.relevance_score == 20
    assert evaluation.eligible is False
    assert workflow.context["post_relevant"] is False


async def test_dry_run_posts_are_never_marked_as_actually_liked(db, llm, platform) -> None:
    """The UI reads processing_status; it must not claim an action that did not happen."""
    from app.enums import PostProcessingStatus

    campaign = make_campaign(db, comment_approval=ApprovalMode.AUTOMATIC)
    campaign.dry_run = True
    db.flush()

    workflow = await discover_one(db, platform, campaign)
    await drive(db, platform, workflow)

    touched = db.scalars(
        select(Post).where(
            Post.person_id == workflow.person_id,
            Post.processing_status.in_(
                [
                    PostProcessingStatus.LIKED,
                    PostProcessingStatus.COMMENTED,
                    PostProcessingStatus.WOULD_LIKE,
                    PostProcessingStatus.WOULD_COMMENT,
                ]
            ),
        )
    ).all()

    assert touched, "the run should have reached some posts"
    for post in touched:
        assert post.processing_status in (
            PostProcessingStatus.WOULD_LIKE,
            PostProcessingStatus.WOULD_COMMENT,
        ), f"dry run marked a post as {post.processing_status.value}"
    assert not platform.liked_posts and not platform.comments


async def test_live_run_marks_posts_as_genuinely_liked(db, llm, platform) -> None:
    from app.enums import PostProcessingStatus

    campaign = make_campaign(db, comment_approval=ApprovalMode.AUTOMATIC)
    campaign.dry_run = False
    db.flush()

    workflow = await discover_one(db, platform, campaign)
    await drive(db, platform, workflow)

    liked = db.scalars(
        select(Post).where(
            Post.person_id == workflow.person_id,
            Post.processing_status == PostProcessingStatus.LIKED,
        )
    ).all()
    assert liked
    assert platform.liked_posts
