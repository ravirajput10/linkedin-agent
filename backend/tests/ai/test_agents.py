"""Agent contract tests using detached ORM objects and the mock provider."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.ai.agents import (
    CampaignParserAgent,
    CandidateEvaluatorAgent,
    CommentGeneratorAgent,
    ConnectionGeneratorAgent,
    PostEvaluatorAgent,
)
from app.ai.providers.mock_provider import MockLLMProvider
from app.ai.schemas import PostEvaluationResult
from app.database.models import (
    Campaign,
    CampaignCriteria,
    CampaignExclusion,
    Person,
    Post,
    PostEvaluation,
)
from app.enums import CommentLength, CommentStyle, PostType
from app.errors import LLMCapabilityUnsupportedError


@pytest.fixture
def campaign() -> Campaign:
    campaign = Campaign(
        name="Java + AI CTO Outreach",
        instruction="Find CTOs in SaaS companies in India posting about Java and AI.",
    )
    campaign.criteria = CampaignCriteria(
        job_titles=["CTO", "Engineering Manager"],
        industries=["SaaS"],
        locations=["India"],
        seniority_levels=["Executive"],
        company_sizes=[],
        people_keywords=["Java", "AI"],
        include_topics=["Java", "Microservices", "AI"],
        exclude_topics=["Recruitment", "Spam"],
        include_keywords=[],
        exclude_keywords=["hiring"],
        post_types=["TEXT"],
        minimum_relevance_score=75,
        minimum_candidate_score=70,
        comment_length=CommentLength.SHORT,
        comment_style=CommentStyle.TECHNICAL,
    )
    campaign.exclusions = [
        CampaignExclusion(exclusion_type="company", value="Acme", reason="competitor")
    ]
    return campaign


@pytest.fixture
def person() -> Person:
    return Person(
        platform="mock",
        external_id="mock-p-001",
        profile_url="https://mock.local/in/mock-p-001",
        full_name="Ananya Rao",
        headline="CTO at Finflow",
        job_title="CTO",
        company="Finflow",
        industry="SaaS",
        location="Bengaluru, India",
        about="Java, Spring Boot, Kafka and applied AI.",
    )


@pytest.fixture
def post(person: Person) -> Post:
    return Post(
        platform="mock",
        external_id="mock-post-001-a",
        person=person,
        content=(
            "We moved settlement off a shared Postgres table onto Kafka with "
            "per-tenant partitions and p99 dropped because row-lock contention "
            "disappeared during the end-of-day batch."
        ),
        post_type=PostType.TEXT,
        published_at=datetime.now(UTC) - timedelta(hours=18),
        like_count=214,
        comment_count=31,
    )


@pytest.fixture
def llm() -> MockLLMProvider:
    return MockLLMProvider()


async def test_campaign_parser_produces_structured_criteria(llm) -> None:
    result = await CampaignParserAgent(provider=llm).run(
        instruction="Find CTOs in SaaS companies in India who post about Java and AI."
    )
    assert result.data.campaign_name
    assert result.data.target_people.job_titles
    assert result.prompt_version == "v1"
    assert result.provider == "mock"
    assert len(result.input_hash) == 64

    sent = llm.calls[-1]["user"]
    assert "Find CTOs in SaaS companies" in sent
    assert "Initial posts to like before evaluating: 2" in sent


async def test_candidate_evaluator_sends_profile_and_criteria(llm, campaign, person) -> None:
    result = await CandidateEvaluatorAgent(provider=llm).run(
        person=person, campaign=campaign, discovery_reason="Matched CTO, SaaS, India"
    )
    assert 0 <= result.data.score <= 100

    sent = llm.calls[-1]["user"]
    assert "Ananya Rao" in sent
    assert "CTO at Finflow" in sent
    assert "Bengaluru, India" in sent
    assert "Minimum score for a match: 70" in sent
    assert "company: Acme (competitor)" in sent


async def test_post_evaluator_sends_the_post_and_the_threshold(llm, campaign, person, post) -> None:
    await PostEvaluatorAgent(provider=llm).run(post=post, person=person, campaign=campaign)

    sent = llm.calls[-1]["user"]
    assert "per-tenant partitions" in sent
    assert "Minimum relevance score for eligibility: 75" in sent
    assert "Include topics: Java, Microservices, AI" in sent
    assert "Exclude topics: Recruitment, Spam" in sent


async def test_comment_generator_style_reaches_the_system_prompt(
    llm, campaign, person, post
) -> None:
    evaluation = PostEvaluation(
        post_id=1,
        campaign_id=1,
        eligible=True,
        relevance_score=91,
        topics=["Java", "Kafka"],
        reason="Discusses partitioning trade-offs.",
        risk_flags=[],
        agent_name="post_evaluator",
        prompt_version="v1",
        provider="mock",
        model="mock-model",
        input_hash="x" * 64,
    )
    result = await CommentGeneratorAgent(provider=llm).run(
        post=post, person=person, campaign=campaign, evaluation=evaluation
    )
    assert result.data.comment

    call = llm.calls[-1]
    assert "Style: **Technical**" in call["system"]
    assert "25-45 words" in call["system"]
    assert "Topics found in this post: Java, Kafka" in call["user"]


async def test_comment_regeneration_feedback_is_passed_through(llm, campaign, person, post) -> None:
    await CommentGeneratorAgent(provider=llm).run(
        post=post,
        person=person,
        campaign=campaign,
        regeneration_feedback="Make it shorter and drop the question.",
    )
    assert "Make it shorter and drop the question." in llm.calls[-1]["user"]


async def test_connection_generator_marks_whether_a_post_was_available(
    llm, campaign, person, post
) -> None:
    with_post = await ConnectionGeneratorAgent(provider=llm).run(
        person=person, campaign=campaign, reference_post=post
    )
    assert len(with_post.data.message) <= 300
    assert "A post was available to reference: yes" in llm.calls[-1]["user"]

    await ConnectionGeneratorAgent(provider=llm).run(person=person, campaign=campaign)
    assert "A post was available to reference: no" in llm.calls[-1]["user"]
    assert "(no engaged post available)" in llm.calls[-1]["user"]


async def test_agent_refuses_a_provider_without_structured_output(campaign, person) -> None:
    class NoStructured(MockLLMProvider):
        @property
        def capabilities(self):
            base = super().capabilities
            return type(base)(
                supports_structured_output=False,
                supports_tool_calling=False,
                supports_streaming=False,
                supports_vision=False,
                max_context_tokens=base.max_context_tokens,
            )

    with pytest.raises(LLMCapabilityUnsupportedError) as exc:
        await CandidateEvaluatorAgent(provider=NoStructured()).run(
            person=person, campaign=campaign
        )
    assert exc.value.code.value == "LLM_CAPABILITY_UNSUPPORTED"
    assert "candidate_evaluator" in exc.value.message


async def test_identical_input_produces_an_identical_hash(llm, campaign, person, post) -> None:
    agent = PostEvaluatorAgent(provider=llm)
    first = await agent.run(post=post, person=person, campaign=campaign)
    second = await agent.run(post=post, person=person, campaign=campaign)
    assert first.input_hash == second.input_hash


async def test_scripted_response_flows_through_validation(llm, campaign, person, post) -> None:
    llm.script(
        {
            "eligible": True,
            "relevanceScore": 93,
            "topics": ["Kafka"],
            "reason": "Directly about partitioning.",
            "riskFlags": [],
        }
    )
    result = await PostEvaluatorAgent(provider=llm).run(
        post=post, person=person, campaign=campaign
    )
    assert isinstance(result.data, PostEvaluationResult)
    assert result.data.relevance_score == 93
