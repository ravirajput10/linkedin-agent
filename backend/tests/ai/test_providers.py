"""Provider contract tests. No API key, no GPU, no network."""

from __future__ import annotations

import json

import pytest

from app.ai.provider import LLMProvider, LLMResponse, TokenUsage, extract_json
from app.ai.providers.mock_provider import MockLLMProvider
from app.ai.schemas import PostEvaluationResult
from app.config import LLMProviderName, Settings
from app.errors import AIInvalidResponseError, AIProviderError


class FlakyProvider(LLMProvider):
    """Returns a scripted sequence of raw text responses."""

    name = "flaky"

    def __init__(self, responses: list[str], **kwargs) -> None:
        super().__init__("flaky-model", **kwargs)
        self.responses = list(responses)
        self.calls: list[str] = []

    @property
    def capabilities(self):
        from app.ai.provider import LLMCapabilities

        return LLMCapabilities(supports_structured_output=False, max_context_tokens=8192)

    async def generate(self, system_prompt: str, user_prompt: str, **kwargs) -> LLMResponse:
        self.calls.append(user_prompt)
        text = self.responses.pop(0) if self.responses else "{}"
        return LLMResponse(
            text=text,
            provider=self.name,
            model=self.model,
            usage=TokenUsage(input_tokens=10, output_tokens=5, estimated_cost_usd=0.0),
        )


VALID = json.dumps(
    {"eligible": True, "relevanceScore": 88, "topics": ["Java"], "reason": "on topic"}
)


def test_extract_json_handles_code_fences() -> None:
    assert extract_json(f"```json\n{VALID}\n```")["relevanceScore"] == 88


def test_extract_json_handles_surrounding_prose() -> None:
    assert extract_json(f"Sure, here you go:\n{VALID}\nHope that helps!")["eligible"] is True


def test_extract_json_rejects_garbage() -> None:
    with pytest.raises(AIInvalidResponseError):
        extract_json("I'm afraid I cannot do that.")


async def test_prompting_fallback_parses_valid_json() -> None:
    provider = FlakyProvider([VALID])
    result = await provider.generate_structured("sys", "user", PostEvaluationResult)
    assert result.data.relevance_score == 88
    assert result.attempt_count == 1
    # The schema is injected into the prompt so the model knows the shape.
    assert "JSON Schema" in provider.calls[0]


async def test_invalid_output_triggers_a_repair_retry() -> None:
    provider = FlakyProvider(["not json at all", VALID], max_retries=2)
    result = await provider.generate_structured("sys", "user", PostEvaluationResult)
    assert result.attempt_count == 2
    assert "previous response was rejected" in provider.calls[1]


async def test_schema_violation_triggers_a_repair_retry() -> None:
    bad = json.dumps({"eligible": True, "relevanceScore": 500, "reason": "x"})
    provider = FlakyProvider([bad, VALID], max_retries=2)
    result = await provider.generate_structured("sys", "user", PostEvaluationResult)
    assert result.data.relevance_score == 88
    assert result.attempt_count == 2


async def test_giving_up_raises_rather_than_returning_junk() -> None:
    provider = FlakyProvider(["nope", "still nope", "nope again"], max_retries=2)
    with pytest.raises(AIInvalidResponseError) as exc:
        await provider.generate_structured("sys", "user", PostEvaluationResult)
    assert "after 3 attempts" in str(exc.value)


async def test_usage_accumulates_across_retries() -> None:
    provider = FlakyProvider(["nope", VALID], max_retries=2)
    result = await provider.generate_structured("sys", "user", PostEvaluationResult)
    assert result.usage.input_tokens == 20
    assert result.usage.output_tokens == 10


async def test_mock_provider_synthesises_every_agent_schema() -> None:
    from app.ai.schemas import (
        CandidateEvaluationResult,
        GeneratedComment,
        GeneratedConnectionMessage,
        ParsedCampaign,
    )

    provider = MockLLMProvider()
    for schema in (
        ParsedCampaign,
        CandidateEvaluationResult,
        PostEvaluationResult,
        GeneratedComment,
        GeneratedConnectionMessage,
    ):
        result = await provider.generate_structured("sys", "Java Spring Boot AI", schema)
        assert isinstance(result.data, schema)


async def test_mock_provider_is_deterministic() -> None:
    a = await MockLLMProvider().generate_structured("s", "same input", PostEvaluationResult)
    b = await MockLLMProvider().generate_structured("s", "same input", PostEvaluationResult)
    assert a.data.relevance_score == b.data.relevance_score


async def test_mock_provider_scripting_supports_failure_injection() -> None:
    provider = MockLLMProvider()
    provider.script(AIProviderError("provider is down"))
    with pytest.raises(AIProviderError):
        await provider.generate_structured("s", "u", PostEvaluationResult)


async def test_mock_provider_forced_score_drives_eligibility() -> None:
    low = MockLLMProvider(forced_score=40)
    result = await low.generate_structured("s", "u", PostEvaluationResult)
    assert result.data.eligible is False
    assert result.data.relevance_score == 40


def test_factory_selects_the_configured_provider() -> None:
    from app.ai.provider_factory import build_llm_provider

    mock = build_llm_provider(Settings(llm_provider=LLMProviderName.MOCK))
    assert mock.name == "mock"

    local = build_llm_provider(
        Settings(llm_provider=LLMProviderName.LOCAL, local_llm_model="qwen3")
    )
    assert local.name == "local"
    assert local.model == "qwen3"


