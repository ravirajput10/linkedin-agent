"""Loads, composes and renders prompt files.

Prompts live on disk as versioned Markdown. Changing agent behaviour means
editing a ``.md`` file, never Python.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from app.ai.prompt_registry import PROMPT_REGISTRY, PromptSpec
from app.errors import PromptNotFoundError, PromptVariableMissingError

PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"
COMMON_DIR = PROMPTS_DIR / "common"

_VARIABLE_RE = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}")


def _stringify(value: Any) -> str:
    if isinstance(value, str):
        return value
    if value is None:
        return ""
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, (list, tuple, set)):
        items = list(value)
        if not items:
            return "(none)"
        if all(isinstance(item, (str, int, float)) for item in items):
            return ", ".join(str(item) for item in items)
        return json.dumps(items, indent=2, default=str)
    return json.dumps(value, indent=2, default=str)


class PromptManager:
    """The only component that knows where prompts live."""

    def __init__(
        self,
        prompts_dir: Path | None = None,
        registry: dict[str, PromptSpec] | None = None,
        *,
        cache: bool = True,
    ) -> None:
        self.prompts_dir = prompts_dir or PROMPTS_DIR
        self.registry = registry if registry is not None else PROMPT_REGISTRY
        self._cache_enabled = cache
        self._file_cache: dict[Path, str] = {}

    # -- lookup -------------------------------------------------------------

    def spec(self, agent_name: str) -> PromptSpec:
        try:
            return self.registry[agent_name]
        except KeyError:
            raise PromptNotFoundError(
                f"Unknown agent {agent_name!r}. Known agents: "
                f"{', '.join(sorted(self.registry))}.",
                details={"agent_name": agent_name},
            ) from None

    def resolve_version(self, agent_name: str, version: str | None = None) -> str:
        return version or self.spec(agent_name).version

    def prompt_path(self, agent_name: str, kind: str, version: str | None = None) -> Path:
        resolved = self.resolve_version(agent_name, version)
        return self.prompts_dir / agent_name / resolved / f"{kind}.md"

    # -- reading ------------------------------------------------------------

    def _read(self, path: Path) -> str:
        if self._cache_enabled and path in self._file_cache:
            return self._file_cache[path]
        if not path.is_file():
            raise PromptNotFoundError(
                f"Prompt file not found: {path}", details={"path": str(path)}
            )
        text = path.read_text(encoding="utf-8")
        if self._cache_enabled:
            self._file_cache[path] = text
        return text

    def load_common(self, name: str) -> str:
        return self._read(self.prompts_dir / "common" / f"{name}.md")

    # -- rendering ----------------------------------------------------------

    def render(self, template: str, variables: dict[str, Any] | None = None) -> str:
        """Substitute ``{{name}}`` placeholders.

        Substitution is one-pass, so values containing ``{{...}}`` are inserted
        literally and can never inject further template directives.
        """
        values = variables or {}
        missing: set[str] = set()

        def replace(match: re.Match[str]) -> str:
            key = match.group(1)
            if key not in values:
                missing.add(key)
                return match.group(0)
            return _stringify(values[key])

        rendered = _VARIABLE_RE.sub(replace, template)
        if missing:
            raise PromptVariableMissingError(
                f"Missing prompt variables: {', '.join(sorted(missing))}",
                details={"missing": sorted(missing)},
            )
        return rendered

    def required_variables(self, agent_name: str, kind: str, version: str | None = None) -> set[str]:
        template = self._read(self.prompt_path(agent_name, kind, version))
        return {match.group(1) for match in _VARIABLE_RE.finditer(template)}

    # -- public API ---------------------------------------------------------

    def load_system_prompt(
        self,
        agent_name: str,
        version: str | None = None,
        variables: dict[str, Any] | None = None,
    ) -> str:
        """Agent-specific system prompt with the shared rule blocks appended."""
        spec = self.spec(agent_name)
        parts = [self._read(self.prompt_path(agent_name, "system", version)).strip()]
        for include in spec.common_includes:
            parts.append(self.load_common(include).strip())
        composed = "\n\n---\n\n".join(part for part in parts if part)
        return self.render(composed, variables) if _VARIABLE_RE.search(composed) else composed

    def load_user_prompt(
        self,
        agent_name: str,
        variables: dict[str, Any] | None = None,
        version: str | None = None,
    ) -> str:
        template = self._read(self.prompt_path(agent_name, "user", version))
        return self.render(template, variables)

    def clear_cache(self) -> None:
        self._file_cache.clear()


_prompt_manager: PromptManager | None = None


def get_prompt_manager() -> PromptManager:
    global _prompt_manager
    if _prompt_manager is None:
        _prompt_manager = PromptManager()
    return _prompt_manager
