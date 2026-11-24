"""The single place that decides which LLM provider is active.

No other module may branch on ``settings.llm_provider``.
"""

from __future__ import annotations

from functools import lru_cache

from app.ai.provider import LLMProvider
from app.config import LLMProviderName, Settings, get_settings
from app.errors import AppError, ErrorCode
from app.logging import get_logger

logger = get_logger(__name__)

_override: LLMProvider | None = None


def build_llm_provider(settings: Settings) -> LLMProvider:
    match settings.llm_provider:
        case LLMProviderName.CLAUDE:
            from app.ai.providers.claude_provider import ClaudeProvider

            return ClaudeProvider(
                api_key=settings.claude_api_key,
                model=settings.claude_model,
                max_tokens=settings.claude_max_tokens,
                max_retries=settings.llm_max_retries,
                timeout_seconds=settings.llm_timeout_seconds,
            )
        case LLMProviderName.LOCAL:
            from app.ai.providers.local_provider import LocalLLMProvider

            return LocalLLMProvider(
                base_url=settings.local_llm_base_url,
                model=settings.local_llm_model,
                supports_structured_output=settings.local_llm_supports_structured_output,
                max_context_tokens=settings.local_llm_max_context_tokens,
                think=settings.local_llm_think,
                max_output_tokens=settings.local_llm_max_output_tokens,
                max_retries=settings.llm_max_retries,
                timeout_seconds=settings.llm_timeout_seconds,
            )
        case LLMProviderName.MOCK:
            from app.ai.providers.mock_provider import MockLLMProvider

            return MockLLMProvider(max_retries=settings.llm_max_retries)

    raise AppError(
        f"Unsupported LLM provider: {settings.llm_provider}",
        code=ErrorCode.VALIDATION_ERROR,
        http_status=500,
    )


@lru_cache(maxsize=1)
def _cached_provider() -> LLMProvider:
    settings = get_settings()
    provider = build_llm_provider(settings)
    logger.info("LLM provider initialised: %s (model=%s)", provider.name, provider.model)
    return provider


def get_llm_provider() -> LLMProvider:
    """Return the process-wide provider instance."""
    return _override if _override is not None else _cached_provider()


def set_llm_provider_override(provider: LLMProvider | None) -> None:
    """Install a provider for tests. Pass ``None`` to restore configuration."""
    global _override
    _override = provider


def reset_llm_provider_cache() -> None:
    _cached_provider.cache_clear()
