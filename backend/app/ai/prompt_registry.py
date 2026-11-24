"""Central registry of agents and their active prompt versions.

Agents never build prompt paths themselves; they ask the registry.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.config import Settings, get_settings

CAMPAIGN_PARSER = "campaign_parser"
CANDIDATE_EVALUATOR = "candidate_evaluator"
POST_EVALUATOR = "post_evaluator"
COMMENT_GENERATOR = "comment_generator"
CONNECTION_GENERATOR = "connection_generator"
POST_GENERATOR = "post_generator"


@dataclass(frozen=True, slots=True)
class PromptSpec:
    agent_name: str
    version: str
    #: Shared rule files composed into the system prompt, in order.
    common_includes: tuple[str, ...] = ()


def _version(settings: Settings, agent_name: str) -> str:
    return str(getattr(settings, f"{agent_name}_prompt_version"))


def build_registry(settings: Settings | None = None) -> dict[str, PromptSpec]:
    settings = settings or get_settings()
    return {
        CAMPAIGN_PARSER: PromptSpec(
            CAMPAIGN_PARSER,
            _version(settings, CAMPAIGN_PARSER),
            ("output_rules", "safety_rules", "formatting_rules"),
        ),
        CANDIDATE_EVALUATOR: PromptSpec(
            CANDIDATE_EVALUATOR,
            _version(settings, CANDIDATE_EVALUATOR),
            ("output_rules", "safety_rules", "relevance_rules"),
        ),
        POST_EVALUATOR: PromptSpec(
            POST_EVALUATOR,
            _version(settings, POST_EVALUATOR),
            ("output_rules", "safety_rules", "relevance_rules"),
        ),
        COMMENT_GENERATOR: PromptSpec(
            COMMENT_GENERATOR,
            _version(settings, COMMENT_GENERATOR),
            ("output_rules", "safety_rules", "writing_rules"),
        ),
        CONNECTION_GENERATOR: PromptSpec(
            CONNECTION_GENERATOR,
            _version(settings, CONNECTION_GENERATOR),
            ("output_rules", "safety_rules", "writing_rules"),
        ),
        POST_GENERATOR: PromptSpec(
            POST_GENERATOR,
            _version(settings, POST_GENERATOR),
            ("output_rules", "safety_rules"),
        ),
    }


PROMPT_REGISTRY: dict[str, PromptSpec] = build_registry()

ALL_AGENT_NAMES: tuple[str, ...] = (
    CAMPAIGN_PARSER,
    CANDIDATE_EVALUATOR,
    POST_EVALUATOR,
    COMMENT_GENERATOR,
    CONNECTION_GENERATOR,
    POST_GENERATOR,
)
