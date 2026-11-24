"""Unipile adapter — reads and engagement actions.

Unipile is not a LinkedIn partnership. It converts the member's own login
cookies into an encrypted token and acts through their authenticated session,
so every call is subject to that account's limits and to LinkedIn's User
Agreement. Two consequences the rest of the application cannot see:

* **Capability depends on the member's LinkedIn tier.** A free account gets
  roughly five invitations-with-note per month and throttles search after the
  commercial-use limit (~250-350 queries). ``sales_navigator`` search returns
  403 without a seat. The campaign's own daily caps should sit below these.
* **Sessions expire.** LinkedIn enforces simultaneous-session limits and will
  log the connection out, which surfaces here as ``AUTHENTICATION_EXPIRED`` and
  needs the account reconnecting in the Unipile dashboard.

Response field mappings are written from the published schemas and **have not
been verified against live responses**. Run ``python -m scripts.check_platform``
once an account is connected and correct them against what actually arrives.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import httpx

from app.config import Settings, get_settings
from app.enums import (
    CapabilitySupport,
    ConnectionStatus,
    PlatformCapability,
    PostType,
)
from app.errors import ErrorCode, PlatformError
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

#: LinkedIn member ids look like "ACoAAA…"; public handles do not.
PROVIDER_ID_PREFIX = "ACoA"

#: LinkedIn's own cap on a connection note.
CONNECTION_NOTE_LIMIT = 300

CONNECTION_STATUS_MAP: dict[str, ConnectionStatus] = {
    "connected": ConnectionStatus.CONNECTED,
    "first": ConnectionStatus.CONNECTED,
    "1st": ConnectionStatus.CONNECTED,
    "distance_1": ConnectionStatus.CONNECTED,
    "pending": ConnectionStatus.PENDING,
    "invited": ConnectionStatus.PENDING,
    "invitation_sent": ConnectionStatus.PENDING,
    "second": ConnectionStatus.NOT_CONNECTED,
    "2nd": ConnectionStatus.NOT_CONNECTED,
    "distance_2": ConnectionStatus.NOT_CONNECTED,
    "third": ConnectionStatus.NOT_CONNECTED,
    "distance_3": ConnectionStatus.NOT_CONNECTED,
    "out_of_network": ConnectionStatus.NOT_CONNECTED,
}


def _first(record: dict[str, Any], *keys: str, default: Any = None) -> Any:
    for key in keys:
        value = record.get(key)
        if value not in (None, "", [], {}):
            return value
    return default


def _parse_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    text = str(value).strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _map_connection_status(value: Any) -> ConnectionStatus:
    if value in (None, ""):
        return ConnectionStatus.UNKNOWN
    return CONNECTION_STATUS_MAP.get(str(value).strip().lower(), ConnectionStatus.UNKNOWN)


def map_profile(record: dict[str, Any]) -> PersonProfile:
    identifier = _first(record, "provider_id", "id", "public_identifier", "member_id", default="")
    public = _first(record, "public_identifier", "public_profile_url", default=identifier)

    name = _first(record, "name", "full_name")
    if not name:
        parts = [_first(record, "first_name", default=""), _first(record, "last_name", default="")]
        name = " ".join(str(p) for p in parts if p).strip()

    company = _first(record, "company", "current_company", "organization")
    if isinstance(company, dict):
        company = company.get("name")
    if not company:
        # The default profile payload carries no employer at all; it only appears
        # when linkedin_sections is requested, as work_experience[0].
        history = record.get("work_experience")
        if isinstance(history, list) and history:
            current = history[0]
            if isinstance(current, dict):
                company = current.get("company") or current.get("company_name")

    location = _first(record, "location", "city", "region")
    if isinstance(location, dict):
        location = location.get("name")

    url = _first(record, "profile_url", "public_profile_url")
    if not url:
        url = f"https://www.linkedin.com/in/{public}" if public else ""

    job_title = _first(record, "job_title", "title", "position")
    if not job_title:
        history = record.get("work_experience")
        if isinstance(history, list) and history and isinstance(history[0], dict):
            job_title = history[0].get("position")
    if not job_title:
        job_title = _first(record, "headline")

    return PersonProfile(
        external_id=str(identifier),
        profile_url=str(url),
        full_name=str(name or ""),
        headline=_first(record, "headline", "summary", "occupation"),
        job_title=job_title,
        company=str(company) if company else None,
        industry=_first(record, "industry"),
        location=str(location) if location else None,
        about=_first(record, "about", "summary", "bio"),
        avatar_url=_first(record, "profile_picture_url", "picture_url", "avatar"),
        connection_status=_map_connection_status(
            _first(record, "network_distance", "connection_degree", "relationship")
        ),
        last_activity_at=_parse_datetime(_first(record, "last_activity", "updated_at")),
    )


def map_post(record: dict[str, Any], author_external_id: str) -> PlatformPost:
    author = record.get("author") if isinstance(record.get("author"), dict) else {}
    text = str(_first(record, "text", "content", "commentary", default="") or "")
    repost = bool(_first(record, "is_repost", default=False))

    return PlatformPost(
        external_id=str(_first(record, "social_id", "id", default="")),
        author_external_id=str(_first(author, "id", "provider_id", default=author_external_id)),
        content=text,
        post_type=_map_post_type(record),
        post_url=_first(record, "share_url", "url", "permalink"),
        published_at=_parse_datetime(_first(record, "parsed_datetime", "date", "created_at")),
        like_count=_coerce_int(_first(record, "reaction_counter", "reactions", "likes")),
        comment_count=_coerce_int(_first(record, "comment_counter", "comments")),
        is_authored_post=not bool(_first(record, "is_sponsored", "sponsored", default=False)),
        is_repost=repost,
        has_added_commentary=bool(text.strip()) if repost else True,
    )


def _map_post_type(record: dict[str, Any]) -> PostType:
    if record.get("poll"):
        return PostType.POLL
    if record.get("job_posting"):
        return PostType.JOB
    if record.get("article"):
        return PostType.ARTICLE

    attachments = record.get("attachments") or []
    kinds = {
        str(item.get("type", "")).lower()
        for item in attachments
        if isinstance(item, dict)
    }
    if "video" in kinds:
        return PostType.VIDEO
    if {"img", "image", "photo"} & kinds:
        return PostType.IMAGE
    return PostType.TEXT


def _coerce_int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


class UnipileAdapter(SocialPlatformAdapter):
    platform = "unipile"

    def __init__(
        self, settings: Settings | None = None, *, account_id: str | None = None
    ) -> None:
        """``account_id`` is the connected member this adapter acts as.

        Passing it is how a user's own LinkedIn is used instead of the one in
        the environment. ``UNIPILE_ACCOUNT_ID`` remains only as a single-tenant
        fallback, so it is required only when no override is supplied.
        """
        self._settings = settings or get_settings()
        required = [
            ("UNIPILE_DSN", self._settings.unipile_dsn),
            ("UNIPILE_API_KEY", self._settings.unipile_api_key),
        ]
        if not account_id:
            required.append(("UNIPILE_ACCOUNT_ID", self._settings.unipile_account_id))
        missing = [name for name, value in required if not value]
        if missing:
            raise PlatformError(
                f"Unipile is not configured: {', '.join(missing)} missing.",
                code=ErrorCode.AUTHENTICATION_EXPIRED,
            )

        dsn = self._settings.unipile_dsn
        base = dsn if dsn.startswith("http") else f"https://{dsn}"
        self._account_id = account_id or self._settings.unipile_account_id
        self._parameter_cache: dict[tuple[str, str], str | None] = {}
        self._client = httpx.AsyncClient(
            base_url=f"{base.rstrip('/')}/api/v1",
            timeout=httpx.Timeout(self._settings.unipile_timeout_seconds),
            headers={
                "X-API-KEY": self._settings.unipile_api_key,
                "accept": "application/json",
                "Content-Type": "application/json",
            },
        )

    @property
    def capabilities(self) -> dict[PlatformCapability, CapabilitySupport]:
        return dict.fromkeys(PlatformCapability, CapabilitySupport.SUPPORTED)

    def capability_note(self, capability: PlatformCapability) -> str:
        return (
            "Performed through the connected member's own LinkedIn session, so "
            "it is subject to that account's limits and to LinkedIn's User "
            "Agreement."
        )

    # -- transport ----------------------------------------------------------

    async def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        params = dict(kwargs.pop("params", None) or {})
        params.setdefault("account_id", self._account_id)
        try:
            response = await self._client.request(method, path, params=params, **kwargs)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text[:400].strip()
            status = exc.response.status_code
            if status in (401, 403):
                code = ErrorCode.AUTHENTICATION_EXPIRED
                hint = (
                    " The LinkedIn session may have been logged out, or the "
                    "account lacks the subscription this call needs "
                    "(Sales Navigator search returns 403 without a seat)."
                )
            elif status == 429:
                code = ErrorCode.RATE_LIMIT_REACHED
                hint = " LinkedIn is throttling this account."
            else:
                code = ErrorCode.SEARCH_FAILED
                hint = ""
            raise PlatformError(
                f"Unipile returned {status}: {detail}{hint}",
                code=code,
                details={"status_code": status, "body": detail},
            ) from exc
        except httpx.HTTPError as exc:
            raise PlatformError(f"Unipile is unreachable: {exc}") from exc

        if not response.content:
            return {}
        try:
            return response.json()
        except ValueError:
            return {}

    @staticmethod
    def _items(body: Any) -> list[dict[str, Any]]:
        if isinstance(body, list):
            return [item for item in body if isinstance(item, dict)]
        if isinstance(body, dict):
            for key in ("items", "data", "results", "object"):
                value = body.get(key)
                if isinstance(value, list):
                    return [item for item in value if isinstance(item, dict)]
        return []

    # -- reads --------------------------------------------------------------

    async def resolve_search_parameter(self, kind: str, name: str) -> str | None:
        """Turn a human name into the id LinkedIn's search expects.

        ``location`` and ``industry`` are rejected as free text — "India" gives
        a 400; LinkedIn wants "102713980". Results are cached because the same
        handful of values recur across every campaign run.
        """
        cache_key = (kind, name.casefold())
        if cache_key in self._parameter_cache:
            return self._parameter_cache[cache_key]

        try:
            body = await self._request(
                "GET",
                "/linkedin/search/parameters",
                params={"type": kind, "keywords": name},
            )
        except PlatformError as exc:
            logger.warning("Could not resolve %s %r: %s", kind, name, exc.message)
            self._parameter_cache[cache_key] = None
            return None

        items = self._items(body)
        # Prefer an exact title match; the endpoint returns near-misses too
        # ("India" also yields "Maharashtra, India").
        chosen = next(
            (i for i in items if str(i.get("title", "")).casefold() == name.casefold()),
            items[0] if items else None,
        )
        resolved = str(chosen["id"]) if chosen and chosen.get("id") else None
        if resolved is None:
            logger.warning("LinkedIn search has no %s matching %r.", kind, name)
        self._parameter_cache[cache_key] = resolved
        return resolved

    async def _resolve_all(self, kind: str, names: list[str]) -> list[str]:
        resolved = [await self.resolve_search_parameter(kind, name) for name in names]
        return [value for value in resolved if value]

    async def search_people(self, criteria: SearchCriteria) -> SearchResult:
        self.require(PlatformCapability.SEARCH)

        payload: dict[str, Any] = {
            "api": self._settings.unipile_search_api,
            "category": "people",
        }

        keywords = " ".join(criteria.keywords).strip()
        if keywords:
            payload["keywords"] = keywords
        # Job titles are accepted as free text; location and industry are not.
        if criteria.job_titles:
            payload["role"] = list(criteria.job_titles)
        if criteria.locations:
            if locations := await self._resolve_all("LOCATION", criteria.locations):
                payload["location"] = locations
        if criteria.industries:
            if industries := await self._resolve_all("INDUSTRY", criteria.industries):
                payload["industry"] = industries

        if not any(key in payload for key in ("keywords", "role", "location", "industry")):
            raise PlatformError(
                "LinkedIn search needs at least one of keywords, job titles, "
                "location or industry.",
                code=ErrorCode.SEARCH_FAILED,
            )

        body = await self._request(
            "POST",
            "/linkedin/search",
            params={"limit": min(criteria.limit, 100)},
            json=payload,
        )

        matched = sorted({*criteria.job_titles, *criteria.industries, *criteria.locations})
        people: list[PersonProfile] = []
        for record in self._items(body)[: criteria.limit]:
            profile = map_profile(record)
            if not profile.external_id:
                continue
            profile.matched_criteria = matched
            profile.discovery_reason = (
                f"Returned by Unipile {self._settings.unipile_search_api} search"
            )
            people.append(profile)

        cursor = body.get("cursor") if isinstance(body, dict) else None
        paging = body.get("paging") if isinstance(body, dict) else None
        logger.info("Unipile search returned %s people.", len(people))
        return SearchResult(
            people=people,
            next_cursor=str(cursor) if cursor else None,
            total_estimate=_coerce_int(paging.get("total_count"))
            if isinstance(paging, dict)
            else None,
        )

    async def get_profile(self, external_id: str) -> PersonProfile:
        self.require(PlatformCapability.PROFILE_READ)

        body = await self._request(
            "GET", f"/users/{external_id}", params={"linkedin_sections": "*"}
        )
        record = body if isinstance(body, dict) else {}
        if not record or not _first(record, "provider_id", "id", "public_identifier"):
            raise PlatformError(
                f"Unipile returned no profile for {external_id!r}.",
                code=ErrorCode.PROFILE_NOT_FOUND,
            )
        return map_profile(record)

    async def get_posts(self, external_id: str, *, limit: int = 20) -> list[PlatformPost]:
        self.require(PlatformCapability.POST_READ)

        # This endpoint only accepts the opaque provider id. A public handle
        # yields 422 "Recipient cannot be reached", so resolve it first.
        identifier = external_id
        if not str(external_id).startswith(PROVIDER_ID_PREFIX):
            identifier = (await self.get_profile(external_id)).external_id

        body = await self._request(
            "GET",
            f"/users/{identifier}/posts",
            params={"limit": min(max(limit, 1), 100)},
        )
        posts = [map_post(record, external_id) for record in self._items(body)]
        return [post for post in posts if post.external_id][:limit]

    async def get_connection_status(self, person_external_id: str) -> ConnectionStatus:
        try:
            profile = await self.get_profile(person_external_id)
        except PlatformError as exc:
            if exc.code is ErrorCode.PROFILE_NOT_FOUND:
                return ConnectionStatus.UNKNOWN
            raise
        return profile.connection_status

    # -- writes -------------------------------------------------------------

    async def like_post(self, post_external_id: str) -> ActionOutcome:
        self.require(PlatformCapability.LIKE)

        body = await self._request(
            "POST",
            "/posts/reaction",
            json={
                "account_id": self._account_id,
                "post_id": post_external_id,
                "reaction_type": "like",
            },
        )
        return ActionOutcome(
            success=True,
            external_id=str(_first(body, "id", "object", default=post_external_id))
            if isinstance(body, dict)
            else post_external_id,
            detail="Reaction added.",
        )

    async def comment_on_post(self, post_external_id: str, text: str) -> ActionOutcome:
        self.require(PlatformCapability.COMMENT)

        if not text.strip():
            raise PlatformError("Refusing to post an empty comment.", code=ErrorCode.COMMENT_FAILED)

        body = await self._request(
            "POST",
            f"/posts/{post_external_id}/comments",
            json={
                "account_id": self._account_id,
                "text": text,
            },
        )
        return ActionOutcome(
            success=True,
            external_id=str(_first(body, "id", "comment_id", default="")) or None
            if isinstance(body, dict)
            else None,
            detail="Comment posted.",
        )

    async def send_connection(
        self, person_external_id: str, message: str | None = None
    ) -> ActionOutcome:
        self.require(PlatformCapability.CONNECTION)

        payload: dict[str, Any] = {
            "account_id": self._account_id,
            "provider_id": person_external_id,
        }
        if message:
            payload["message"] = message[:200].strip()

        body = await self._request("POST", "/users/invite", json=payload)
        return ActionOutcome(
            success=True,
            external_id=str(_first(body, "invitation_id", "id", default=person_external_id))
            if isinstance(body, dict)
            else person_external_id,
            detail="Connection request sent.",
        )

    async def aclose(self) -> None:
        await self._client.aclose()