def test_claude_provider_refuses_to_start_without_a_key() -> None:
    from app.ai.provider_factory import build_llm_provider

    with pytest.raises(AIProviderError, match="CLAUDE_API_KEY"):
        build_llm_provider(Settings(llm_provider=LLMProviderName.CLAUDE, claude_api_key=""))


def test_capabilities_are_reported_per_provider() -> None:
    from app.ai.providers.local_provider import LocalLLMProvider

    assert MockLLMProvider().capabilities.supports_structured_output is True

    constrained = LocalLLMProvider(
        "http://localhost:11434", "tiny-model", supports_structured_output=False
    )
    assert constrained.capabilities.supports_structured_output is False
    assert constrained.capabilities.supports_tool_calling is False


# ------------------------------------------------- local grammar simplification --


def test_grammar_simplification_drops_unsupported_constraints() -> None:
    """Ollama's grammar compiler rejects schemas combining these keywords."""
    from app.ai.providers.local_provider import simplify_for_grammar

    simplified = simplify_for_grammar(PostEvaluationResult.model_json_schema())
    properties = simplified["properties"]

    assert "minLength" not in properties["reason"]
    assert "maxLength" not in properties["reason"]

    # maxItems must survive: it is what stops the model looping on list fields.
    assert properties["topics"]["maxItems"] == 20
    assert properties["relevanceScore"]["minimum"] == 0
    assert properties["relevanceScore"]["maximum"] == 100


def test_grammar_simplification_preserves_structure() -> None:
    """Shape is what the grammar is for; constraints are Pydantic's job."""
    from app.ai.providers.local_provider import simplify_for_grammar

    simplified = simplify_for_grammar(PostEvaluationResult.model_json_schema())

    assert simplified["type"] == "object"
    assert simplified["additionalProperties"] is False
    assert set(simplified["required"]) == {"eligible", "relevanceScore", "reason"}
    assert simplified["properties"]["eligible"]["type"] == "boolean"
    assert simplified["properties"]["relevanceScore"]["type"] == "integer"
    assert simplified["properties"]["topics"]["items"]["type"] == "string"


def test_grammar_simplification_recurses_into_nested_models() -> None:
    from app.ai.providers.local_provider import (
        GRAMMAR_UNSUPPORTED_KEYWORDS,
        simplify_for_grammar,
    )
    from app.ai.schemas import ParsedCampaign

    simplified = simplify_for_grammar(ParsedCampaign.model_json_schema())

    def keys(node):
        if isinstance(node, dict):
            for key, value in node.items():
                yield key
                yield from keys(value)
        elif isinstance(node, list):
            for item in node:
                yield from keys(item)

    assert GRAMMAR_UNSUPPORTED_KEYWORDS.isdisjoint(set(keys(simplified)))
    assert "$defs" in simplified, "nested model definitions must survive"


async def test_constrained_path_still_validates_against_the_full_schema(monkeypatch) -> None:
    """The sampler stops policing ranges, so Pydantic must still do it.

    This is the risk the grammar simplification introduces: validating against
    the simplified schema would silently accept relevanceScore=150.
    """
    from app.ai.providers.local_provider import LocalLLMProvider

    provider = LocalLLMProvider("http://localhost:11434", "fake-model", max_retries=1)
    replies = [
        {"message": {"content": json.dumps(
            {"eligible": True, "relevanceScore": 150, "reason": "out of range"}
        )}},
        {"message": {"content": json.dumps(
            {"eligible": True, "relevanceScore": 88, "reason": "within range"}
        )}},
    ]
    sent: list[dict] = []

    class FakeResponse:
        def __init__(self, payload):
            self._payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self._payload

    async def fake_post(url, json=None, **kwargs):
        sent.append(json)
        return FakeResponse(replies.pop(0))

    monkeypatch.setattr(provider._client, "post", fake_post)

    result = await provider.generate_structured("sys", "user", PostEvaluationResult)

    assert result.data.relevance_score == 88, "the 150 response must have been rejected"
    assert result.attempt_count == 2

    # The grammar it sent carried no string-length bounds...
    grammar = sent[0]["format"]
    assert "maxLength" not in grammar["properties"]["reason"]
    # ...but the contract the caller gets back is unchanged.
    assert 0 <= result.data.relevance_score <= 100

    await provider.aclose()


async def test_a_fabricated_comment_is_retried_not_surfaced() -> None:
    """A model inventing experience must not fail the workflow outright.

    The repair retry exists for exactly this: ask again, and only give up if it
    keeps happening.
    """
    from app.ai.schemas import GeneratedComment

    fabricated = json.dumps(
        {"comment": "This mirrors our experience migrating that pipeline to Kafka."}
    )
    grounded = json.dumps(
        {"comment": "The locking point is the part most teams miss when they scale consumers."}
    )
    provider = FlakyProvider([fabricated, grounded], max_retries=2)

    result = await provider.generate_structured("sys", "user", GeneratedComment)
    assert result.attempt_count == 2
    assert "our experience" not in result.data.comment
    assert "first-hand experience" in provider.calls[1], "the retry must say why"
