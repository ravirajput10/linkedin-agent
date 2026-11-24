"""Bright Data Web Scraper API adapter — reads only.

Supplies discovery, profile and post data. It never touches the user's LinkedIn
account, so it carries no account risk; engagement is left to another adapter.

The API is a job queue wearing a synchronous mask: ``/datasets/v3/scrape`` waits
about a minute and then returns ``202`` with a snapshot id, so anything slower
has to be polled. :meth:`BrightDataAdapter._collect` handles both outcomes.

Field mapping is the fragile part. Bright Data returns ~34 top-level fields per
profile and the names drift between datasets, so every mapper reads through
:func:`_first`, which tries several plausible keys and tolerates absence. These
mappings are written from the published schemas and **have not been verified
against live responses** — run ``python -m scripts.check_platform`` once your
account is active and correct them against what actually arrives.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
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

BRIGHTDATA_CAPABILITIES: dict[PlatformCapability, CapabilitySupport] = {
    PlatformCapability.SEARCH: CapabilitySupport.SUPPORTED,
    PlatformCapability.PROFILE_READ: CapabilitySupport.SUPPORTED,
    PlatformCapability.POST_READ: CapabilitySupport.SUPPORTED,
    PlatformCapability.LIKE: CapabilitySupport.UNSUPPORTED,
    PlatformCapability.COMMENT: CapabilitySupport.UNSUPPORTED,
    PlatformCapability.CONNECTION: CapabilitySupport.UNSUPPORTED,
}

WRITE_NOTE = (
    "Bright Data is a data provider and cannot act on your LinkedIn account. "
    "Configure PLATFORM_ADAPTER=composite to pair it with an engagement adapter."
)


def _first(record: dict[str, Any], *keys: str, default: Any = None) -> Any:
    """Return the first key that is present and non-empty.

    Bright Data's field names differ between datasets and change over time;
    accepting a few spellings keeps a rename from emptying a whole column.
    """
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


def _profile_url(record: dict[str, Any]) -> str:
    url = _first(record, "url", "input_url", "profile_url", "link", default="")
    if url:
        return str(url)
    identifier = _first(record, "id", "public_identifier", "linkedin_id", default="")
    return f"https://www.linkedin.com/in/{identifier}" if identifier else ""


def _external_id(record: dict[str, Any]) -> str:
    identifier = _first(record, "linkedin_num_id", "id", "public_identifier", "user_id")
    if identifier:
        return str(identifier)
    return _profile_url(record).rstrip("/").rsplit("/", 1)[-1]


def map_profile(record: dict[str, Any]) -> PersonProfile:
    """Bright Data profile record -> the application's model."""
    position = _first(record, "position", "current_position", "title", "headline", default="")
    company = _first(record, "current_company_name", "company", "current_company", default=None)
    if isinstance(company, dict):
        company = company.get("name")

    location = _first(record, "location", "city", "country_code", default=None)
    if isinstance(location, dict):
        location = location.get("name")

    return PersonProfile(
        external_id=_external_id(record),
        profile_url=_profile_url(record),
        full_name=str(_first(record, "name", "full_name", default="") or ""),
        headline=_first(record, "headline", "position", "about_title"),
        job_title=str(position) if position else None,
        company=str(company) if company else None,
        industry=_first(record, "industry", "company_industry"),
        location=str(location) if location else None,
        about=_first(record, "about", "summary", "bio"),
        avatar_url=_first(record, "avatar", "profile_image_url", "image_url"),
        # Bright Data never sees the user's own graph, so this is genuinely unknown.
        connection_status=ConnectionStatus.UNKNOWN,
        last_activity_at=_parse_datetime(_first(record, "last_activity", "updated_at")),
    )


def map_post(record: dict[str, Any], author_external_id: str) -> PlatformPost:
    """Bright Data post record -> the application's model."""
    text = str(_first(record, "post_text", "text", "content", "description", default="") or "")
    repost = bool(_first(record, "is_repost", "repost", default=False))

    return PlatformPost(
        external_id=str(_first(record, "id", "post_id", "urn", "url", default="")),
        author_external_id=author_external_id,
        content=text,
        post_type=_map_post_type(record),
        post_url=_first(record, "url", "post_url", "share_url"),
        published_at=_parse_datetime(_first(record, "date_posted", "date", "published_at")),
        like_count=_coerce_int(_first(record, "num_likes", "likes", "reactions")),
        comment_count=_coerce_int(_first(record, "num_comments", "comments")),
        is_authored_post=not bool(_first(record, "is_sponsored", "promoted", default=False)),
        is_repost=repost,
        has_added_commentary=bool(text.strip()) if repost else True,
    )


