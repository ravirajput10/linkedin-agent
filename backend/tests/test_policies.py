"""Policy tests — the deterministic gates that decide whether an action happens."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from app.agents import policies
from app.agents.action_executor import build_idempotency_key
from app.enums import (
    ActionType,
    ApprovalMode,
    ApprovalType,
    CampaignStatus,
    ConnectionStatus,
)


def criteria(**overrides):
    base = {
        "minimum_candidate_score": 70,
        "minimum_relevance_score": 75,
        "like_evaluated_post_if_relevant": True,
        "generate_comment": True,
        "candidate_approval": ApprovalMode.AUTOMATIC,
        "comment_approval": ApprovalMode.REQUIRED,
        "connection_approval": ApprovalMode.REQUIRED,
    }
    return SimpleNamespace(**(base | overrides))


def evaluation(**overrides):
    base = {"is_match": True, "score": 90, "reason": "fits"}
    return SimpleNamespace(**(base | overrides))


def post_evaluation(**overrides):
    base = {"eligible": True, "relevance_score": 90, "reason": "on topic"}
    return SimpleNamespace(**(base | overrides))


# ------------------------------------------------------------- thresholds --


def test_candidate_above_threshold_is_accepted() -> None:
    assert policies.candidate_accepted(evaluation(score=90), criteria())


def test_candidate_below_threshold_is_rejected_even_when_ai_says_match() -> None:
    decision = policies.candidate_accepted(evaluation(score=65), criteria())
    assert not decision
    assert "below the campaign threshold" in decision.reason


def test_candidate_rejected_when_ai_says_no_match() -> None:
    assert not policies.candidate_accepted(evaluation(is_match=False, score=95), criteria())


def test_post_at_exactly_the_threshold_is_accepted() -> None:
    assert policies.post_accepted(post_evaluation(relevance_score=75), criteria())


def test_post_one_below_the_threshold_is_rejected() -> None:
    assert not policies.post_accepted(post_evaluation(relevance_score=74), criteria())


def test_post_rejected_when_ai_marks_it_ineligible() -> None:
    assert not policies.post_accepted(
        post_evaluation(eligible=False, relevance_score=99), criteria()
    )


# --------------------------------------------------------------- approvals --


@pytest.mark.parametrize(
    ("approval_type", "field"),
    [
        (ApprovalType.CANDIDATE, "candidate_approval"),
        (ApprovalType.COMMENT, "comment_approval"),
        (ApprovalType.CONNECTION, "connection_approval"),
    ],
)
def test_approval_mode_is_read_per_type(approval_type, field) -> None:
    assert policies.approval_required(criteria(**{field: ApprovalMode.REQUIRED}), approval_type)
    assert not policies.approval_required(
        criteria(**{field: ApprovalMode.AUTOMATIC}), approval_type
    )


# -------------------------------------------------------------- campaigns --


def test_only_a_running_campaign_may_act() -> None:
    for status in CampaignStatus:
        campaign = SimpleNamespace(status=status)
        assert bool(policies.campaign_can_act(campaign)) == (status is CampaignStatus.RUNNING)


def test_exclusion_matches_on_company() -> None:
    campaign = SimpleNamespace(
        exclusions=[
            SimpleNamespace(exclusion_type="company", value="Acme Corp", reason="competitor")
        ]
    )
    person = SimpleNamespace(
        full_name="Ana Rao", company="Acme Corp", profile_url="u", headline=None,
        job_title=None, about=None,
    )
    decision = policies.person_excluded(campaign, person)
    assert decision.allowed
    assert "competitor" in decision.reason


def test_exclusion_does_not_match_unrelated_people() -> None:
    campaign = SimpleNamespace(
        exclusions=[SimpleNamespace(exclusion_type="company", value="Acme", reason=None)]
    )
    person = SimpleNamespace(
        full_name="Ana Rao", company="Finflow", profile_url="u", headline=None,
        job_title=None, about=None,
    )
    assert not policies.person_excluded(campaign, person).allowed


# ----------------------------------------------------------- revalidation --


def base_campaign():
    return SimpleNamespace(status=CampaignStatus.RUNNING, exclusions=[])


def base_person():
    return SimpleNamespace(
        full_name="Ana Rao", company="Finflow", profile_url="u", headline=None,
        job_title=None, about=None,
    )


def test_revalidation_passes_when_everything_checks_out() -> None:
    outcome = policies.revalidate_connection(
        campaign=base_campaign(),
        person=base_person(),
        connection_status=ConnectionStatus.NOT_CONNECTED,
        has_recent_activity=True,
        daily_limit_available=True,
    )
    assert outcome.eligible
    assert outcome.checks["already_connected"] == "NO"
    assert outcome.checks["daily_limit"] == "AVAILABLE"


@pytest.mark.parametrize(
    ("kwargs", "expected"),
    [
        ({"connection_status": ConnectionStatus.CONNECTED}, "Already connected"),
        ({"connection_status": ConnectionStatus.PENDING}, "already pending"),
        ({"has_recent_activity": False}, "No recent activity"),
        ({"daily_limit_available": False}, "Daily connection limit"),
    ],
)
def test_revalidation_blocks_on_each_failing_check(kwargs, expected) -> None:
    defaults = {
        "campaign": base_campaign(),
        "person": base_person(),
        "connection_status": ConnectionStatus.NOT_CONNECTED,
        "has_recent_activity": True,
        "daily_limit_available": True,
    }
    outcome = policies.revalidate_connection(**(defaults | kwargs))
    assert not outcome.eligible
    assert expected in outcome.reason


def test_revalidation_blocks_when_the_campaign_is_paused() -> None:
    campaign = SimpleNamespace(status=CampaignStatus.PAUSED, exclusions=[])
    outcome = policies.revalidate_connection(
        campaign=campaign,
        person=base_person(),
        connection_status=ConnectionStatus.NOT_CONNECTED,
        has_recent_activity=True,
        daily_limit_available=True,
    )
    assert not outcome.eligible
    assert outcome.checks["campaign_active"] == "NO"


def test_unknown_connection_status_does_not_block() -> None:
    """Some platforms expose no way to read this; the adapter reports the truth."""
    outcome = policies.revalidate_connection(
        campaign=base_campaign(),
        person=base_person(),
        connection_status=ConnectionStatus.UNKNOWN,
        has_recent_activity=True,
        daily_limit_available=True,
    )
    assert outcome.eligible


def test_recent_activity_window() -> None:
    now = datetime.now(UTC)
    assert policies.has_recent_activity(SimpleNamespace(last_activity_at=now - timedelta(days=5)))
    assert not policies.has_recent_activity(
        SimpleNamespace(last_activity_at=now - timedelta(days=45))
    )
    assert not policies.has_recent_activity(SimpleNamespace(last_activity_at=None))


# ------------------------------------------------------------ retry/backoff --


def test_backoff_grows_and_is_capped() -> None:
    delays = [policies.retry_delay_seconds(n) for n in range(1, 10)]
    assert delays[0] == 30
    assert delays[1] == 60
    assert delays == sorted(delays)
    assert max(delays) <= 3600


def test_workflow_pauses_once_failures_reach_the_threshold() -> None:
    assert not policies.should_pause_workflow(SimpleNamespace(consecutive_failures=2), 3)
    assert policies.should_pause_workflow(SimpleNamespace(consecutive_failures=3), 3)


# ------------------------------------------------------------ idempotency --


def test_idempotency_key_is_stable_and_distinct() -> None:
    a = build_idempotency_key(ActionType.LIKE_POST, 1, person_id=2, post_id=3)
    b = build_idempotency_key(ActionType.LIKE_POST, 1, person_id=2, post_id=3)
    assert a == b

    assert a != build_idempotency_key(ActionType.LIKE_POST, 1, person_id=2, post_id=4)
    assert a != build_idempotency_key(ActionType.COMMENT_POST, 1, person_id=2, post_id=3)
    assert a != build_idempotency_key(ActionType.LIKE_POST, 9, person_id=2, post_id=3)
