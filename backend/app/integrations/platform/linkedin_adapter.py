"""LinkedIn adapter.

What LinkedIn actually exposes, verified October 2026:

**Engagement endpoints exist but are partner-gated.** The Invitations API
(``POST /v2/invitations``) sends connection requests on behalf of the
authenticated member, and the Community Management API adds comments and
reactions under the ``w_member_social_feed`` scope. Both are restricted to
approved partners under an API agreement — approval, not payment, is the gate.

**Discovery is not exposed at any tier.** There is no people-search API outside
Talent Solutions, no way to read an arbitrary third party's profile, and the
``r_member_social_feed`` permission needed to read another member's posts is
marked closed ("not accepting access requests at this time"). Sales Navigator's
SNAP programme is likewise closed to new partners.

So even a granted write scope would leave the agent unable to *find* the posts
to act on. That asymmetry is why every capability below is UNSUPPORTED or
MANUAL_REQUIRED.

Rather than drive a logged-in browser session to work around this — which
LinkedIn's User Agreement §8.2(13) prohibits by name for liking, commenting and
posting — each capability is declared honestly. Operations backed by a granted
API run; everything else raises ``CapabilityUnsupportedError``, which the
workflow engine records as a skipped step. The rest of the application is
unaffected, because it only ever talks to the adapter interface.

To enable an operation: obtain the corresponding partner access, implement the
call, and move its entry to ``SUPPORTED``.
"""

from __future__ import annotations

import httpx

from app.config import settings
from app.enums import (
    CapabilitySupport,
    ConnectionStatus,
    PlatformCapability,
)
from app.errors import ErrorCode, PlatformError
from app.integrations.platform.auth import LinkedInCredentialStore
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

API_BASE = "https://api.linkedin.com"
API_VERSION = "202409"

#: What the application can actually do through granted LinkedIn APIs today.
#: MANUAL_REQUIRED means the platform supports the action for a human in the UI
#: but exposes no API for it, so the agent surfaces it for the user to perform.
LINKEDIN_CAPABILITIES: dict[PlatformCapability, CapabilitySupport] = {
    PlatformCapability.SEARCH: CapabilitySupport.UNSUPPORTED,
    PlatformCapability.PROFILE_READ: CapabilitySupport.MANUAL_REQUIRED,
    PlatformCapability.POST_READ: CapabilitySupport.MANUAL_REQUIRED,
    PlatformCapability.LIKE: CapabilitySupport.MANUAL_REQUIRED,
    PlatformCapability.COMMENT: CapabilitySupport.MANUAL_REQUIRED,
    PlatformCapability.CONNECTION: CapabilitySupport.MANUAL_REQUIRED,
}

CAPABILITY_NOTES: dict[PlatformCapability, str] = {
    PlatformCapability.SEARCH: (
        "No people-search API exists outside the Talent Solutions partner "
        "programme, which is negotiated rather than purchased. Import candidates "
        "from a licensed data provider, or use the mock adapter."
    ),
    PlatformCapability.PROFILE_READ: (
        "Only the authenticated member's own profile is readable, via /v2/userinfo. "
        "Reading a third party's profile is not exposed at any tier."
    ),
    PlatformCapability.POST_READ: (
        "Reading another member's posts needs the r_member_social_feed permission, "
        "which LinkedIn lists as closed and is not accepting requests for."
    ),
    PlatformCapability.LIKE: (
        "The Community Management API can react on behalf of a member under the "
        "w_member_social_feed scope, but that scope is restricted to approved "
        "partners (Vetted Product, application plus review)."
    ),
    PlatformCapability.COMMENT: (
        "POST /rest/socialActions/{urn}/comments exists and can comment as the "
        "member, but requires the same partner-gated w_member_social_feed scope."
    ),
    PlatformCapability.CONNECTION: (
        "POST /v2/invitations sends connection requests on behalf of the "
        "authenticated member, but is 'restricted to approved partners, subject "
        "to limitations via API agreement'."
    ),
}


