"""Pairs a read adapter with a write adapter behind one interface.

The recommended live configuration: Bright Data reads, Unipile writes.

The reason is account safety rather than tidiness. Discovery and post-fetching
are by far the highest-volume operations, and routing them through Unipile would
push every one of them through the member's own LinkedIn session — burning the
commercial-use search quota and producing exactly the browsing velocity that
triggers restrictions. Bright Data never touches that account, so only the small
number of deliberate engagement actions do.

Each half keeps its own capability matrix; the composite reports reads from one
and writes from the other, so an unconfigured half still fails honestly.
"""

from __future__ import annotations

from app.config import PlatformAdapterName, Settings, get_settings
from app.enums import CapabilitySupport, ConnectionStatus, PlatformCapability
from app.integrations.platform.base import (
    ActionOutcome,
    PersonProfile,
    PlatformPost,
    SearchCriteria,
    SearchResult,
    SocialPlatformAdapter,
)
from app.logging import get_logger

logger = get_logger(__name__)

READ_CAPABILITIES = (
    PlatformCapability.SEARCH,
    PlatformCapability.PROFILE_READ,
    PlatformCapability.POST_READ,
)
WRITE_CAPABILITIES = (
    PlatformCapability.LIKE,
    PlatformCapability.COMMENT,
    PlatformCapability.CONNECTION,
)


class CompositeAdapter(SocialPlatformAdapter):
    platform = "composite"

    def __init__(
        self,
        reader: SocialPlatformAdapter,
        writer: SocialPlatformAdapter,
    ) -> None:
        self.reader = reader
        self.writer = writer
        self.platform = f"{reader.platform}+{writer.platform}"

    @property
    def capabilities(self) -> dict[PlatformCapability, CapabilitySupport]:
        reader_caps = self.reader.capabilities
        writer_caps = self.writer.capabilities
        return {
            **{cap: reader_caps.get(cap, CapabilitySupport.UNSUPPORTED) for cap in READ_CAPABILITIES},
            **{cap: writer_caps.get(cap, CapabilitySupport.UNSUPPORTED) for cap in WRITE_CAPABILITIES},
        }

    def capability_note(self, capability: PlatformCapability) -> str:
        half = self.reader if capability in READ_CAPABILITIES else self.writer
        note = getattr(half, "capability_note", lambda _c: "")(capability)
        return f"[{half.platform}] {note}" if note else f"Handled by {half.platform}."

    def require(self, capability: PlatformCapability) -> None:
        half = self.reader if capability in READ_CAPABILITIES else self.writer
        half.require(capability)

    # -- reads --------------------------------------------------------------

    async def search_people(self, criteria: SearchCriteria) -> SearchResult:
        return await self.reader.search_people(criteria)

    async def get_profile(self, external_id: str) -> PersonProfile:
        return await self.reader.get_profile(external_id)

    async def get_posts(self, external_id: str, *, limit: int = 20) -> list[PlatformPost]:
        return await self.reader.get_posts(external_id, limit=limit)

    async def get_connection_status(self, person_external_id: str) -> ConnectionStatus:
        """Ask the writer: only the member's own session can see their graph.

        A data provider always answers UNKNOWN here, which would make the
        revalidation check meaningless before sending a connection request.
        """
        status = await self.writer.get_connection_status(person_external_id)
        if status is ConnectionStatus.UNKNOWN:
            status = await self.reader.get_connection_status(person_external_id)
        return status

    # -- writes -------------------------------------------------------------

    async def like_post(self, post_external_id: str) -> ActionOutcome:
        return await self.writer.like_post(post_external_id)

    async def comment_on_post(self, post_external_id: str, text: str) -> ActionOutcome:
        return await self.writer.comment_on_post(post_external_id, text)

    async def send_connection(
        self, person_external_id: str, message: str | None = None
    ) -> ActionOutcome:
        return await self.writer.send_connection(person_external_id, message)

    async def aclose(self) -> None:
        await self.reader.aclose()
        await self.writer.aclose()


def build_composite(
    settings: Settings | None = None, *, account_id: str | None = None
) -> CompositeAdapter:
    settings = settings or get_settings()
    from app.integrations.platform.factory import build_platform_adapter

    if settings.composite_read_adapter is PlatformAdapterName.COMPOSITE:
        raise ValueError("composite_read_adapter cannot itself be 'composite'.")
    if settings.composite_write_adapter is PlatformAdapterName.COMPOSITE:
        raise ValueError("composite_write_adapter cannot itself be 'composite'.")

    # Only the Unipile side has a member identity; Bright Data reads the same
    # whoever asks, so handing it an account id would be meaningless.
    reader = build_platform_adapter(
        settings.model_copy(update={"platform_adapter": settings.composite_read_adapter}),
        account_id=(
            account_id
            if settings.composite_read_adapter is PlatformAdapterName.UNIPILE
            else None
        ),
    )
    writer = build_platform_adapter(
        settings.model_copy(update={"platform_adapter": settings.composite_write_adapter}),
        account_id=(
            account_id
            if settings.composite_write_adapter is PlatformAdapterName.UNIPILE
            else None
        ),
    )
    logger.info("Composite adapter: reads via %s, writes via %s", reader.platform, writer.platform)
    return CompositeAdapter(reader, writer)
