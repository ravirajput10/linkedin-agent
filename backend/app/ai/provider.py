"""Provider-neutral LLM interface.

Agents depend on :class:`LLMProvider` and never on a vendor SDK. Swapping
Claude for a local GPU model is a configuration change, not a code change.
"""

from __future__ import annotations

import json
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, TypeVar

from pydantic import BaseModel
from pydantic import ValidationError as PydanticValidationError

from app.errors import AIInvalidResponseError, AIProviderError, ErrorCode
from app.logging import get_logger

logger = get_logger(__name__)

SchemaT = TypeVar("SchemaT", bound=BaseModel)


@dataclass(frozen=True, slots=True)
class LLMCapabilities:
    supports_structured_output: bool = False
    supports_tool_calling: bool = False
    supports_streaming: bool = False
    supports_vision: bool = False
    max_context_tokens: int = 8192


@dataclass(slots=True)
class TokenUsage:
    input_tokens: int | None = None
    output_tokens: int | None = None
    estimated_cost_usd: float | None = None
    gpu_seconds: float | None = None


@dataclass(slots=True)
class LLMResponse:
    text: str
    provider: str
    model: str
    usage: TokenUsage = field(default_factory=TokenUsage)
    attempt_count: int = 1
    raw: dict[str, Any] | None = None


@dataclass
class StructuredLLMResponse[SchemaT: BaseModel]:
    data: SchemaT
    text: str
    provider: str
    model: str
    usage: TokenUsage = field(default_factory=TokenUsage)
    attempt_count: int = 1


_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL)


def extract_json(text: str) -> dict[str, Any]:
    """Pull a JSON object out of a model response.

    Local models routinely wrap JSON in prose or code fences, so the raw text is
    never trusted. Raises :class:`AIInvalidResponseError` when nothing parses.
    """
    candidates: list[str] = []

    stripped = text.strip()
    if stripped:
        candidates.append(stripped)

    fenced = _FENCE_RE.search(text)
    if fenced:
        candidates.insert(0, fenced.group(1))

    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end > start:
        candidates.append(text[start : end + 1])

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed

    raise AIInvalidResponseError(
        "Model response did not contain a JSON object.",
        details={"response_preview": text[:500]},
    )


class LLMProvider(ABC):
    """Contract every provider implements identically."""

    name: str = "base"

    def __init__(self, model: str, *, max_retries: int = 2, timeout_seconds: float = 120.0) -> None:
        self.model = model
        self.max_retries = max(0, max_retries)
        self.timeout_seconds = timeout_seconds

    @property
    @abstractmethod
    def capabilities(self) -> LLMCapabilities: ...

    @abstractmethod
    async def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        **kwargs: Any,
    ) -> LLMResponse:
        """Free-form text completion."""

    async def generate_structured[T: BaseModel](
        self,
        system_prompt: str,
        user_prompt: str,
        response_schema: type[T],
        **kwargs: Any,
    ) -> StructuredLLMResponse[T]:
        """Schema-validated completion.

        Default strategy, used when a provider has no native structured output:
        strict JSON instruction -> parse -> Pydantic validation -> repair retry.
        Providers with native support override this.
        """
        return await self._generate_structured_by_prompting(
            system_prompt, user_prompt, response_schema, **kwargs
        )

    async def _generate_structured_by_prompting[T: BaseModel](
        self,
        system_prompt: str,
        user_prompt: str,
        response_schema: type[T],
        **kwargs: Any,
    ) -> StructuredLLMResponse[T]:
        schema_json = json.dumps(response_schema.model_json_schema(), indent=2)
        instruction = (
            "\n\nRespond with a single JSON object and nothing else. "
            "No prose, no explanation, no markdown fences. "
            f"It must validate against this JSON Schema:\n{schema_json}"
        )

        attempt_prompt = user_prompt + instruction
        last_error: Exception | None = None
        total_usage = TokenUsage(input_tokens=0, output_tokens=0, estimated_cost_usd=0.0)
        text = ""

        for attempt in range(1, self.max_retries + 2):
            response = await self.generate(system_prompt, attempt_prompt, **kwargs)
            text = response.text
            _accumulate(total_usage, response.usage)

            try:
                payload = extract_json(response.text)
                data = response_schema.model_validate(payload)
            except (AIInvalidResponseError, PydanticValidationError) as exc:
                last_error = exc
                logger.warning(
                    "Structured output invalid (attempt %s/%s) for %s: %s",
                    attempt,
                    self.max_retries + 1,
                    response_schema.__name__,
                    exc,
                )
                attempt_prompt = (
                    f"{user_prompt}{instruction}\n\n"
                    "Your previous response was rejected:\n"
                    f"{_summarise_error(exc)}\n"
                    "Return only the corrected JSON object."
                )
                continue

            return StructuredLLMResponse(
                data=data,
                text=response.text,
                provider=self.name,
                model=self.model,
                usage=total_usage,
                attempt_count=attempt,
            )

        raise AIInvalidResponseError(
            f"{self.name} did not return valid {response_schema.__name__} "
            f"after {self.max_retries + 1} attempts.",
            details={
                "schema": response_schema.__name__,
                "last_error": str(last_error),
                "response_preview": text[:500],
            },
        )

    async def health_check(self) -> bool:
        try:
            await self.generate("You are a health probe.", "Reply with OK.")
        except AIProviderError:
            return False
        return True

    async def aclose(self) -> None:
        """Release provider resources. Overridden where a client is held."""


def _accumulate(total: TokenUsage, usage: TokenUsage) -> None:
    if usage.input_tokens is not None:
        total.input_tokens = (total.input_tokens or 0) + usage.input_tokens
    if usage.output_tokens is not None:
        total.output_tokens = (total.output_tokens or 0) + usage.output_tokens
    if usage.estimated_cost_usd is not None:
        total.estimated_cost_usd = (total.estimated_cost_usd or 0.0) + usage.estimated_cost_usd
    if usage.gpu_seconds is not None:
        total.gpu_seconds = (total.gpu_seconds or 0.0) + usage.gpu_seconds


def _summarise_error(exc: Exception) -> str:
    if isinstance(exc, PydanticValidationError):
        return "; ".join(
            f"{'.'.join(str(p) for p in err['loc'])}: {err['msg']}" for err in exc.errors()[:8]
        )
    return str(exc)


__all__ = [
    "ErrorCode",
    "LLMCapabilities",
    "LLMProvider",
    "LLMResponse",
    "StructuredLLMResponse",
    "TokenUsage",
    "extract_json",
]
