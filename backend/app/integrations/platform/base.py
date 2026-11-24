"""Platform-neutral adapter contract.

Everything the application knows about an external social platform lives behind
this interface. No LinkedIn-specific code exists anywhere else.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.enums import (
    CapabilitySupport,
    ConnectionStatus,
    PlatformCapability,
    PostType,
)
from app.errors import CapabilityUnsupportedError


class SearchCriteria(BaseModel):
    """Input to candidate discovery."""

    model_config = ConfigDict(extra="forbid")

    job_titles: list[str] = Field(default_factory=list)
    industries: list[str] = Field(default_factory=list)
    locations: list[str] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)
    seniority_levels: list[str] = Field(default_factory=list)
    company_sizes: list[str] = Field(default_factory=list)
    limit: int = Field(default=25, ge=1, le=200)
    cursor: str | None = None


class PersonProfile(BaseModel):
    """A person as the platform reports them."""

    model_config = ConfigDict(extra="forbid")

    external_id: str
    profile_url: str
    full_name: str
    headline: str | None = None
    job_title: str | None = None
    company: str | None = None
    industry: str | None = None
    location: str | None = None
    about: str | None = None
    avatar_url: str | None = None
    connection_status: ConnectionStatus = ConnectionStatus.UNKNOWN
    last_activity_at: datetime | None = None
    matched_criteria: list[str] = Field(default_factory=list)
    discovery_reason: str | None = None


class SearchResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    people: list[PersonProfile] = Field(default_factory=list)
    next_cursor: str | None = None
    total_estimate: int | None = None


class PlatformPost(BaseModel):
    """A post as the platform reports it."""

    model_config = ConfigDict(extra="forbid")

    external_id: str
    author_external_id: str
    content: str = ""
    post_type: PostType = PostType.TEXT
    post_url: str | None = None
    published_at: datetime | None = None
    like_count: int | None = None
    comment_count: int | None = None
    #: False for promoted content, job cards, notifications and other chrome the
    #: platform returns alongside genuine posts.
    is_authored_post: bool = True
    is_repost: bool = False
    has_added_commentary: bool = True


class ActionOutcome(BaseModel):
    model_config = ConfigDict(extra="forbid")

    success: bool
    external_id: str | None = None
    detail: str | None = None
    already_done: bool = False


class SocialPlatformAdapter(ABC):
    """The six operations the workflow engine needs from any platform."""

    platform: str = "generic"

    @property
    @abstractmethod
    def capabilities(self) -> dict[PlatformCapability, CapabilitySupport]: ...

    def supports(self, capability: PlatformCapability) -> bool:
        return self.capabilities.get(capability) is CapabilitySupport.SUPPORTED

    def capability_note(self, capability: PlatformCapability) -> str:
        """Why a capability is unavailable, and what to do instead.

        Surfaced in the error and on the Settings page, so "unsupported" is
        never a dead end the user has to guess at.
        """
        return ""

    def require(self, capability: PlatformCapability) -> None:
        """Fail loudly rather than silently degrading."""
        support = self.capabilities.get(capability, CapabilitySupport.UNSUPPORTED)
        if support is CapabilitySupport.SUPPORTED:
            return

        note = self.capability_note(capability)
        message = f"{self.platform} adapter reports {capability.value} as {support.value}."
        raise CapabilityUnsupportedError(
            f"{message} {note}".strip(),
            details={
                "platform": self.platform,
                "capability": capability.value,
                "support": support.value,
                "note": note,
            },
        )

    @abstractmethod
    async def search_people(self, criteria: SearchCriteria) -> SearchResult: ...

    @abstractmethod
    async def get_profile(self, external_id: str) -> PersonProfile: ...

    @abstractmethod
    async def get_posts(self, external_id: str, *, limit: int = 20) -> list[PlatformPost]: ...

    @abstractmethod
    async def like_post(self, post_external_id: str) -> ActionOutcome: ...

    @abstractmethod
    async def comment_on_post(self, post_external_id: str, text: str) -> ActionOutcome: ...

    @abstractmethod
    async def send_connection(
        self, person_external_id: str, message: str | None = None
    ) -> ActionOutcome: ...

    @abstractmethod
    async def get_connection_status(self, person_external_id: str) -> ConnectionStatus: ...

    async def aclose(self) -> None:
        """Release adapter resources."""
