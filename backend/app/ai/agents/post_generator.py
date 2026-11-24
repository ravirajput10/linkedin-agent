from __future__ import annotations

from typing import Any

from app.ai.agents.base import BaseAgent
from app.ai.prompt_registry import POST_GENERATOR
from app.ai.schemas import PostGeneratorResult


class PostGeneratorAgent(BaseAgent[PostGeneratorResult]):
    """Generates 3 diverse, high-engagement LinkedIn post drafts for Content Studio."""

    agent_name = POST_GENERATOR
    output_schema = PostGeneratorResult

    def build_user_variables(self, **kwargs: Any) -> dict[str, Any]:
        return {
            "topic_prompt": kwargs.get("topic_prompt", ""),
            "post_format": kwargs.get("post_format", "Text post"),
            "content_pillar": kwargs.get("content_pillar", "General"),
            "post_length": kwargs.get("post_length", "Medium · ~150 words"),
        }
