"""In-memory platform used for development, tests and dry runs.

Carries a realistic dataset — including content the evaluators are supposed to
reject — so the full workflow can be exercised without touching any real
network.
"""

from __future__ import annotations

import asyncio
import random
from datetime import UTC, datetime, timedelta

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


def _ago(hours: float) -> datetime:
    return datetime.now(UTC) - timedelta(hours=hours)


_PEOPLE: list[dict] = [
    {
        "external_id": "mock-p-001",
        "full_name": "Ananya Rao",
        "headline": "CTO at Finflow · Scaling Java & event-driven platforms",
        "job_title": "CTO",
        "company": "Finflow",
        "industry": "SaaS",
        "location": "Bengaluru, India",
        "about": "Building payment infrastructure. Java, Spring Boot, Kafka, and "
        "lately a lot of applied AI. Previously platform lead at a fintech unicorn.",
    },
    {
        "external_id": "mock-p-002",
        "full_name": "Rahul Mehta",
        "headline": "VP Engineering @ Cloudspan | Microservices, Platform, DevEx",
        "job_title": "VP of Engineering",
        "company": "Cloudspan",
        "industry": "Software",
        "location": "Pune, India",
        "about": "Engineering leadership, distributed systems, developer experience. "
        "I write about the organisational side of architecture.",
    },
    {
        "external_id": "mock-p-003",
        "full_name": "Priya Nair",
        "headline": "Engineering Manager · Generative AI platform · Ex-Infra",
        "job_title": "Engineering Manager",
        "company": "Navira AI",
        "industry": "SaaS",
        "location": "Hyderabad, India",
        "about": "Leading the GenAI platform team. Retrieval, evaluation harnesses, "
        "and keeping inference costs sane.",
    },
    {
        "external_id": "mock-p-004",
        "full_name": "Vikram Shetty",
        "headline": "Senior Java Developer | Spring Boot | Kubernetes",
        "job_title": "Senior Java Developer",
        "company": "Orbit Systems",
        "industry": "Software",
        "location": "Chennai, India",
        "about": "Backend engineer. Spring Boot, JVM tuning, and the occasional "
        "war story about a production incident.",
    },
    {
        "external_id": "mock-p-005",
        "full_name": "Deepak Sharma",
        "headline": "Technical Recruiter | Hiring Java & AI talent | 500+ placements",
        "job_title": "Technical Recruiter",
        "company": "TalentBridge",
        "industry": "Staffing",
        "location": "Gurugram, India",
        "about": "I connect great engineers with great companies. DM me your CV.",
    },
    {
        "external_id": "mock-p-006",
        "full_name": "Meera Krishnan",
        "headline": "Head of Platform Engineering · Distributed systems · Java",
        "job_title": "Head of Platform Engineering",
        "company": "Latticeworks",
        "industry": "SaaS",
        "location": "Bengaluru, India",
        "about": "Platform teams, internal developer platforms, and the long tail "
        "of migration work nobody blogs about.",
    },
    {
        "external_id": "mock-p-007",
        "full_name": "Arjun Patel",
        "headline": "Motivational Speaker | Mindset Coach | Author",
        "job_title": "Founder",
        "company": "PeakMind",
        "industry": "Coaching",
        "location": "Mumbai, India",
        "about": "Helping 10,000+ professionals unlock their potential. Link in bio.",
    },
    {
        "external_id": "mock-p-008",
        "full_name": "Sneha Gupta",
        "headline": "Principal Engineer | Microservices & API design | Java, Go",
        "job_title": "Principal Engineer",
        "company": "Harbour Logistics",
        "industry": "Software",
        "location": "Noida, India",
        "about": "API design, service decomposition, and arguing about idempotency.",
    },
]

