"""Candidate and post discovery.

Reads through the platform adapter, filters deterministically, and persists the
results together with the reason each item was kept or dropped.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from urllib.parse import urlsplit, urlunsplit

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database.models import Campaign, Person, PersonCampaign, Post, Workflow
from app.enums import EventType, PostProcessingStatus, WorkflowState
from app.integrations.platform.base import (
    PersonProfile,
    PlatformPost,
    SearchCriteria,
    SocialPlatformAdapter,
)
from app.logging import get_logger
from app.services import eligibility, events

logger = get_logger(__name__)

#: LinkedIn serves the same profile from country mirrors with inconsistent
#: casing — in.linkedin.com/in/Williamhgates and nz.linkedin.com/in/williamhgates
#: are one person. Person identity is keyed on the URL, so without normalising
#: it the same human is re-discovered every run and gets liked and contacted
#: again, since idempotency keys are built from person_id.
_COUNTRY_MIRROR = re.compile(r"^[a-z]{2,3}\.linkedin\.com$", re.IGNORECASE)


def normalise_profile_url(url: str) -> str:
    if not url:
        return url
    parsed = urlsplit(url.strip())
    if not parsed.netloc:
        return url.strip().rstrip("/")

    host = parsed.netloc.lower()
    if _COUNTRY_MIRROR.match(host) and not host.startswith("www."):
        host = "www.linkedin.com"

    path = parsed.path.rstrip("/")
    # Member ids are case-sensitive; vanity handles are not.
    if "/in/" in path:
        head, _, handle = path.rpartition("/")
        if not handle.startswith("ACoA"):
            handle = handle.lower()
        path = f"{head}/{handle}"

    return urlunsplit((parsed.scheme.lower() or "https", host, path, "", ""))



def build_search_criteria(campaign: Campaign, *, limit: int) -> SearchCriteria:
    criteria = campaign.criteria
    return SearchCriteria(
        job_titles=list(criteria.job_titles),
        industries=list(criteria.industries),
        locations=list(criteria.locations),
        keywords=list(criteria.people_keywords or criteria.include_topics),
        seniority_levels=list(criteria.seniority_levels),
        company_sizes=list(criteria.company_sizes),
        limit=limit,
    )


def upsert_person(session: Session, adapter: SocialPlatformAdapter, profile: PersonProfile) -> Person:
    url = normalise_profile_url(profile.profile_url)

    person = session.scalar(
        select(Person).where(Person.platform == adapter.platform, Person.profile_url == url)
    )
    if person is None and profile.external_id:
        # A vendor can change the URL shape it returns; the id is steadier.
        person = session.scalar(
            select(Person).where(
                Person.platform == adapter.platform,
                Person.external_id == profile.external_id,
            )
        )
    if person is None:
        person = Person(
            platform=adapter.platform, profile_url=url, full_name=profile.full_name
        )
        session.add(person)
    else:
        person.profile_url = url

    person.external_id = profile.external_id or person.external_id
    person.full_name = profile.full_name or person.full_name
    person.headline = profile.headline or person.headline
    person.job_title = profile.job_title or person.job_title
    person.company = profile.company or person.company
    person.industry = profile.industry or person.industry
    person.location = profile.location or person.location
    person.about = profile.about or person.about
    person.avatar_url = profile.avatar_url or person.avatar_url
    person.connection_status = profile.connection_status
    person.last_activity_at = profile.last_activity_at or person.last_activity_at
    person.last_synced_at = datetime.now(UTC)
    session.flush()
    return person


def link_to_campaign(
    session: Session, campaign: Campaign, person: Person, profile: PersonProfile
) -> PersonCampaign:
    link = session.scalar(
        select(PersonCampaign).where(
            PersonCampaign.campaign_id == campaign.id, PersonCampaign.person_id == person.id
        )
    )
    if link is None:
        link = PersonCampaign(campaign_id=campaign.id, person_id=person.id)
        session.add(link)

    link.discovery_reason = profile.discovery_reason or link.discovery_reason
    link.matched_criteria = profile.matched_criteria or link.matched_criteria
    session.flush()
    return link


def ensure_workflow(session: Session, campaign: Campaign, person: Person) -> Workflow:
    workflow = session.scalar(
        select(Workflow).where(
            Workflow.campaign_id == campaign.id, Workflow.person_id == person.id
        )
    )
    if workflow is None:
        workflow = Workflow(
            campaign_id=campaign.id,
            person_id=person.id,
            state=WorkflowState.CANDIDATE_FOUND,
            context={},
        )
        session.add(workflow)
        session.flush()
    return workflow


async def discover_candidates(
    session: Session,
    *,
    adapter: SocialPlatformAdapter,
    campaign: Campaign,
    limit: int,
    agent_run_id: int | None = None,
) -> list[Workflow]:
    """Search the platform and create a workflow per newly discovered person."""
    criteria = build_search_criteria(campaign, limit=limit)
    result = await adapter.search_people(criteria)

    workflows: list[Workflow] = []
    for profile in result.people:
        person = upsert_person(session, adapter, profile)
        link_to_campaign(session, campaign, person, profile)
        workflow = ensure_workflow(session, campaign, person)
        workflows.append(workflow)

        events.emit(
            session,
            EventType.CANDIDATE_DISCOVERED,
            f"Discovered {person.full_name} — {person.headline or 'no headline'}",
            campaign_id=campaign.id,
            person_id=person.id,
            workflow_id=workflow.id,
            agent_run_id=agent_run_id,
            payload={
                "matched_criteria": profile.matched_criteria,
                "discovery_reason": profile.discovery_reason,
            },
        )

    logger.info(
        "Discovery for campaign %s returned %s people (%s total estimated).",
        campaign.id,
        len(workflows),
        result.total_estimate,
    )
    return workflows


def _upsert_post(
    session: Session,
    *,
    adapter: SocialPlatformAdapter,
    campaign: Campaign,
    person: Person,
    raw: PlatformPost,
    verdict: eligibility.EligibilityVerdict,
    sequence_index: int | None,
) -> Post:
    post = session.scalar(
        select(Post).where(
            Post.platform == adapter.platform, Post.external_id == raw.external_id
        )
    )
    if post is None:
        post = Post(
            platform=adapter.platform,
            external_id=raw.external_id,
            person_id=person.id,
            content="",
        )
        session.add(post)

    post.campaign_id = campaign.id
    post.content = raw.content
    post.post_type = raw.post_type
    post.post_url = raw.post_url
    post.published_at = raw.published_at
    post.like_count = raw.like_count
    post.comment_count = raw.comment_count
    post.is_eligible = verdict.eligible
    post.ineligibility_reason = verdict.reason
    post.sequence_index = sequence_index
    if post.processing_status is PostProcessingStatus.DISCOVERED:
        post.processing_status = (
            PostProcessingStatus.ELIGIBLE if verdict.eligible else PostProcessingStatus.INELIGIBLE
        )
    session.flush()
    return post


async def sync_posts_for_person(
    session: Session,
    *,
    adapter: SocialPlatformAdapter,
    campaign: Campaign,
    person: Person,
    limit: int = 20,
) -> list[Post]:
    """Fetch, filter and persist this person's posts. Returns eligible ones, newest first.

    Ineligible items are stored too, with the reason, so the UI can show why a
    post was not counted toward the engagement sequence.
    """
    raw_posts = await adapter.get_posts(person.external_id or "", limit=limit)
    annotated = eligibility.filter_eligible(raw_posts, campaign.criteria)

    eligible: list[Post] = []
    sequence = 0
    for raw, verdict in annotated:
        index = None
        if verdict.eligible:
            sequence += 1
            index = sequence
        post = _upsert_post(
            session,
            adapter=adapter,
            campaign=campaign,
            person=person,
            raw=raw,
            verdict=verdict,
            sequence_index=index,
        )
        if verdict.eligible:
            eligible.append(post)

    logger.info(
        "Post sync for person %s: %s eligible of %s fetched.",
        person.id,
        len(eligible),
        len(raw_posts),
    )
    return eligible
