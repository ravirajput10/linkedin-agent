from __future__ import annotations

from typing import Any

from app.ai.agents.base import BaseAgent
from app.ai.agents.context import format_campaign_criteria, format_exclusions, person_variables
from app.ai.prompt_registry import CANDIDATE_EVALUATOR
from app.ai.schemas import CandidateEvaluationResult
from app.database.models import Campaign, Person


class CandidateEvaluatorAgent(BaseAgent[CandidateEvaluationResult]):
    """Decides whether a discovered person matches the campaign."""

    agent_name = CANDIDATE_EVALUATOR
    output_schema = CandidateEvaluationResult

    def build_user_variables(self, **kwargs: Any) -> dict[str, Any]:
        person: Person = kwargs["person"]
        campaign: Campaign = kwargs["campaign"]
        discovery_reason: str = kwargs.get("discovery_reason") or "(not recorded)"

        return {
            **person_variables(person),
            "campaign_name": campaign.name,
            "campaign_instruction": campaign.instruction,
            "campaign_criteria": format_campaign_criteria(campaign.criteria),
            "campaign_exclusions": format_exclusions(campaign),
            "minimum_candidate_score": campaign.criteria.minimum_candidate_score,
            "discovery_reason": discovery_reason,
        }
