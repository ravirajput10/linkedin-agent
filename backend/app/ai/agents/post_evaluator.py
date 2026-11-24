from __future__ import annotations

from typing import Any

from app.ai.agents.base import BaseAgent
from app.ai.agents.context import (
    format_campaign_criteria,
    person_variables,
    post_variables,
)
from app.ai.prompt_registry import POST_EVALUATOR
from app.ai.schemas import PostEvaluationResult
from app.database.models import Campaign, Person, Post


class PostEvaluatorAgent(BaseAgent[PostEvaluationResult]):
    """Scores a single post against the campaign's topic rules."""

    agent_name = POST_EVALUATOR
    output_schema = PostEvaluationResult

    def build_user_variables(self, **kwargs: Any) -> dict[str, Any]:
        post: Post = kwargs["post"]
        person: Person = kwargs["person"]
        campaign: Campaign = kwargs["campaign"]

        return {
            **post_variables(post),
            **person_variables(person),
            "campaign_name": campaign.name,
            "campaign_criteria": format_campaign_criteria(campaign.criteria),
            "minimum_relevance_score": campaign.criteria.minimum_relevance_score,
        }
