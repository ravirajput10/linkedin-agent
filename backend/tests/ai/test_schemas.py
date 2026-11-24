from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.ai.schemas import (
    BANNED_COMMENT_OPENERS,
    CandidateEvaluationResult,
    GeneratedComment,
    GeneratedConnectionMessage,
    ParsedCampaign,
    PostEvaluationResult,
)


def test_parsed_campaign_accepts_camel_case() -> None:
    parsed = ParsedCampaign.model_validate(
        {
            "campaignName": "Java CTO Outreach",
            "targetPeople": {"jobTitles": ["CTO"], "locations": ["India"]},
            "postCriteria": {"includeTopics": ["Java"], "minimumRelevanceScore": 80},
        }
    )
    assert parsed.campaign_name == "Java CTO Outreach"
    assert parsed.target_people.job_titles == ["CTO"]
    assert parsed.post_criteria.minimum_relevance_score == 80
    # Defaults fill in what the model left out.
    assert parsed.engagement.initial_posts_to_like == 2
    assert parsed.engagement.connection_delay_hours == 48


def test_unknown_fields_are_rejected() -> None:
    with pytest.raises(ValidationError):
        PostEvaluationResult.model_validate(
            {
                "eligible": True,
                "relevanceScore": 90,
                "reason": "on topic",
                "hallucinatedField": "surprise",
            }
        )


@pytest.mark.parametrize("score", [-1, 101, 1000])
def test_scores_are_bounded(score: int) -> None:
    with pytest.raises(ValidationError):
        PostEvaluationResult.model_validate(
            {"eligible": True, "relevanceScore": score, "reason": "x"}
        )


def test_candidate_evaluation_requires_a_reason() -> None:
    with pytest.raises(ValidationError):
        CandidateEvaluationResult.model_validate({"match": True, "score": 90, "reason": ""})


@pytest.mark.parametrize("opener", BANNED_COMMENT_OPENERS)
def test_generic_comment_openers_are_rejected(opener: str) -> None:
    with pytest.raises(ValidationError):
        GeneratedComment.model_validate(
            {"comment": f"{opener.capitalize()}! I really enjoyed reading this today."}
        )


def test_specific_comment_is_accepted() -> None:
    comment = GeneratedComment.model_validate(
        {
            "comment": (
                "The locking point is the part most teams miss — adding consumers "
                "does nothing when the contention is on the row, not the queue."
            ),
            "referencedPoints": ["row locks during end-of-day batch"],
        }
    )
    assert comment.confidence == 80


def test_connection_message_respects_the_platform_limit() -> None:
    with pytest.raises(ValidationError):
        GeneratedConnectionMessage.model_validate({"message": "x" * 301})

    message = GeneratedConnectionMessage.model_validate(
        {"message": "Hi Ana, your point about event-driven settlement stuck with me.",
         "referencedPost": True}
    )
    assert message.referenced_post is True


def test_round_trip_uses_camel_case_aliases() -> None:
    result = PostEvaluationResult(
        eligible=True, relevance_score=91, topics=["Java"], reason="on topic"
    )
    dumped = result.model_dump(by_alias=True)
    assert dumped["relevanceScore"] == 91
    assert dumped["riskFlags"] == []


# ------------------------------------------------- fabricated experience --

FABRICATIONS = [
    "This mirrors our experience migrating from pooled connections to Kafka.",
    "We've seen the same trade-off in Java-based microservices at scale.",
    "In my experience this falls over once the batch window overlaps.",
    "At my company we hit exactly this during the end-of-day run.",
    "When we migrated, p99 dropped for the same reason.",
    "I have shipped this pattern across several teams.",
    "Our team solved this with per-tenant partitioning.",
]

GROUNDED = [
    "The point about row locks is what most teams miss — adding consumers does "
    "nothing when the contention is on the row.",
    "Partitioning shifts contention rather than removing it; the rebalancing "
    "cost usually shows up later.",
    "Worth separating the throughput question from the locking one, since they "
    "have different fixes.",
]


@pytest.mark.parametrize("text", FABRICATIONS)
def test_comments_claiming_first_hand_experience_are_rejected(text: str) -> None:
    """The sender never said they did these things; the model invented it."""
    with pytest.raises(ValidationError, match="first-hand experience"):
        GeneratedComment.model_validate({"comment": text})


@pytest.mark.parametrize("text", GROUNDED)
def test_grounded_comments_pass(text: str) -> None:
    assert GeneratedComment.model_validate({"comment": text}).comment == text


@pytest.mark.parametrize("text", FABRICATIONS[:3])
def test_connection_notes_are_held_to_the_same_rule(text: str) -> None:
    with pytest.raises(ValidationError, match="first-hand experience"):
        GeneratedConnectionMessage.model_validate({"message": text})


def test_the_rejection_explains_what_to_do_instead() -> None:
    with pytest.raises(ValidationError) as exc:
        GeneratedComment.model_validate({"comment": FABRICATIONS[0]})
    assert "Write about the post's idea" in str(exc.value)
