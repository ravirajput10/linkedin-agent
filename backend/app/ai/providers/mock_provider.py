"""Deterministic provider for tests and offline development.

Produces schema-valid results without any network call, so the end-to-end
workflow is exercisable with ``LLM_PROVIDER=mock``.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import deque
from typing import Any

from pydantic import BaseModel

from app.ai.provider import (
    LLMCapabilities,
    LLMProvider,
    LLMResponse,
    StructuredLLMResponse,
    TokenUsage,
)
from app.errors import AIProviderError

_WORD_RE = re.compile(r"[A-Za-z][A-Za-z+#.\-]{2,}")


class MockLLMProvider(LLMProvider):
    """Derives stable pseudo-random answers from a hash of the prompt."""

    name = "mock"

    def __init__(
        self,
        model: str = "mock-model",
        *,
        max_retries: int = 2,
        timeout_seconds: float = 5.0,
        forced_score: int | None = None,
    ) -> None:
        super().__init__(model, max_retries=max_retries, timeout_seconds=timeout_seconds)
        self.forced_score = forced_score
        self.calls: list[dict[str, Any]] = []
        #: Queue of canned responses; tests push dicts or exceptions onto it.
        self.scripted: deque[Any] = deque()

    @property
    def capabilities(self) -> LLMCapabilities:
        return LLMCapabilities(
            supports_structured_output=True,
            supports_tool_calling=False,
            supports_streaming=False,
            supports_vision=False,
            max_context_tokens=32_768,
        )

    def script(self, *responses: Any) -> None:
        """Queue responses (or exceptions) returned by the next calls."""
        self.scripted.extend(responses)

    async def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        **kwargs: Any,
    ) -> LLMResponse:
        self.calls.append({"system": system_prompt, "user": user_prompt, "kwargs": kwargs})
        if self.scripted:
            nxt = self.scripted.popleft()
            if isinstance(nxt, Exception):
                raise nxt
            text = nxt if isinstance(nxt, str) else json.dumps(nxt)
        else:
            text = "OK"
        return LLMResponse(
            text=text,
            provider=self.name,
            model=self.model,
            usage=TokenUsage(
                input_tokens=len(system_prompt) // 4 + len(user_prompt) // 4,
                output_tokens=len(text) // 4,
                estimated_cost_usd=0.0,
            ),
        )

    async def generate_structured[T: BaseModel](
        self,
        system_prompt: str,
        user_prompt: str,
        response_schema: type[T],
        **kwargs: Any,
    ) -> StructuredLLMResponse[T]:
        self.calls.append(
            {
                "system": system_prompt,
                "user": user_prompt,
                "schema": response_schema.__name__,
                "kwargs": kwargs,
            }
        )

        if self.scripted:
            nxt = self.scripted.popleft()
            if isinstance(nxt, Exception):
                raise nxt
            payload = json.loads(nxt) if isinstance(nxt, str) else nxt
        else:
            payload = self._synthesise(response_schema.__name__, user_prompt)

        data = response_schema.model_validate(payload)
        return StructuredLLMResponse(
            data=data,
            text=json.dumps(payload),
            provider=self.name,
            model=self.model,
            usage=TokenUsage(
                input_tokens=len(user_prompt) // 4,
                output_tokens=40,
                estimated_cost_usd=0.0,
            ),
        )

    # -- synthesis ----------------------------------------------------------

    def _score(self, seed: str, floor: int = 60, ceiling: int = 97) -> int:
        if self.forced_score is not None:
            return self.forced_score
        digest = hashlib.sha256(seed.encode("utf-8")).digest()
        return floor + digest[0] % max(1, ceiling - floor + 1)

    @staticmethod
    def _topics(text: str, limit: int = 4) -> list[str]:
        seen: list[str] = []
        for match in _WORD_RE.finditer(text):
            word = match.group(0)
            if word[0].isupper() and word not in seen:
                seen.append(word)
            if len(seen) >= limit:
                break
        return seen or ["General"]

    def _synthesise(self, schema_name: str, user_prompt: str) -> dict[str, Any]:
        score = self._score(user_prompt)
        topics = self._topics(user_prompt)

        match schema_name:
            case "ParsedCampaign":
                return {
                    "campaignName": "Mock Campaign",
                    "targetPeople": {
                        "jobTitles": ["CTO", "Engineering Manager"],
                        "industries": ["SaaS", "Software"],
                        "locations": ["India"],
                        "keywords": topics,
                        "seniorityLevels": ["Senior", "Executive"],
                        "companySizes": [],
                    },
                    "postCriteria": {
                        "includeTopics": topics,
                        "excludeTopics": ["Recruitment", "Jobs", "Spam", "Generic Motivation"],
                        "includeKeywords": [],
                        "excludeKeywords": ["hiring", "apply now"],
                        "postTypes": ["TEXT", "ARTICLE"],
                        "minimumRelevanceScore": 75,
                    },
                    "engagement": {
                        "initialPostsToLike": 2,
                        "evaluatePostIndex": 3,
                        "generateComment": True,
                        "connectionDelayHours": 48,
                        "maxPeoplePerDay": 20,
                    },
                    "summary": "Mock parse of the supplied instruction.",
                }
            case "CandidateEvaluationResult":
                return {
                    "match": score >= 50,
                    "score": score,
                    "matchedCriteria": topics,
                    "reason": (
                        "Mock evaluation: the profile headline overlaps with the "
                        "campaign's target roles and topics."
                    ),
                    "riskFlags": [],
                }
            case "PostEvaluationResult":
                return {
                    "eligible": score >= 75,
                    "relevanceScore": score,
                    "topics": topics,
                    "reason": (
                        "Mock evaluation: the post discusses topics that overlap "
                        "with the campaign's include list."
                    ),
                    "riskFlags": [],
                }
            case "GeneratedComment":
                return {
                    "comment": (
                        f"The point about {topics[0].lower()} is worth underlining — "
                        "the trade-off between coupling and independent scaling is "
                        "exactly where most teams get stuck."
                    ),
                    "referencedPoints": topics[:2],
                    "confidence": score,
                }
            case "GeneratedConnectionMessage":
                return {
                    "message": (
                        f"Hi there, I enjoyed your recent post on {topics[0].lower()}. "
                        "I work around software engineering and AI initiatives and "
                        "would be glad to connect."
                    ),
                    "referencedPost": True,
                    "confidence": score,
                }
            case "PostGeneratorResult":
                topic = topics[0] if topics else "Building with AI"
                return {
                    "drafts": [
                        {
                            "title": f"3 lessons from shipping {topic}",
                            "content": (
                                f"We worked extensively on {topic} this year. Three critical lessons learned:\n\n"
                                "1. Write the evaluation criteria before the prompts.\n"
                                "2. Roll out by micro-workflow, not all at once.\n"
                                "3. Make graceful human hand-off a first-class feature.\n\n"
                                "What has been your experience?\n\n#SoftwareEngineering #AI #Leadership"
                            ),
                            "hookType": "story",
                            "estimatedReadingTimeSeconds": 45,
                        },
                        {
                            "title": f"Why {topic} architectures fail at scale",
                            "content": (
                                f"Most projects around {topic} don't fail due to technology limitations.\n\n"
                                "They fail because context is treated like a junk drawer instead of an operating table.\n\n"
                                "3 rules our engineering team enforces:\n"
                                "• Deterministic guards around all write actions\n"
                                "• Strict schema validation at every boundary\n"
                                "• Full auditability and rollback mechanisms\n\n"
                                "#TechStack #Architecture #Engineering"
                            ),
                            "hookType": "framework",
                            "estimatedReadingTimeSeconds": 40,
                        },
                        {
                            "title": f"Poll: Approach to {topic} in production",
                            "content": (
                                f"Quick question for engineering teams deploying {topic}:\n\n"
                                "When scaling your production workflows, do you:\n"
                                "1. Build custom orchestration internally\n"
                                "2. Use open-source frameworks\n"
                                "3. Rely on managed SaaS platforms\n\n"
                                "Drop your thoughts below!\n\n#Poll #EngineeringLeadership #Tech"
                            ),
                            "hookType": "question",
                            "estimatedReadingTimeSeconds": 35,
                        },
                    ]
                }

        raise AIProviderError(
            f"MockLLMProvider has no synthetic response for schema {schema_name!r}. "
            "Queue one with MockLLMProvider.script()."
        )