_POSTS: dict[str, list[dict]] = {
    "mock-p-001": [
        {
            "external_id": "mock-post-001-a",
            "content": (
                "We finally moved our settlement pipeline off a shared Postgres "
                "table and onto Kafka with per-tenant partitions. The surprise was "
                "not throughput — it was that our p99 dropped because we stopped "
                "contending on row locks during the end-of-day batch. If your "
                "'scaling problem' is really a locking problem, adding consumers "
                "will not save you."
            ),
            "post_type": PostType.TEXT,
            "published_at": _ago(18),
            "like_count": 214,
            "comment_count": 31,
        },
        {
            "external_id": "mock-post-001-b",
            "content": (
                "Spring Boot 3.3 virtual threads: we swapped our blocking JDBC "
                "calls onto virtual threads expecting a free win. Got a 40% "
                "throughput improvement on read-heavy endpoints and absolutely "
                "nothing on the write path, because the connection pool is still "
                "the bottleneck. Virtual threads make you honest about where your "
                "real limit is."
            ),
            "post_type": PostType.TEXT,
            "published_at": _ago(52),
            "like_count": 389,
            "comment_count": 47,
        },
        {
            "external_id": "mock-post-001-c",
            "content": (
                "Six months of running an LLM in the payment-dispute flow. The "
                "model is the easy part. The hard part was building an evaluation "
                "set that reflects the disputes we actually get, not the ones the "
                "docs use as examples. We now regenerate the eval set monthly from "
                "sampled production cases, and it caught a regression the offline "
                "benchmark completely missed."
            ),
            "post_type": PostType.TEXT,
            "published_at": _ago(96),
            "like_count": 502,
            "comment_count": 68,
        },
        {
            "external_id": "mock-post-001-d",
            "content": "We're hiring senior backend engineers in Bengaluru. Apply now!",
            "post_type": PostType.TEXT,
            "published_at": _ago(120),
            "like_count": 12,
            "comment_count": 2,
        },
    ],
    "mock-p-002": [
        {
            "external_id": "mock-post-002-a",
            "content": (
                "Conway's law is not a warning, it is a design tool. We wanted "
                "three independently deployable services, so we made three teams "
                "with three on-call rotations first, and let the boundaries follow. "
                "Trying it the other way round gave us a distributed monolith twice."
            ),
            "post_type": PostType.TEXT,
            "published_at": _ago(30),
            "like_count": 671,
            "comment_count": 84,
        },
        {
            "external_id": "mock-post-002-b",
            "content": (
                "Developer experience metric that actually predicted our delivery "
                "speed: time from opening a PR to getting a review comment. Not "
                "build time, not deploy frequency. When that number went above four "
                "hours, everything else degraded within two sprints."
            ),
            "post_type": PostType.TEXT,
            "published_at": _ago(74),
            "like_count": 445,
            "comment_count": 52,
        },
        {
            "external_id": "mock-post-002-c",
            "content": (
                "Unpopular opinion on microservices: the service boundary that "
                "matters is the one around the data, not the one around the code. "
                "Two services sharing a database are one service with extra network "
                "hops and worse failure modes."
            ),
            "post_type": PostType.TEXT,
            "published_at": _ago(140),
            "like_count": 892,
            "comment_count": 130,
        },
    ],
    "mock-p-003": [
        {
            "external_id": "mock-post-003-a",
            "content": (
                "Agree? Comment YES if you think AI will replace developers in 2026! "
                "Repost to spread awareness."
            ),
            "post_type": PostType.TEXT,
            "published_at": _ago(12),
            "like_count": 1203,
            "comment_count": 410,
        },
        {
            "external_id": "mock-post-003-b",
            "content": (
                "Our RAG pipeline got 20 points better on answer accuracy from one "
                "change: we stopped chunking by token count and started chunking on "
                "document structure — headings, tables, and list boundaries. "
                "Retrieval quality was never the embedding model's fault."
            ),
            "post_type": PostType.TEXT,
            "published_at": _ago(44),
            "like_count": 738,
            "comment_count": 91,
        },
        {
            "external_id": "mock-post-003-c",
            "content": (
                "Inference cost breakdown after six months in production: 61% of "
                "spend came from retries on malformed structured output. Adding "
                "constrained decoding paid for itself in eleven days. Nobody talks "
                "about the retry tax."
            ),
            "post_type": PostType.TEXT,
            "published_at": _ago(88),
            "like_count": 1104,
            "comment_count": 143,
        },
    ],
    "mock-p-004": [
        {
            "external_id": "mock-post-004-a",
            "content": (
                "JVM tuning story: our GC pauses were not a GC problem. A cache with "
                "no eviction policy grew until the old generation had nothing left to "
                "collect. Two lines of Caffeine config fixed what three weeks of G1 "
                "flag tuning could not."
            ),
            "post_type": PostType.TEXT,
            "published_at": _ago(26),
            "like_count": 312,
            "comment_count": 38,
        },
        {
            "external_id": "mock-post-004-b",
            "content": "Happy to share I've completed my Kubernetes certification!",
            "post_type": PostType.IMAGE,
            "published_at": _ago(60),
            "like_count": 89,
            "comment_count": 14,
        },
        {
            "external_id": "mock-post-004-c",
            "content": (
                "Spring's @Transactional does not do what most people think it does "
                "when you call a method on the same class. Self-invocation bypasses "
                "the proxy entirely, so your transaction silently does not exist. "
                "This has now cost me two production incidents at two companies."
            ),
            "post_type": PostType.TEXT,
            "published_at": _ago(110),
            "like_count": 587,
            "comment_count": 76,
        },
    ],
    "mock-p-005": [
        {
            "external_id": "mock-post-005-a",
            "content": "URGENT HIRING: Java developers, 5+ years, immediate joiners. DM me!",
            "post_type": PostType.TEXT,
            "published_at": _ago(8),
            "like_count": 23,
            "comment_count": 45,
        },
    ],
    "mock-p-006": [
        {
            "external_id": "mock-post-006-a",
            "content": (
                "Internal developer platforms fail for an organisational reason, not "
                "a technical one: the platform team gets measured on adoption, so it "
                "builds features, when the thing product teams actually need is for "
                "the platform to stop changing under them."
            ),
            "post_type": PostType.TEXT,
            "published_at": _ago(20),
            "like_count": 523,
            "comment_count": 61,
        },
        {
            "external_id": "mock-post-006-b",
            "content": (
                "Eighteen-month migration off a Java 8 monolith, finished last week. "
                "The single highest-leverage thing we did was write a characterisation "
                "test suite against the old system's actual outputs before touching "
                "anything. It found four behaviours the spec said were impossible."
            ),
            "post_type": PostType.TEXT,
            "published_at": _ago(66),
            "like_count": 441,
            "comment_count": 49,
        },
        {
            "external_id": "mock-post-006-c",
            "content": (
                "Every architecture decision record we write now has a 'what would "
                "have to be true for this to be wrong' section. It has killed more "
                "bad decisions than any review meeting."
            ),
            "post_type": PostType.TEXT,
            "published_at": _ago(130),
            "like_count": 698,
            "comment_count": 72,
        },
    ],
    "mock-p-007": [
        {
            "external_id": "mock-post-007-a",
            "content": (
                "Your only limit is your mindset. 5 habits that changed my life. "
                "Save this post. Follow for more."
            ),
            "post_type": PostType.TEXT,
            "published_at": _ago(6),
            "like_count": 2100,
            "comment_count": 380,
        },
    ],
    "mock-p-008": [
        {
            "external_id": "mock-post-008-a",
            "content": (
                "Idempotency keys are not optional on any endpoint a mobile client "
                "can retry. We learned this by double-charging 1,400 customers during "
                "a network blip. The fix was forty lines. The refunds took a week."
            ),
            "post_type": PostType.TEXT,
            "published_at": _ago(22),
            "like_count": 1502,
            "comment_count": 187,
        },
        {
            "external_id": "mock-post-008-b",
            "content": (
                "API versioning opinion after doing it three ways: URL versioning is "
                "ugly and correct. Header versioning is elegant and nobody can debug "
                "it with curl at 3am."
            ),
            "post_type": PostType.TEXT,
            "published_at": _ago(70),
            "like_count": 834,
            "comment_count": 112,
        },
        {
            "external_id": "mock-post-008-c",
            "content": (
                "Decomposing a service by noun ('user service', 'order service') is "
                "how you end up with a chatty distributed monolith. Decompose by the "
                "transaction that has to stay consistent, and the nouns sort "
                "themselves out."
            ),
            "post_type": PostType.TEXT,
            "published_at": _ago(150),
            "like_count": 967,
            "comment_count": 121,
        },
    ],
}

