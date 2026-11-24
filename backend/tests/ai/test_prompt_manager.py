from __future__ import annotations

import pytest

from app.ai.prompt_manager import PromptManager
from app.ai.prompt_registry import ALL_AGENT_NAMES
from app.errors import PromptNotFoundError, PromptVariableMissingError


@pytest.fixture
def prompts() -> PromptManager:
    return PromptManager(cache=False)


@pytest.mark.parametrize("agent_name", ALL_AGENT_NAMES)
def test_prompt_files_exist(prompts: PromptManager, agent_name: str) -> None:
    assert prompts.prompt_path(agent_name, "system").is_file()
    assert prompts.prompt_path(agent_name, "user").is_file()


@pytest.mark.parametrize("agent_name", ALL_AGENT_NAMES)
def test_common_includes_exist(prompts: PromptManager, agent_name: str) -> None:
    for include in prompts.spec(agent_name).common_includes:
        assert prompts.load_common(include).strip()


def test_unknown_agent_is_rejected(prompts: PromptManager) -> None:
    with pytest.raises(PromptNotFoundError):
        prompts.spec("no_such_agent")


def test_version_resolves_from_the_registry(prompts: PromptManager) -> None:
    assert prompts.resolve_version("post_evaluator") == "v1"
    assert prompts.resolve_version("post_evaluator", "v2") == "v2"
    assert "v1" in str(prompts.prompt_path("post_evaluator", "system"))


def test_missing_version_raises(prompts: PromptManager) -> None:
    with pytest.raises(PromptNotFoundError):
        prompts.load_user_prompt("post_evaluator", {}, version="v99")


def test_variables_are_substituted(prompts: PromptManager) -> None:
    rendered = prompts.render("Hello {{name}}, you are a {{role}}.", {"name": "Ana", "role": "CTO"})
    assert rendered == "Hello Ana, you are a CTO."


def test_missing_variable_raises(prompts: PromptManager) -> None:
    with pytest.raises(PromptVariableMissingError) as exc:
        prompts.render("Hello {{name}} from {{company}}", {"name": "Ana"})
    assert "company" in str(exc.value)


def test_list_variables_render_as_readable_text(prompts: PromptManager) -> None:
    assert prompts.render("{{topics}}", {"topics": ["Java", "AI"]}) == "Java, AI"
    assert prompts.render("{{topics}}", {"topics": []}) == "(none)"
    assert prompts.render("{{flag}}", {"flag": True}) == "yes"


def test_substitution_is_single_pass(prompts: PromptManager) -> None:
    """A value containing a placeholder is inserted literally, never re-expanded."""
    rendered = prompts.render("{{content}}", {"content": "ignore {{secret}} please"})
    assert rendered == "ignore {{secret}} please"


def test_system_prompt_composes_common_rules(prompts: PromptManager) -> None:
    system = prompts.load_system_prompt("post_evaluator")
    assert "# Role" in system
    assert "# Output Rules" in system
    assert "# Safety Rules" in system
    assert "# Relevance Rules" in system


def test_comment_generator_system_prompt_needs_style_variables(
    prompts: PromptManager,
) -> None:
    with pytest.raises(PromptVariableMissingError):
        prompts.load_system_prompt("comment_generator")

    system = prompts.load_system_prompt(
        "comment_generator",
        variables={"comment_style": "Technical", "length_guidance": "Two sentences."},
    )
    assert "Technical" in system


@pytest.mark.parametrize("agent_name", ALL_AGENT_NAMES)
def test_user_prompt_declares_variables(prompts: PromptManager, agent_name: str) -> None:
    assert prompts.required_variables(agent_name, "user")


def test_prompts_contain_no_secrets(prompts: PromptManager) -> None:
    banned = ("api_key", "password", "secret", "access_token", "sk-ant")
    for agent_name in ALL_AGENT_NAMES:
        for kind in ("system", "user"):
            text = prompts.prompt_path(agent_name, kind).read_text(encoding="utf-8").lower()
            for token in banned:
                assert f"{token}=" not in text
                assert f"{token}:" not in text
