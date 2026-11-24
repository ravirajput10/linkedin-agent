from __future__ import annotations

from fastapi import APIRouter

from app.ai.prompt_manager import get_prompt_manager
from app.ai.prompt_registry import ALL_AGENT_NAMES
from app.ai.provider_factory import get_llm_provider
from app.api.deps import CurrentUser
from app.config import settings as app_settings
from app.integrations.platform.factory import get_platform_adapter
from app.schemas.observability import (
    PlatformCapabilityInfo,
    PromptInfo,
    ProviderInfo,
    SettingsResponse,
)

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=SettingsResponse)
def get_settings(current_user: CurrentUser) -> SettingsResponse:
    """Read-only view of the active configuration. No secrets are returned."""
    from app.services.user_service import effective_dry_run

    provider = get_llm_provider()
    capabilities = provider.capabilities
    adapter = get_platform_adapter()
    prompts = get_prompt_manager()

    prompt_infos: list[PromptInfo] = []
    for agent_name in ALL_AGENT_NAMES:
        spec = prompts.spec(agent_name)
        system_path = prompts.prompt_path(agent_name, "system")
        user_path = prompts.prompt_path(agent_name, "user")
        try:
            variables = sorted(prompts.required_variables(agent_name, "user"))
        except Exception:
            variables = []
        prompt_infos.append(
            PromptInfo(
                agent_name=agent_name,
                version=spec.version,
                common_includes=list(spec.common_includes),
                system_prompt_exists=system_path.is_file(),
                user_prompt_exists=user_path.is_file(),
                user_variables=variables,
            )
        )

    notes = getattr(adapter, "capability_note", lambda _c: None)
    capability_infos = [
        PlatformCapabilityInfo(
            capability=capability.value, support=support.value, note=notes(capability)
        )
        for capability, support in adapter.capabilities.items()
    ]

    return SettingsResponse(
        app_env=app_settings.app_env.value,
        dry_run=effective_dry_run(current_user),
        llm=ProviderInfo(
            provider=provider.name,
            model=provider.model,
            supports_structured_output=capabilities.supports_structured_output,
            supports_tool_calling=capabilities.supports_tool_calling,
            supports_streaming=capabilities.supports_streaming,
            supports_vision=capabilities.supports_vision,
            max_context_tokens=capabilities.max_context_tokens,
        ),
        platform=adapter.platform,
        platform_capabilities=capability_infos,
        prompts=prompt_infos,
        connection_delay_hours=app_settings.connection_delay_hours,
        limits={
            "max_people_per_day": app_settings.max_people_per_day,
            "max_likes_per_day": app_settings.max_likes_per_day,
            "max_comments_per_day": app_settings.max_comments_per_day,
            "max_connections_per_day": app_settings.max_connections_per_day,
            "max_people_per_run": app_settings.max_people_per_run,
        },
    )