#: Platform chrome the adapter returns alongside genuine posts, so the
#: eligibility filter has something real to exclude.
_NOISE: list[dict] = [
    {
        "external_id": "mock-noise-ad-1",
        "content": "Promoted: Scale your team with our hiring platform. Book a demo.",
        "post_type": PostType.ADVERTISEMENT,
        "is_authored_post": False,
    },
    {
        "external_id": "mock-noise-job-1",
        "content": "Senior Backend Engineer at Acme Corp — Bengaluru, India",
        "post_type": PostType.JOB,
        "is_authored_post": False,
    },
]


class MockSocialPlatformAdapter(SocialPlatformAdapter):
    platform = "mock"

    def __init__(
        self,
        *,
        latency_seconds: float = 0.0,
        failure_rate: float = 0.0,
        seed: int | None = 1337,
    ) -> None:
        self.latency_seconds = latency_seconds
        self.failure_rate = failure_rate
        self._random = random.Random(seed)
        self.liked_posts: set[str] = set()
        self.comments: dict[str, list[str]] = {}
        self.connections: dict[str, ConnectionStatus] = {}
        self.call_log: list[tuple[str, str]] = []

    @property
    def capabilities(self) -> dict[PlatformCapability, CapabilitySupport]:
        return dict.fromkeys(PlatformCapability, CapabilitySupport.SUPPORTED)

    async def _simulate(self, operation: str, subject: str) -> None:
        self.call_log.append((operation, subject))
        if self.latency_seconds:
            await asyncio.sleep(self.latency_seconds)
        if self.failure_rate and self._random.random() < self.failure_rate:
            raise PlatformError(
                f"Simulated transient failure during {operation}.",
                code=ErrorCode.SEARCH_FAILED,
            )

    # -- reads --------------------------------------------------------------

    async def search_people(self, criteria: SearchCriteria) -> SearchResult:
        self.require(PlatformCapability.SEARCH)
        await self._simulate("search_people", ",".join(criteria.job_titles))

        scored: list[tuple[int, list[str], dict]] = []
        for raw in _PEOPLE:
            haystack = " ".join(
                str(raw.get(key, "")) for key in ("headline", "job_title", "about", "industry")
            ).lower()
            matched: list[str] = []

            for title in criteria.job_titles:
                if title.lower() in haystack:
                    matched.append(title)
            for industry in criteria.industries:
                if industry.lower() in str(raw.get("industry", "")).lower():
                    matched.append(industry)
            for location in criteria.locations:
                if location.lower() in str(raw.get("location", "")).lower():
                    matched.append(location)
            for keyword in criteria.keywords:
                if keyword.lower() in haystack:
                    matched.append(keyword)

            if matched or not any(
                (criteria.job_titles, criteria.industries, criteria.locations, criteria.keywords)
            ):
                scored.append((len(matched), matched, raw))

        scored.sort(key=lambda item: item[0], reverse=True)

        offset = int(criteria.cursor) if criteria.cursor else 0
        window = scored[offset : offset + criteria.limit]

        people = [
            PersonProfile(
                external_id=raw["external_id"],
                profile_url=f"https://mock.local/in/{raw['external_id']}",
                full_name=raw["full_name"],
                headline=raw.get("headline"),
                job_title=raw.get("job_title"),
                company=raw.get("company"),
                industry=raw.get("industry"),
                location=raw.get("location"),
                about=raw.get("about"),
                connection_status=self.connections.get(
                    raw["external_id"], ConnectionStatus.NOT_CONNECTED
                ),
                last_activity_at=self._latest_activity(raw["external_id"]),
                matched_criteria=sorted(set(matched)),
                discovery_reason=(
                    f"Matched {len(set(matched))} criteria: {', '.join(sorted(set(matched)))}"
                    if matched
                    else "Returned by an unfiltered search"
                ),
            )
            for _, matched, raw in window
        ]

        next_offset = offset + criteria.limit
        return SearchResult(
            people=people,
            next_cursor=str(next_offset) if next_offset < len(scored) else None,
            total_estimate=len(scored),
        )

    async def get_profile(self, external_id: str) -> PersonProfile:
        self.require(PlatformCapability.PROFILE_READ)
        await self._simulate("get_profile", external_id)

        raw = next((p for p in _PEOPLE if p["external_id"] == external_id), None)
        if raw is None:
            raise PlatformError(
                f"No mock profile with id {external_id!r}.", code=ErrorCode.PROFILE_NOT_FOUND
            )

        return PersonProfile(
            external_id=raw["external_id"],
            profile_url=f"https://mock.local/in/{raw['external_id']}",
            full_name=raw["full_name"],
            headline=raw.get("headline"),
            job_title=raw.get("job_title"),
            company=raw.get("company"),
            industry=raw.get("industry"),
            location=raw.get("location"),
            about=raw.get("about"),
            connection_status=self.connections.get(external_id, ConnectionStatus.NOT_CONNECTED),
            last_activity_at=self._latest_activity(external_id),
        )

    async def get_posts(self, external_id: str, *, limit: int = 20) -> list[PlatformPost]:
        self.require(PlatformCapability.POST_READ)
        await self._simulate("get_posts", external_id)

        raw_posts = _POSTS.get(external_id, [])
        posts = [
            PlatformPost(
                external_id=raw["external_id"],
                author_external_id=external_id,
                content=raw["content"],
                post_type=raw.get("post_type", PostType.TEXT),
                post_url=f"https://mock.local/posts/{raw['external_id']}",
                published_at=raw.get("published_at"),
                like_count=raw.get("like_count"),
                comment_count=raw.get("comment_count"),
                is_authored_post=raw.get("is_authored_post", True),
                is_repost=raw.get("is_repost", False),
                has_added_commentary=raw.get("has_added_commentary", True),
            )
            for raw in raw_posts
        ]

        # Interleave platform chrome so the eligibility filter is exercised.
        noise = [
            PlatformPost(
                external_id=f"{item['external_id']}-{external_id}",
                author_external_id=external_id,
                content=item["content"],
                post_type=item["post_type"],
                published_at=_ago(1),
                is_authored_post=item["is_authored_post"],
            )
            for item in _NOISE
        ]
        combined = [noise[0], *posts[:1], *noise[1:], *posts[1:]] if posts else noise
        combined.sort(key=lambda p: p.published_at or _ago(9999), reverse=True)
        return combined[:limit]

    async def get_connection_status(self, person_external_id: str) -> ConnectionStatus:
        await self._simulate("get_connection_status", person_external_id)
        return self.connections.get(person_external_id, ConnectionStatus.NOT_CONNECTED)

    # -- writes -------------------------------------------------------------

    async def like_post(self, post_external_id: str) -> ActionOutcome:
        self.require(PlatformCapability.LIKE)
        await self._simulate("like_post", post_external_id)

        if post_external_id in self.liked_posts:
            return ActionOutcome(
                success=True,
                external_id=post_external_id,
                detail="Already liked.",
                already_done=True,
            )
        self.liked_posts.add(post_external_id)
        return ActionOutcome(success=True, external_id=post_external_id, detail="Liked.")

    async def comment_on_post(self, post_external_id: str, text: str) -> ActionOutcome:
        self.require(PlatformCapability.COMMENT)
        await self._simulate("comment_on_post", post_external_id)

        self.comments.setdefault(post_external_id, []).append(text)
        comment_id = f"{post_external_id}-c{len(self.comments[post_external_id])}"
        return ActionOutcome(success=True, external_id=comment_id, detail="Comment posted.")

    async def send_connection(
        self, person_external_id: str, message: str | None = None
    ) -> ActionOutcome:
        self.require(PlatformCapability.CONNECTION)
        await self._simulate("send_connection", person_external_id)

        current = self.connections.get(person_external_id, ConnectionStatus.NOT_CONNECTED)
        if current in (ConnectionStatus.PENDING, ConnectionStatus.CONNECTED):
            return ActionOutcome(
                success=True,
                external_id=person_external_id,
                detail=f"Connection already {current.value}.",
                already_done=True,
            )
        if message is not None and len(message) > 300:
            raise PlatformError(
                "Connection note exceeds the 300 character limit.",
                code=ErrorCode.CONNECTION_FAILED,
            )

        self.connections[person_external_id] = ConnectionStatus.PENDING
        return ActionOutcome(
            success=True, external_id=person_external_id, detail="Connection request sent."
        )

    # -- helpers ------------------------------------------------------------

    @staticmethod
    def _latest_activity(external_id: str) -> datetime | None:
        posts = _POSTS.get(external_id, [])
        dates = [p["published_at"] for p in posts if p.get("published_at")]
        return max(dates) if dates else None

    def reset(self) -> None:
        self.liked_posts.clear()
        self.comments.clear()
        self.connections.clear()
        self.call_log.clear()
