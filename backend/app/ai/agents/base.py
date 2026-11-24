"""Shared plumbing for every AI agent.

The flow is fixed and identical for all agents:

    PromptManager -> versioned .md files -> LLMProvider -> Pydantic -> persisted
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, ClassVar

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.ai.prompt_manager import PromptManager, get_prompt_manager
from app.ai.provider import LLMProvider, TokenUsage
from app.ai.provider_factory import get_llm_provider
from app.database.models import AIExecution
from app.errors import AppError, LLMCapabilityUnsupportedError
from app.logging import get_logger

logger = get_logger(__name__)


@dataclass
class AgentResult[T: BaseModel]:
    """An agent's validated output plus everything needed to audit the decision."""

    data: T
    agent_name: str
    prompt_version: str
    provider: str
    model: str
    input_hash: str
    usage: TokenUsage
    attempt_count: int
    latency_ms: int
    ai_execution_id: int | None = None

    @property
    def audit_fields(self) -> dict[str, Any]:
        return {
            "agent_name": self.agent_name,
            "prompt_version": self.prompt_version,
            "provider": self.provider,
            "model": self.model,
            "input_hash": self.input_hash,
            "ai_execution_id": self.ai_execution_id,
        }


def _utcnow() -> datetime:
    return datetime.now(UTC)


def hash_input(system_prompt: str, user_prompt: str) -> str:
    digest = hashlib.sha256()
    digest.update(system_prompt.encode("utf-8"))
    digest.update(b"\x00")
    digest.update(user_prompt.encode("utf-8"))
    return digest.hexdigest()


class BaseAgent[T: BaseModel]:
    """Base class for the five reasoning agents."""

    agent_name: ClassVar[str]
    output_schema: ClassVar[type[BaseModel]]
    #: Every agent in this application needs schema-valid JSON back.
    requires_structured_output: ClassVar[bool] = True

    def __init__(
        self,
        provider: LLMProvider | None = None,
        prompt_manager: PromptManager | None = None,
    ) -> None:
        self._provider = provider
        self._prompts = prompt_manager or get_prompt_manager()

    @property
    def provider(self) -> LLMProvider:
        return self._provider if self._provider is not None else get_llm_provider()

    @property
    def prompt_version(self) -> str:
        return self._prompts.resolve_version(self.agent_name)

    def build_system_variables(self, **kwargs: Any) -> dict[str, Any] | None:
        """Override when the system prompt itself needs runtime values."""
        return None

    def build_user_variables(self, **kwargs: Any) -> dict[str, Any]:
        raise NotImplementedError

    async def run(
        self,
        *,
        session: Session | None = None,
        campaign_id: int | None = None,
        person_id: int | None = None,
        workflow_id: int | None = None,
        **kwargs: Any,
    ) -> AgentResult[T]:
        provider = self.provider

        if self.requires_structured_output and not provider.capabilities.supports_structured_output:
            raise LLMCapabilityUnsupportedError(
                f"The configured {provider.name} model {provider.model!r} does not support "
                f"the structured-output capability required by the {self.agent_name} agent.",
                details={"agent": self.agent_name, "provider": provider.name},
            )

        system_prompt = self._prompts.load_system_prompt(
            self.agent_name, variables=self.build_system_variables(**kwargs)
        )
        user_prompt = self._prompts.load_user_prompt(
            self.agent_name, variables=self.build_user_variables(**kwargs)
        )
        input_hash = hash_input(system_prompt, user_prompt)

        started = _utcnow()
        execution: AIExecution | None = None
        if session is not None:
            execution = AIExecution(
                campaign_id=campaign_id,
                person_id=person_id,
                workflow_id=workflow_id,
                agent_name=self.agent_name,
                provider=provider.name,
                model=provider.model,
                prompt_version=self.prompt_version,
                request_at=started,
                input_hash=input_hash,
            )
            session.add(execution)
            session.flush()

        try:
            response = await provider.generate_structured(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                response_schema=self.output_schema,
            )
        except AppError as exc:
            if execution is not None:
                finished = _utcnow()
                execution.response_at = finished
                execution.latency_ms = int((finished - started).total_seconds() * 1000)
                execution.success = False
                execution.error_code = exc.code.value
                execution.error_message = exc.message
                session.flush()
            logger.warning("Agent %s failed: %s", self.agent_name, exc.message)
            raise

        finished = _utcnow()
        latency_ms = int((finished - started).total_seconds() * 1000)

        if execution is not None:
            execution.response_at = finished
            execution.latency_ms = latency_ms
            execution.success = True
            execution.attempt_count = response.attempt_count
            execution.input_tokens = response.usage.input_tokens
            execution.output_tokens = response.usage.output_tokens
            execution.estimated_cost_usd = response.usage.estimated_cost_usd
            execution.gpu_seconds = response.usage.gpu_seconds
            execution.output = response.data.model_dump(mode="json", by_alias=True)
            session.flush()

        return AgentResult(
            data=response.data,  # type: ignore[arg-type]
            agent_name=self.agent_name,
            prompt_version=self.prompt_version,
            provider=provider.name,
            model=provider.model,
            input_hash=input_hash,
            usage=response.usage,
            attempt_count=response.attempt_count,
            latency_ms=latency_ms,
            ai_execution_id=execution.id if execution is not None else None,
        )
