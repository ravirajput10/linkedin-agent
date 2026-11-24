from __future__ import annotations

from typing import Any

from app.ai.agents.base import BaseAgent
from app.ai.agents.context import person_variables, post_variables
from app.ai.prompt_registry import COMMENT_GENERATOR
from app.ai.schemas import GeneratedComment
from app.database.models import Campaign, Person, Post, PostEvaluation
from app.enums import CommentLength

LENGTH_GUIDANCE: dict[CommentLength, str] = {
    CommentLength.SHORT: "One or two sentences, roughly 25-45 words.",
    CommentLength.MEDIUM: "Two or three sentences, roughly 45-80 words.",
    CommentLength.LONG: "Three to five sentences, roughly 80-140 words.",
}


class CommentGeneratorAgent(BaseAgent[GeneratedComment]):
    """Writes a specific, non-generic comment about one post."""

    agent_name = COMMENT_GENERATOR
    output_schema = GeneratedComment

    def build_system_variables(self, **kwargs: Any) -> dict[str, Any]:
        criteria = kwargs["campaign"].criteria
        return {
            "comment_style": criteria.comment_style.value.title(),
            "length_guidance": LENGTH_GUIDANCE[criteria.comment_length],
        }

    def build_user_variables(self, **kwargs: Any) -> dict[str, Any]:
        post: Post = kwargs["post"]
        person: Person = kwargs["person"]
        campaign: Campaign = kwargs["campaign"]
        evaluation: PostEvaluation | None = kwargs.get("evaluation")
        feedback: str | None = kwargs.get("regeneration_feedback")

        criteria = campaign.criteria
        return {
            **post_variables(post),
            **person_variables(person),
            "campaign_name": campaign.name,
            "campaign_topics": criteria.include_topics,
            "comment_style": criteria.comment_style.value.title(),
            "comment_length": criteria.comment_length.value.title(),
            "length_guidance": LENGTH_GUIDANCE[criteria.comment_length],
            "evaluated_topics": evaluation.topics if evaluation else [],
            "evaluation_reason": evaluation.reason if evaluation else "(not evaluated)",
            "regeneration_feedback": feedback or "(none - this is the first attempt)",
        }
