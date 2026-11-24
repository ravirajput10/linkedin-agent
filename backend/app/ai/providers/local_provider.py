"""Local / self-hosted model provider (Ollama-compatible HTTP API).

The model name is configuration, never code. Any Ollama-served model works.
"""

from __future__ import annotations

import time
from typing import Any

import httpx
from pydantic import BaseModel
from pydantic import ValidationError as PydanticValidationError

from app.ai.provider import (
    LLMCapabilities,
    LLMProvider,
    LLMResponse,
    StructuredLLMResponse,
    TokenUsage,
    extract_json,
)
from app.errors import AIInvalidResponseError, AIProviderError
from app.logging import get_logger

logger = get_logger(__name__)


#: String length bounds break Ollama's GBNF grammar compiler. Any schema
#: carrying ``minLength``/``maxLength`` is rejected with
#: "Failed to initialize samplers: failed to parse grammar" and a bare 400.
#:
#: Dropping them from the *grammar* is safe: Pydantic still enforces them when
#: the response is validated, so a too-short comment is rejected exactly as
#: before — by the schema rather than by the sampler — and the repair retry asks
#: again.
#:
#: Everything else is deliberately left in place. ``maxItems`` in particular
#: must survive: without it the grammar permits unbounded arrays and the model
#: degenerates into repeating near-duplicate list entries until it hits the
#: token limit. Bisected against qwen3:32b on Ollama; extend this set only with
#: a keyword you have actually watched fail.
GRAMMAR_UNSUPPORTED_KEYWORDS = frozenset({"minLength", "maxLength"})


def simplify_for_grammar(schema: Any) -> Any:
    """Remove constraint keywords the grammar compiler cannot handle.

    Structure — types, properties, required, enums, array bounds, nesting — is
    preserved, because that is what the grammar exists to enforce.
    """
    if isinstance(schema, dict):
        return {
            key: simplify_for_grammar(value)
            for key, value in schema.items()
            if key not in GRAMMAR_UNSUPPORTED_KEYWORDS
        }
    if isinstance(schema, list):
        return [simplify_for_grammar(item) for item in schema]
    return schema


class LocalLLMProvider(LLMProvider):
    name = "local"

    def __init__(
        self,
        base_url: str,
        model: str,
        *,
        supports_structured_output: bool = True,
        max_context_tokens: int = 32_768,
        think: bool | None = None,
        max_output_tokens: int = 1536,
        max_retries: int = 2,
        timeout_seconds: float = 120.0,
    ) -> None:
        super().__init__(model, max_retries=max_retries, timeout_seconds=timeout_seconds)
        self.base_url = base_url.rstrip("/")
        self._supports_structured_output = supports_structured_output
        self._max_context_tokens = max_context_tokens
        self._think = think
        self._max_output_tokens = max_output_tokens
        self._client = httpx.AsyncClient(base_url=self.base_url, timeout=timeout_seconds)

    @property
    def capabilities(self) -> LLMCapabilities:
        return LLMCapabilities(
            supports_structured_output=self._supports_structured_output,
            supports_tool_calling=False,
            supports_streaming=True,
            supports_vision=False,
            max_context_tokens=self._max_context_tokens,
        )

    async def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        **kwargs: Any,
    ) -> LLMResponse:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "stream": False,
        }
        json_schema = kwargs.pop("json_schema", None)
        if json_schema is not None:
            payload["format"] = json_schema
        think = kwargs.pop("think", self._think)
        if think is not None:
            payload["think"] = think
        options = dict(kwargs.pop("options", None) or {})
        options.setdefault("num_predict", self._max_output_tokens)
        payload["options"] = options

        started = time.perf_counter()
        try:
            response = await self._client.post("/api/chat", json=payload)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            # Ollama explains refusals in the body; without it a 400 is undebuggable.
            detail = exc.response.text[:500].strip()
            raise AIProviderError(
                f"Local LLM returned {exc.response.status_code}: {detail}",
                details={"status_code": exc.response.status_code, "body": detail},
            ) from exc
        except httpx.HTTPError as exc:
            raise AIProviderError(
                f"Local LLM at {self.base_url} is unreachable: {exc}"
            ) from exc

        body = response.json()
        message = body.get("message", {})
        text = message.get("content", "")
        return LLMResponse(
            text=text,
            provider=self.name,
            model=self.model,
            usage=TokenUsage(
                input_tokens=body.get("prompt_eval_count"),
                output_tokens=body.get("eval_count"),
                estimated_cost_usd=0.0,
                gpu_seconds=round(time.perf_counter() - started, 3),
            ),
            raw=body,
        )

    async def generate_structured[T: BaseModel](
        self,
        system_prompt: str,
        user_prompt: str,
        response_schema: type[T],
        **kwargs: Any,
    ) -> StructuredLLMResponse[T]:
        """Prefer the server's constrained decoding, then fall back to prompting."""
        if not self._supports_structured_output:
            return await self._generate_structured_by_prompting(
                system_prompt, user_prompt, response_schema, **kwargs
            )

        schema = simplify_for_grammar(response_schema.model_json_schema())
        usage = TokenUsage(input_tokens=0, output_tokens=0, estimated_cost_usd=0.0, gpu_seconds=0.0)

        for attempt in range(1, self.max_retries + 2):
            response = await self.generate(
                system_prompt, user_prompt, json_schema=schema, **kwargs
            )
            usage.input_tokens = (usage.input_tokens or 0) + (response.usage.input_tokens or 0)
            usage.output_tokens = (usage.output_tokens or 0) + (response.usage.output_tokens or 0)
            usage.gpu_seconds = (usage.gpu_seconds or 0.0) + (response.usage.gpu_seconds or 0.0)

            try:
                data = response_schema.model_validate(extract_json(response.text))
            except (AIInvalidResponseError, PydanticValidationError) as exc:
                logger.warning("Local model output invalid (attempt %s): %s", attempt, exc)
                continue

            return StructuredLLMResponse(
                data=data,
                text=response.text,
                provider=self.name,
                model=self.model,
                usage=usage,
                attempt_count=attempt,
            )

        logger.warning("Constrained decoding failed; retrying with strict JSON prompting.")
        return await self._generate_structured_by_prompting(
            system_prompt, user_prompt, response_schema, **kwargs
        )

    async def aclose(self) -> None:
        await self._client.aclose()