class LinkedInAdapter(SocialPlatformAdapter):
    platform = "linkedin"

    def __init__(self, credentials: LinkedInCredentialStore | None = None) -> None:
        self._credentials = credentials or LinkedInCredentialStore()
        self._client: httpx.AsyncClient | None = None

    @property
    def capabilities(self) -> dict[PlatformCapability, CapabilitySupport]:
        return dict(LINKEDIN_CAPABILITIES)

    def capability_note(self, capability: PlatformCapability) -> str:
        return CAPABILITY_NOTES.get(capability, "")

    def require(self, capability: PlatformCapability) -> None:
        support = self.capabilities.get(capability, CapabilitySupport.UNSUPPORTED)
        if support is CapabilitySupport.SUPPORTED:
            return
        raise PlatformError(
            f"LinkedIn {capability.value} is {support.value}. {self.capability_note(capability)}",
            code=ErrorCode.CAPABILITY_UNSUPPORTED,
            details={
                "platform": self.platform,
                "capability": capability.value,
                "support": support.value,
                "note": self.capability_note(capability),
            },
        )

    async def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            token = await self._credentials.get_access_token()
            self._client = httpx.AsyncClient(
                base_url=API_BASE,
                timeout=30.0,
                headers={
                    "Authorization": f"Bearer {token}",
                    "LinkedIn-Version": API_VERSION,
                    "X-Restli-Protocol-Version": "2.0.0",
                },
            )
        return self._client

    # -- reads --------------------------------------------------------------

    async def search_people(self, criteria: SearchCriteria) -> SearchResult:
        self.require(PlatformCapability.SEARCH)
        raise NotImplementedError  # pragma: no cover - unreachable while unsupported

    async def get_profile(self, external_id: str) -> PersonProfile:
        self.require(PlatformCapability.PROFILE_READ)
        raise NotImplementedError  # pragma: no cover

    async def get_own_profile(self) -> PersonProfile:
        """The one profile read that works with standard Sign In with LinkedIn."""
        client = await self._http()
        try:
            response = await client.get("/v2/userinfo")
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in (401, 403):
                raise PlatformError(
                    "LinkedIn access token is invalid or expired.",
                    code=ErrorCode.AUTHENTICATION_EXPIRED,
                ) from exc
            raise PlatformError(
                f"LinkedIn returned {exc.response.status_code}.",
                code=ErrorCode.PROFILE_NOT_FOUND,
            ) from exc
        except httpx.HTTPError as exc:
            raise PlatformError(f"LinkedIn is unreachable: {exc}") from exc

        body = response.json()
        return PersonProfile(
            external_id=body.get("sub", ""),
            profile_url=f"https://www.linkedin.com/in/{body.get('sub', '')}",
            full_name=body.get("name", ""),
            avatar_url=body.get("picture"),
        )

    async def get_posts(self, external_id: str, *, limit: int = 20) -> list[PlatformPost]:
        self.require(PlatformCapability.POST_READ)
        raise NotImplementedError  # pragma: no cover

    async def get_connection_status(self, person_external_id: str) -> ConnectionStatus:
        # No API exposes this; the workflow treats UNKNOWN as "revalidate manually".
        return ConnectionStatus.UNKNOWN

    # -- writes -------------------------------------------------------------

    async def like_post(self, post_external_id: str) -> ActionOutcome:
        self.require(PlatformCapability.LIKE)
        raise NotImplementedError  # pragma: no cover

    async def comment_on_post(self, post_external_id: str, text: str) -> ActionOutcome:
        self.require(PlatformCapability.COMMENT)
        raise NotImplementedError  # pragma: no cover

    async def send_connection(
        self, person_external_id: str, message: str | None = None
    ) -> ActionOutcome:
        self.require(PlatformCapability.CONNECTION)
        raise NotImplementedError  # pragma: no cover

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None


def linkedin_oauth_authorize_url(state: str, scopes: list[str] | None = None) -> str:
    """Build the consent URL. Scopes must already be granted to the app."""
    from urllib.parse import urlencode

    params = {
        "response_type": "code",
        "client_id": settings.linkedin_client_id,
        "redirect_uri": settings.linkedin_redirect_uri,
        "state": state,
        "scope": " ".join(scopes or ["openid", "profile"]),
    }
    return f"https://www.linkedin.com/oauth/v2/authorization?{urlencode(params)}"