def _map_post_type(record: dict[str, Any]) -> PostType:
    raw = str(_first(record, "post_type", "type", default="") or "").lower()
    if "job" in raw:
        return PostType.JOB
    if "article" in raw:
        return PostType.ARTICLE
    if "video" in raw:
        return PostType.VIDEO
    if "poll" in raw:
        return PostType.POLL
    if "image" in raw or "photo" in raw:
        return PostType.IMAGE
    if _first(record, "images", "image_url"):
        return PostType.IMAGE
    if _first(record, "videos", "video_url"):
        return PostType.VIDEO
    return PostType.TEXT


def _coerce_int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


class BrightDataAdapter(SocialPlatformAdapter):
    platform = "brightdata"

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        if not self._settings.brightdata_api_token:
            raise PlatformError(
                "BRIGHTDATA_API_TOKEN is not set.",
                code=ErrorCode.AUTHENTICATION_EXPIRED,
            )
        self._client = httpx.AsyncClient(
            base_url=self._settings.brightdata_base_url.rstrip("/"),
            timeout=httpx.Timeout(120.0),
            headers={
                "Authorization": f"Bearer {self._settings.brightdata_api_token}",
                "Content-Type": "application/json",
            },
        )

    @property
    def capabilities(self) -> dict[PlatformCapability, CapabilitySupport]:
        caps = dict(BRIGHTDATA_CAPABILITIES)
        if not self._settings.brightdata_dataset_people_search:
            # Without a search dataset the scraper API can only look people up
            # by name, which is not discovery.
            caps[PlatformCapability.SEARCH] = CapabilitySupport.UNSUPPORTED
        return caps

    def capability_note(self, capability: PlatformCapability) -> str:
        if capability in (
            PlatformCapability.LIKE,
            PlatformCapability.COMMENT,
            PlatformCapability.CONNECTION,
        ):
            return WRITE_NOTE
        if capability is PlatformCapability.SEARCH and not self._settings.brightdata_dataset_people_search:
            return (
                "Set BRIGHTDATA_DATASET_PEOPLE_SEARCH to a dataset that supports "
                "filtering by title, industry and location."
            )
        return ""

    # -- transport ----------------------------------------------------------

    async def _collect(
        self,
        dataset_id: str,
        payload: list[dict[str, Any]],
        *,
        discover_by: str | None = None,
    ) -> list[dict[str, Any]]:
        """Run a scrape, following the async path when the sync one gives up.

        ``discover_by`` switches to discovery mode — "find the posts belonging to
        this profile" rather than "fetch this exact URL". Discovery always
        queues, so it goes through /trigger and is polled.
        """
        if not dataset_id:
            raise PlatformError(
                "No Bright Data dataset id configured for this operation.",
                code=ErrorCode.CAPABILITY_UNSUPPORTED,
            )

        if discover_by:
            body = await self._request(
                "POST",
                "/datasets/v3/trigger",
                params={
                    "dataset_id": dataset_id,
                    "include_errors": "true",
                    "type": "discover_new",
                    "discover_by": discover_by,
                },
                json=payload,
            )
            snapshot_id = body.get("snapshot_id") if isinstance(body, dict) else None
            if not snapshot_id:
                raise PlatformError(
                    "Bright Data accepted the discovery job but returned no snapshot id.",
                    code=ErrorCode.SEARCH_FAILED,
                    details={"body": body},
                )
            return await self._await_snapshot(str(snapshot_id))

        body = await self._request(
            "POST",
            "/datasets/v3/scrape",
            params={"dataset_id": dataset_id, "format": "json"},
            json=payload,
        )
        if isinstance(body, dict) and body.get("snapshot_id"):
            return await self._await_snapshot(str(body["snapshot_id"]))
        return _as_records(body)

    async def _await_snapshot(self, snapshot_id: str) -> list[dict[str, Any]]:
        deadline = (
            datetime.now(UTC)
            + timedelta(seconds=self._settings.brightdata_poll_timeout_seconds)
        )
        while datetime.now(UTC) < deadline:
            progress = await self._request("GET", f"/datasets/v3/progress/{snapshot_id}")
            status = str(progress.get("status", "")).lower() if isinstance(progress, dict) else ""

            if status in ("ready", "done", "completed"):
                records = _as_records(
                    await self._request(
                        "GET",
                        f"/datasets/v3/snapshot/{snapshot_id}",
                        params={"format": "json"},
                    )
                )
                # A job can report "ready" having collected nothing — a dead
                # page, a blocked request, a profile with no public activity.
                # Returning [] here would be read upstream as "this person has
                # no posts" and silently skip them for the wrong reason, so a
                # failed scrape has to be distinguishable from an empty one.
                errors = _coerce_int(progress.get("errors")) or 0
                if not records and errors:
                    raise PlatformError(
                        f"Bright Data job {snapshot_id} collected nothing "
                        f"({errors} error(s): "
                        f"{progress.get('error_codes') or 'unspecified'}).",
                        code=ErrorCode.SEARCH_FAILED,
                        details={
                            "snapshot_id": snapshot_id,
                            "errors": errors,
                            "error_codes": progress.get("error_codes"),
                        },
                    )
                return records
            if status in ("failed", "error", "canceled", "cancelled"):
                raise PlatformError(
                    f"Bright Data job {snapshot_id} finished as {status}.",
                    code=ErrorCode.SEARCH_FAILED,
                    details={"snapshot_id": snapshot_id, "progress": progress},
                )
            await asyncio.sleep(self._settings.brightdata_poll_interval_seconds)

        raise PlatformError(
            f"Bright Data job {snapshot_id} did not finish within "
            f"{self._settings.brightdata_poll_timeout_seconds:.0f}s. Jobs can sit "
            f"queued for several minutes before running; raise "
            f"BRIGHTDATA_POLL_TIMEOUT_SECONDS if this recurs.",
            code=ErrorCode.SEARCH_FAILED,
            details={"snapshot_id": snapshot_id},
        )

    async def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        try:
            response = await self._client.request(method, path, **kwargs)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text[:400].strip()
            code = (
                ErrorCode.AUTHENTICATION_EXPIRED
                if exc.response.status_code in (401, 403)
                else ErrorCode.SEARCH_FAILED
            )
            raise PlatformError(
                f"Bright Data returned {exc.response.status_code}: {detail}",
                code=code,
                details={"status_code": exc.response.status_code, "body": detail},
            ) from exc
        except httpx.HTTPError as exc:
            raise PlatformError(f"Bright Data is unreachable: {exc}") from exc

        if not response.content:
            return []
        try:
            return response.json()
        except ValueError:
            # Snapshots are sometimes newline-delimited JSON.
            return _parse_ndjson(response.text)

    # -- reads --------------------------------------------------------------

    async def search_people(self, criteria: SearchCriteria) -> SearchResult:
        self.require(PlatformCapability.SEARCH)

        query = {
            "keyword": " ".join(criteria.keywords or criteria.job_titles) or None,
            "title": criteria.job_titles[0] if criteria.job_titles else None,
            "location": criteria.locations[0] if criteria.locations else None,
            "industry": criteria.industries[0] if criteria.industries else None,
            "limit": criteria.limit,
        }
        records = await self._collect(
            self._settings.brightdata_dataset_people_search,
            [{k: v for k, v in query.items() if v is not None}],
        )

        matched = sorted({*criteria.job_titles, *criteria.industries, *criteria.locations})
        people: list[PersonProfile] = []
        for record in records[: criteria.limit]:
            profile = map_profile(record)
            if not profile.profile_url:
                continue
            profile.matched_criteria = matched
            profile.discovery_reason = "Returned by Bright Data people search"
            people.append(profile)

        logger.info("Bright Data search returned %s people.", len(people))
        return SearchResult(people=people, total_estimate=len(records))

    async def get_profile(self, external_id: str) -> PersonProfile:
        self.require(PlatformCapability.PROFILE_READ)

        url = external_id
        if not str(external_id).startswith("http"):
            url = f"https://www.linkedin.com/in/{external_id}"

        records = await self._collect(self._settings.brightdata_dataset_profile, [{"url": url}])
        if not records:
            raise PlatformError(
                f"Bright Data returned no profile for {external_id!r}.",
                code=ErrorCode.PROFILE_NOT_FOUND,
            )
        return map_profile(records[0])

    async def get_posts(self, external_id: str, *, limit: int = 20) -> list[PlatformPost]:
        self.require(PlatformCapability.POST_READ)

        url = external_id
        if not str(external_id).startswith("http"):
            url = f"https://www.linkedin.com/in/{external_id}"

        # This dataset takes a bare url: it rejects start_date/end_date/
        # only_authored_posts outright ("should not contain a start_date field").
        # Date windowing is therefore done here instead.
        records = await self._collect(
            self._settings.brightdata_dataset_posts,
            [{"url": url}],
            discover_by="profile_url",
        )

        cutoff = datetime.now(UTC) - timedelta(days=self._settings.brightdata_post_lookback_days)
        posts = [map_post(record, external_id) for record in records]
        posts = [
            post
            for post in posts
            if post.external_id and (post.published_at is None or post.published_at >= cutoff)
        ]
        posts.sort(key=lambda p: p.published_at or datetime.min.replace(tzinfo=UTC), reverse=True)
        return posts[: min(limit, self._settings.brightdata_max_posts_per_person)]

    async def get_connection_status(self, person_external_id: str) -> ConnectionStatus:
        # A data provider cannot see the user's own connection graph.
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
        await self._client.aclose()


def _as_records(body: Any) -> list[dict[str, Any]]:
    if isinstance(body, list):
        return [item for item in body if isinstance(item, dict)]
    if isinstance(body, dict):
        for key in ("data", "results", "records", "items"):
            value = body.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
        return [body]
    return []


def _parse_ndjson(text: str) -> list[dict[str, Any]]:
    import json

    records: list[dict[str, Any]] = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            parsed = json.loads(line)
        except ValueError:
            continue
        if isinstance(parsed, dict):
            records.append(parsed)
    return records
