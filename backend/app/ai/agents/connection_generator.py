from __future__ import annotations

from typing import Any

from app.ai.agents.base import BaseAgent
from app.ai.agents.context import person_variables
from app.ai.prompt_registry import CONNECTION_GENERATOR
from app.ai.schemas import GeneratedConnectionMessage
from app.database.models import Campaign, Person, Post


class ConnectionGeneratorAgent(BaseAgent[GeneratedConnectionMessage]):
    """Writes a short personalised connection note."""

    agent_name = CONNECTION_GENERATOR
    output_schema = GeneratedConnectionMessage

    def build_user_variables(self, **kwargs: Any) -> dict[str, Any]:
        person: Person = kwargs["person"]
        campaign: Campaign = kwargs["campaign"]
        reference_post: Post | None = kwargs.get("reference_post")
        feedback: str | None = kwargs.get("regeneration_feedback")

        return {
            **person_variables(person),
            "campaign_name": campaign.name,
            "campaign_topics": campaign.criteria.include_topics,
            "reference_post_content": (
                reference_post.content[:2000] if reference_post else "(no engaged post available)"
            ),
            "has_reference_post": reference_post is not None,
            "regeneration_feedback": feedback or "(none - this is the first attempt)",
        }
