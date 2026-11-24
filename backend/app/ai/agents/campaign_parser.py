from __future__ import annotations

from typing import Any

from app.ai.agents.base import BaseAgent
from app.ai.prompt_registry import CAMPAIGN_PARSER
from app.ai.schemas import ParsedCampaign
from app.config import settings


class CampaignParserAgent(BaseAgent[ParsedCampaign]):
    """Converts a natural-language brief into structured, editable criteria."""

    agent_name = CAMPAIGN_PARSER
    output_schema = ParsedCampaign

    def build_user_variables(self, **kwargs: Any) -> dict[str, Any]:
        return {
            "instruction": kwargs["instruction"],
            "default_initial_likes": settings.initial_posts_to_like,
            "default_evaluate_index": settings.evaluated_post_index,
            "default_relevance_score": settings.minimum_relevance_score,
            "default_connection_delay_hours": settings.connection_delay_hours,
            "default_max_people_per_day": settings.max_people_per_day,
        }
