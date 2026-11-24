"""Claude implementation of :class:`LLMProvider`.

This is the only module in the application allowed to import the Anthropic SDK.
"""

from __future__ import annotations

from typing import Any

import anthropic
from pydantic import BaseModel
from pydantic import ValidationError as PydanticValidationError

from app.ai.provider import (
    LLMCapabilities,
    LLMProvider,
    LLMResponse,
    StructuredLLMResponse,
    TokenUsage,
)
from app.errors import AIInvalidResponseError, AIProviderError
from app.logging import get_logger

logger = get_logger(__name__)

#: USD per million tokens. Used for dashboard cost estimates only.
MODEL_PRICING: dict[str, tuple[float, float]] = {
    "claude-opus-4-1": (15.0, 75.0),
    "claude-opus-4": (15.0, 75.0),
    "claude-sonnet-4-5": (3.0, 15.0),
    "claude-sonnet-4": (3.0, 15.0),
    "claude-haiku-4-5": (1.0, 5.0),
    "claude-3-5-haiku": (0.8, 4.0),
}
DEFAULT_PRICING = (3.0, 15.0)

STRUCTURED_TOOL_NAME = "emit_result"


def _estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    key = next((k for k in MODEL_PRICING if model.startswith(k)), None)
    price_in, price_out = MODEL_PRICING.get(key, DEFAULT_PRICING) if key else DEFAULT_PRICING
    return (input_tokens * price_in + output_tokens * price_out) / 1_000_000


class ClaudeProvider(LLMProvider):
    name = "claude"

    def __init__(
        self,
        api_key: str,
        model: str,
        *,
        max_tokens: int = 4096,
        max_retries: int = 2,
        timeout_seconds: float = 120.0,
    ) -> None:
        super().__init__(model, max_retries=max_retries, timeout_seconds=timeout_seconds)
        if not api_key:
            raise AIProviderError(
                "CLAUDE_API_KEY is not configured. Set it in the active .env file "
                "or switch LLM_PROVIDER to 'local' or 'mock'."
            )
        self.max_tokens = max_tokens
        self._client = anthropic.AsyncAnthropic(api_key=api_key, timeout=timeout_seconds)

    @property
    def capabilities(self) -> LLMCapabilities:
        return LLMCapabilities(
            supports_structured_output=True,
            supports_tool_calling=True,
            supports_streaming=True,
            supports_vision=True,
            max_context_tokens=200_000,
        )

    async def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        **kwargs: Any,
    ) -> LLMResponse:
        try:
            message = await self._client.messages.create(
                model=self.model,
                max_tokens=kwargs.pop("max_tokens", self.max_tokens),
                system=system_prompt,
                messages=[{"role": "user", "content": user_prompt}],
                **kwargs,
            )
        except anthropic.APIStatusError as exc:
            raise AIProviderError(
                f"Claude API returned {exc.status_code}.",
                details={"status_code": exc.status_code},
            ) from exc
        except anthropic.APIError as exc:
            raise AIProviderError(f"Claude API call failed: {exc}") from exc

        text = "".join(block.text for block in message.content if block.type == "text")
        return LLMResponse(
            text=text,
            provider=self.name,
            model=self.model,
            usage=self._usage(message),
        )

    async def generate_structured[T: BaseModel](
        self,
        system_prompt: str,
        user_prompt: str,
        response_schema: type[T],
        **kwargs: Any,
    ) -> StructuredLLMResponse[T]:
        """Use Claude's tool schema so the model is constrained to the shape."""
        schema = response_schema.model_json_schema()
        tool = {
            "name": STRUCTURED_TOOL_NAME,
            "description": f"Return the {response_schema.__name__} result.",
            "input_schema": _as_tool_schema(schema),
        }

        last_error: Exception | None = None
        usage = TokenUsage(input_tokens=0, output_tokens=0, estimated_cost_usd=0.0)
        prompt = user_prompt

        for attempt in range(1, self.max_retries + 2):
            try:
                message = await self._client.messages.create(
                    model=self.model,
                    max_tokens=kwargs.pop("max_tokens", self.max_tokens),
                    system=system_prompt,
                    messages=[{"role": "user", "content": prompt}],
                    tools=[tool],
                    tool_choice={"type": "tool", "name": STRUCTURED_TOOL_NAME},
                )
            except anthropic.APIStatusError as exc:
                raise AIProviderError(
                    f"Claude API returned {exc.status_code}.",
                    details={"status_code": exc.status_code},
                ) from exc
            except anthropic.APIError as exc:
                raise AIProviderError(f"Claude API call failed: {exc}") from exc

            call_usage = self._usage(message)
            usage.input_tokens = (usage.input_tokens or 0) + (call_usage.input_tokens or 0)
            usage.output_tokens = (usage.output_tokens or 0) + (call_usage.output_tokens or 0)
            usage.estimated_cost_usd = (usage.estimated_cost_usd or 0.0) + (
                call_usage.estimated_cost_usd or 0.0
            )

            tool_block = next(
                (block for block in message.content if block.type == "tool_use"), None
            )
            if tool_block is None:
                last_error = AIInvalidResponseError("Claude did not call the result tool.")
                prompt = f"{user_prompt}\n\nYou must call the {STRUCTURED_TOOL_NAME} tool."
                continue

            try:
                data = response_schema.model_validate(tool_block.input)
            except PydanticValidationError as exc:
                last_error = exc
                logger.warning("Claude tool output failed validation: %s", exc)
                prompt = (
                    f"{user_prompt}\n\nYour previous tool call was rejected:\n{exc}\n"
                    "Call the tool again with corrected values."
                )
                continue

            return StructuredLLMResponse(
                data=data,
                text=str(tool_block.input),
                provider=self.name,
                model=self.model,
                usage=usage,
                attempt_count=attempt,
            )

        raise AIInvalidResponseError(
            f"Claude did not return valid {response_schema.__name__} "
            f"after {self.max_retries + 1} attempts.",
            details={"last_error": str(last_error)},
        )

    def _usage(self, message: Any) -> TokenUsage:
        raw = getattr(message, "usage", None)
        if raw is None:
            return TokenUsage()
        input_tokens = getattr(raw, "input_tokens", 0) or 0
        output_tokens = getattr(raw, "output_tokens", 0) or 0
        return TokenUsage(
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            estimated_cost_usd=_estimate_cost(self.model, input_tokens, output_tokens),
        )

    async def aclose(self) -> None:
        await self._client.close()


def _as_tool_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Inline Pydantic's ``$defs`` references, which tool schemas do not accept."""
    defs = schema.pop("$defs", {})
    if not defs:
        return schema

    def resolve(node: Any) -> Any:
        if isinstance(node, dict):
            ref = node.get("$ref")
            if isinstance(ref, str) and ref.startswith("#/$defs/"):
                target = defs.get(ref.removeprefix("#/$defs/"), {})
                merged = {**resolve(target), **{k: v for k, v in node.items() if k != "$ref"}}
                return merged
            return {key: resolve(value) for key, value in node.items()}
        if isinstance(node, list):
            return [resolve(item) for item in node]
        return node

    return resolve(schema)
