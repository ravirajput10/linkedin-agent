from __future__ import annotations

import csv
import io
import re
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.ai.agents.campaign_parser import CampaignParserAgent
from app.database.models import (
    Audience,
    AudienceMember,
    Campaign,
    DailyUsage,
    Person,
    PersonCampaign,
    User,
    Workflow,
)
from app.enums import CampaignStatus, ConnectionStatus, WorkflowState
from app.errors import AppError, ErrorCode, NotFoundError
from app.integrations.platform.base import PersonProfile, SearchCriteria, SearchResult
from app.integrations.platform.factory import get_platform_adapter
from app.schemas.audience import (
    AudienceCandidate,
    AudienceCreate,
    AudienceDetail,
    AudienceRead,
    AudienceSearchRequest,
    AudienceSearchResponse,
    AudienceUpdate,
    CSVImportResponse,
    FilterChip,
    PromptParseResponse,
)


def _initials(name: str) -> str:
    parts = name.strip().split()
    if not parts:
        return "P"
    if len(parts) == 1:
        return parts[0][:2].upper()
    return f"{parts[0][0]}{parts[-1][0]}".upper()


def _avatar_color(name: str) -> str:
    colors = [
        "bg-blue-600",
        "bg-emerald-600",
        "bg-purple-600",
        "bg-amber-600",
        "bg-sky-600",
        "bg-pink-600",
        "bg-indigo-600",
        "bg-teal-600",
    ]
    hash_val = sum(ord(c) for c in name)
    return colors[hash_val % len(colors)]


# ----------------------------------------------------------- FR-2.1 & FR-2.2 --


async def parse_audience_prompt(session: Session, prompt: str) -> PromptParseResponse:
    """Uses CampaignParserAgent to convert free-text prompt into structured filters."""
    agent = CampaignParserAgent()
    result = await agent.run(session=session, instruction=prompt)
    parsed = result.data

    chips: list[FilterChip] = []
    filters_dict: dict[str, Any] = {}

    if parsed.target_people.job_titles:
        chips.append(FilterChip(key="Title", value=", ".join(parsed.target_people.job_titles)))
        filters_dict["job_titles"] = parsed.target_people.job_titles

    if parsed.target_people.seniority_levels:
        chips.append(FilterChip(key="Seniority", value=", ".join(parsed.target_people.seniority_levels)))
        filters_dict["seniority_levels"] = parsed.target_people.seniority_levels

    if parsed.target_people.industries:
        chips.append(FilterChip(key="Industry", value=", ".join(parsed.target_people.industries)))
        filters_dict["industries"] = parsed.target_people.industries

    if parsed.target_people.locations:
        chips.append(FilterChip(key="Location", value=", ".join(parsed.target_people.locations)))
        filters_dict["locations"] = parsed.target_people.locations

    if parsed.target_people.company_sizes:
        chips.append(FilterChip(key="Company size", value=", ".join(parsed.target_people.company_sizes)))
        filters_dict["company_sizes"] = parsed.target_people.company_sizes

    if parsed.post_criteria.include_topics:
        chips.append(FilterChip(key="Posts about", value=", ".join(parsed.post_criteria.include_topics)))
        filters_dict["include_topics"] = parsed.post_criteria.include_topics

    if parsed.post_criteria.exclude_topics:
        chips.append(FilterChip(key="Exclude", value=", ".join(parsed.post_criteria.exclude_topics)))
        filters_dict["exclude_topics"] = parsed.post_criteria.exclude_topics
    else:
        chips.append(FilterChip(key="Exclude", value="1st-degree connections"))
        filters_dict["exclude_topics"] = ["1st-degree connections"]

    return PromptParseResponse(
        prompt=prompt,
        suggested_name=parsed.campaign_name or "Target Audience",
        summary=parsed.summary or "Discovered audience matching search criteria.",
        filters=filters_dict,
        filter_chips=chips,
    )


# --------------------------------------------------- FR-2.4, 2.5, 2.6 & 2.11 --


def _to_list(val: Any) -> list[str]:
    if isinstance(val, list):
        return [str(x).strip() for x in val if str(x).strip()]
    if isinstance(val, str) and val.strip():
        return [x.strip() for x in val.split(",") if x.strip()]
    return []


async def search_audience(
    session: Session, user: User, payload: AudienceSearchRequest
) -> AudienceSearchResponse:
    """Searches LinkedIn matching people through user session with rate limiting and exclusions."""
    # Check rate limits (FR-2.11)
    today = datetime.now(UTC).date()
    daily_usage = session.scalar(
        select(DailyUsage).where(
            DailyUsage.usage_date == today,
        )
    )
    processed_today = daily_usage.people_processed if daily_usage else 0
    max_views = 80
    if user.settings and getattr(user.settings, "max_people_per_day", None):
        max_views = user.settings.max_people_per_day

    if processed_today >= max_views:
        raise AppError(
            f"Daily profile view limit reached ({processed_today}/{max_views}). Try again tomorrow.",
            code=ErrorCode.RATE_LIMIT_REACHED,
            http_status=429,
        )

    # Build search criteria safely from both lists and strings
    filters = payload.filters or {}
    job_titles = _to_list(filters.get("job_titles") or filters.get("Title"))
    industries = _to_list(filters.get("industries") or filters.get("Industry"))
    locations = _to_list(filters.get("locations") or filters.get("Location"))
    company_sizes = _to_list(filters.get("company_sizes") or filters.get("Company size"))
    seniority = _to_list(filters.get("seniority_levels") or filters.get("Seniority"))
    keywords = _to_list(filters.get("include_topics") or filters.get("Posts about"))

    criteria = SearchCriteria(
        job_titles=job_titles,
        industries=industries,
        locations=locations,
        company_sizes=company_sizes,
        seniority_levels=seniority,
        keywords=keywords,
        limit=payload.limit,
    )

    adapter = get_platform_adapter()
    search_result: SearchResult = await adapter.search_people(criteria)

    # Active campaign prospects (FR-2.6)
    active_person_ids = set()
    if payload.exclude_active_campaigns:
        active_campaign_subq = select(Campaign.id).where(
            Campaign.owner_id == user.id,
            Campaign.status == CampaignStatus.RUNNING,
        )
        active_person_ids = set(
            session.scalars(
                select(PersonCampaign.person_id).where(
                    PersonCampaign.campaign_id.in_(active_campaign_subq)
                )
            ).all()
        )

    # Verify audience existence to avoid FK violation if audience_id was deleted/stale
    valid_audience = None
    if payload.audience_id:
        valid_audience = session.scalar(
            select(Audience).where(
                Audience.id == payload.audience_id,
                Audience.owner_id == user.id,
            )
        )

    # Audience existing exclusions (FR-2.7)
    excluded_person_ids = set()
    if valid_audience:
        excluded_person_ids = set(
            session.scalars(
                select(AudienceMember.person_id).where(
                    AudienceMember.audience_id == valid_audience.id,
                    AudienceMember.excluded.is_(True),
                )
            ).all()
        )

    candidates: list[AudienceCandidate] = []
    for profile in search_result.people:
        # Check 1st-degree connection exclusion (FR-2.6)
        if payload.exclude_connections and profile.connection_status == ConnectionStatus.CONNECTED:
            continue

        # Look up or create Person in DB
        person = session.scalar(
            select(Person).where(
                Person.platform == "linkedin",
                Person.profile_url == profile.profile_url,
            )
        )
        if person is None:
            person = Person(
                platform="linkedin",
                external_id=profile.external_id,
                profile_url=profile.profile_url,
                full_name=profile.full_name,
                headline=profile.headline,
                job_title=profile.job_title,
                company=profile.company,
                industry=profile.industry,
                location=profile.location,
                avatar_url=profile.avatar_url,
                connection_status=profile.connection_status,
                last_activity_at=profile.last_activity_at,
                last_synced_at=datetime.now(UTC),
            )
            session.add(person)
            session.flush()

        if payload.exclude_active_campaigns and person.id in active_person_ids:
            continue
        if person.id in excluded_person_ids:
            continue

        # Calculate fit score (0-100) (FR-2.5)
        matched_criteria = list(profile.matched_criteria or [])
        score = 80
        if job_titles and any(t.lower() in (person.job_title or "").lower() for t in job_titles):
            score += 10
            matched_criteria.append("Job title match")
        if industries and any(i.lower() in (person.industry or "").lower() for i in industries):
            score += 5
            matched_criteria.append("Industry match")
        if locations and any(loc.lower() in (person.location or "").lower() for loc in locations):
            score += 5
            matched_criteria.append("Location match")
        score = min(score, 99)

        why_match = profile.discovery_reason or (
            f"Matches {', '.join(matched_criteria)}" if matched_criteria else "Discovered by audience criteria"
        )

        candidate = AudienceCandidate(
            id=str(person.id),
            person_id=person.id,
            name=person.full_name,
            title=person.job_title or person.headline,
            company=person.company or "—",
            location=person.location or "—",
            profile_url=person.profile_url,
            avatar_url=person.avatar_url,
            fit_score=score,
            why_match=why_match,
            last_post="Active recently",
            connection_status=person.connection_status.value if hasattr(person.connection_status, "value") else str(person.connection_status),
            matched_criteria=matched_criteria,
            initials=_initials(person.full_name),
            avatar_color=_avatar_color(person.full_name),
        )
        candidates.append(candidate)

        # Save to audience if valid_audience exists
        if valid_audience:
            member = session.scalar(
                select(AudienceMember).where(
                    AudienceMember.audience_id == valid_audience.id,
                    AudienceMember.person_id == person.id,
                )
            )
            if member is None:
                member = AudienceMember(
                    audience_id=valid_audience.id,
                    person_id=person.id,
                    fit_score=score,
                    match_reason=why_match,
                    matched_criteria=matched_criteria,
                    source="search",
                )
                session.add(member)

    # Sort descending by fit score (FR-2.5)
    candidates.sort(key=lambda c: c.fit_score, reverse=True)
    session.commit()

    return AudienceSearchResponse(
        candidates=candidates,
        total=len(candidates),
        rate_limit_remaining=max(0, max_views - processed_today - len(candidates)),
    )


# ------------------------------------------------------------- CRUD (FR-2.8) --


def list_audiences(session: Session, owner_id: int) -> list[AudienceRead]:
    audiences = session.scalars(
        select(Audience)
        .where(Audience.owner_id == owner_id)
        .order_by(Audience.created_at.desc())
    ).all()

    result = []
    for aud in audiences:
        count = session.scalar(
            select(func.count(AudienceMember.id)).where(
                AudienceMember.audience_id == aud.id,
                AudienceMember.excluded.is_(False),
            )
        ) or 0
        read_obj = AudienceRead(
            id=aud.id,
            name=aud.name,
            original_prompt=aud.original_prompt,
            filters_json=aud.filters_json,
            refresh_schedule=aud.refresh_schedule,
            last_refreshed_at=aud.last_refreshed_at,
            is_archived=aud.is_archived,
            people_count=count,
            created_at=aud.created_at,
            updated_at=aud.updated_at,
        )
        result.append(read_obj)
    return result


def create_audience(session: Session, owner_id: int, payload: AudienceCreate) -> AudienceRead:
    aud = Audience(
        owner_id=owner_id,
        name=payload.name,
        original_prompt=payload.original_prompt,
        filters_json=payload.filters_json,
        refresh_schedule=payload.refresh_schedule,
    )
    session.add(aud)
    session.flush()

    people_count = 0
    if payload.member_person_ids:
        for pid in payload.member_person_ids:
            session.add(
                AudienceMember(
                    audience_id=aud.id,
                    person_id=pid,
                    fit_score=85,
                    source="search",
                )
            )
            people_count += 1

    session.commit()
    session.refresh(aud)
    return AudienceRead(
        id=aud.id,
        name=aud.name,
        original_prompt=aud.original_prompt,
        filters_json=aud.filters_json,
        refresh_schedule=aud.refresh_schedule,
        last_refreshed_at=aud.last_refreshed_at,
        is_archived=aud.is_archived,
        people_count=people_count,
        created_at=aud.created_at,
        updated_at=aud.updated_at,
    )



def get_audience_detail(session: Session, audience_id: int, owner_id: int) -> AudienceDetail:
    aud = session.scalar(
        select(Audience).where(Audience.id == audience_id, Audience.owner_id == owner_id)
    )
    if aud is None:
        raise NotFoundError(f"Audience {audience_id} not found.")

    members = session.scalars(
        select(AudienceMember)
        .where(AudienceMember.audience_id == aud.id, AudienceMember.excluded.is_(False))
        .order_by(AudienceMember.fit_score.desc())
    ).all()

    candidates: list[AudienceCandidate] = []
    for m in members:
        p = m.person
        if p:
            candidates.append(
                AudienceCandidate(
                    id=str(p.id),
                    person_id=p.id,
                    name=p.full_name,
                    title=p.job_title or p.headline,
                    company=p.company or "—",
                    location=p.location or "—",
                    profile_url=p.profile_url,
                    avatar_url=p.avatar_url,
                    fit_score=m.fit_score,
                    why_match=m.match_reason or "Discovered by audience criteria",
                    last_post="Active recently",
                    connection_status=p.connection_status.value if hasattr(p.connection_status, "value") else str(p.connection_status),
                    matched_criteria=m.matched_criteria,
                    initials=_initials(p.full_name),
                    avatar_color=_avatar_color(p.full_name),
                )
            )

    return AudienceDetail(
        id=aud.id,
        name=aud.name,
        original_prompt=aud.original_prompt,
        filters_json=aud.filters_json,
        refresh_schedule=aud.refresh_schedule,
        last_refreshed_at=aud.last_refreshed_at,
        is_archived=aud.is_archived,
        people_count=len(candidates),
        created_at=aud.created_at,
        updated_at=aud.updated_at,
        members=candidates,
    )


def update_audience(
    session: Session, audience_id: int, owner_id: int, payload: AudienceUpdate
) -> AudienceRead:
    aud = session.scalar(
        select(Audience).where(Audience.id == audience_id, Audience.owner_id == owner_id)
    )
    if aud is None:
        raise NotFoundError(f"Audience {audience_id} not found.")

    if payload.name is not None:
        aud.name = payload.name
    if payload.original_prompt is not None:
        aud.original_prompt = payload.original_prompt
    if payload.filters_json is not None:
        aud.filters_json = payload.filters_json
    if payload.refresh_schedule is not None:
        aud.refresh_schedule = payload.refresh_schedule
    if payload.is_archived is not None:
        aud.is_archived = payload.is_archived

    if payload.member_person_ids:
        existing_pids = set(
            session.scalars(
                select(AudienceMember.person_id).where(
                    AudienceMember.audience_id == aud.id
                )
            ).all()
        )
        for pid in payload.member_person_ids:
            if pid not in existing_pids:
                session.add(
                    AudienceMember(
                        audience_id=aud.id,
                        person_id=pid,
                        fit_score=85,
                        source="search",
                    )
                )

    aud.updated_at = datetime.now(UTC)
    session.commit()
    session.refresh(aud)

    count = session.scalar(
        select(func.count(AudienceMember.id)).where(
            AudienceMember.audience_id == aud.id,
            AudienceMember.excluded.is_(False),
        )
    ) or 0

    return AudienceRead(
        id=aud.id,
        name=aud.name,
        original_prompt=aud.original_prompt,
        filters_json=aud.filters_json,
        refresh_schedule=aud.refresh_schedule,
        last_refreshed_at=aud.last_refreshed_at,
        is_archived=aud.is_archived,
        people_count=count,
        created_at=aud.created_at,
        updated_at=aud.updated_at,
    )


def duplicate_audience(session: Session, audience_id: int, owner_id: int) -> AudienceRead:
    source = session.scalar(
        select(Audience).where(Audience.id == audience_id, Audience.owner_id == owner_id)
    )
    if source is None:
        raise NotFoundError(f"Audience {audience_id} not found.")

    clone = Audience(
        owner_id=owner_id,
        name=f"{source.name} (Copy)",
        original_prompt=source.original_prompt,
        filters_json=dict(source.filters_json),
        refresh_schedule=source.refresh_schedule,
    )
    session.add(clone)
    session.flush()

    # Clone active members
    source_members = session.scalars(
        select(AudienceMember).where(
            AudienceMember.audience_id == source.id,
            AudienceMember.excluded.is_(False),
        )
    ).all()

    for sm in source_members:
        cm = AudienceMember(
            audience_id=clone.id,
            person_id=sm.person_id,
            fit_score=sm.fit_score,
            match_reason=sm.match_reason,
            matched_criteria=list(sm.matched_criteria),
            source=sm.source,
        )
        session.add(cm)

    session.commit()
    session.refresh(clone)

    return AudienceRead(
        id=clone.id,
        name=clone.name,
        original_prompt=clone.original_prompt,
        filters_json=clone.filters_json,
        refresh_schedule=clone.refresh_schedule,
        last_refreshed_at=clone.last_refreshed_at,
        is_archived=clone.is_archived,
        people_count=len(source_members),
        created_at=clone.created_at,
        updated_at=clone.updated_at,
    )


def archive_audience(session: Session, audience_id: int, owner_id: int) -> AudienceRead:
    aud = session.scalar(
        select(Audience).where(Audience.id == audience_id, Audience.owner_id == owner_id)
    )
    if aud is None:
        raise NotFoundError(f"Audience {audience_id} not found.")

    aud.is_archived = not aud.is_archived
    aud.updated_at = datetime.now(UTC)
    session.commit()
    session.refresh(aud)

    count = session.scalar(
        select(func.count(AudienceMember.id)).where(
            AudienceMember.audience_id == aud.id,
            AudienceMember.excluded.is_(False),
        )
    ) or 0

    return AudienceRead(
        id=aud.id,
        name=aud.name,
        original_prompt=aud.original_prompt,
        filters_json=aud.filters_json,
        refresh_schedule=aud.refresh_schedule,
        last_refreshed_at=aud.last_refreshed_at,
        is_archived=aud.is_archived,
        people_count=count,
        created_at=aud.created_at,
        updated_at=aud.updated_at,
    )


def delete_audience(session: Session, audience_id: int, owner_id: int) -> None:
    aud = session.scalar(
        select(Audience).where(Audience.id == audience_id, Audience.owner_id == owner_id)
    )
    if aud is None:
        raise NotFoundError(f"Audience {audience_id} not found.")

    session.delete(aud)
    session.commit()


# ---------------------------------------------------- Refresh (FR-2.9) -------


async def refresh_audience(
    session: Session, audience_id: int, user: User
) -> AudienceDetail:
    """Refreshes audience with live LinkedIn search based on saved filters and updates last_refreshed_at."""
    aud = session.scalar(
        select(Audience).where(Audience.id == audience_id, Audience.owner_id == user.id)
    )
    if aud is None:
        raise NotFoundError(f"Audience {audience_id} not found.")

    search_req = AudienceSearchRequest(
        prompt=aud.original_prompt,
        filters=aud.filters_json,
        audience_id=aud.id,
        exclude_connections=True,
        exclude_active_campaigns=True,
    )
    await search_audience(session, user, search_req)

    aud.last_refreshed_at = datetime.now(UTC)
    session.commit()

    return get_audience_detail(session, audience_id, user.id)


# ---------------------------------------- Batch Exclude & Campaign (FR-2.7) --


def assign_audience_to_campaign(
    session: Session,
    audience_id: int,
    owner_id: int,
    campaign_id: int,
    person_ids: list[int],
) -> int:
    """Enrolls selected candidates into campaign workflows."""
    aud = session.scalar(
        select(Audience).where(Audience.id == audience_id, Audience.owner_id == owner_id)
    )
    if aud is None:
        raise NotFoundError(f"Audience {audience_id} not found.")

    camp = session.scalar(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.owner_id == owner_id)
    )
    if camp is None:
        raise NotFoundError(f"Campaign {campaign_id} not found.")

    assigned_count = 0
    for pid in person_ids:
        # Check existing link
        link = session.scalar(
            select(PersonCampaign).where(
                PersonCampaign.campaign_id == camp.id, PersonCampaign.person_id == pid
            )
        )
        if link is None:
            link = PersonCampaign(
                campaign_id=camp.id,
                person_id=pid,
                discovery_reason=f"Assigned from audience '{aud.name}'",
                matched_criteria=["Audience member"],
                match_score=90,
            )
            session.add(link)
            assigned_count += 1

        # Check workflow
        wf = session.scalar(
            select(Workflow).where(Workflow.campaign_id == camp.id, Workflow.person_id == pid)
        )
        if wf is None:
            wf = Workflow(
                campaign_id=camp.id,
                person_id=pid,
                state=WorkflowState.CANDIDATE_FOUND,
                context={},
            )
            session.add(wf)

    session.commit()
    return assigned_count


def exclude_audience_candidates(
    session: Session,
    audience_id: int,
    owner_id: int,
    person_ids: list[int],
    reason: str | None = None,
) -> int:
    """Permanently excludes candidates from this audience."""
    aud = session.scalar(
        select(Audience).where(Audience.id == audience_id, Audience.owner_id == owner_id)
    )
    if aud is None:
        raise NotFoundError(f"Audience {audience_id} not found.")

    count = 0
    for pid in person_ids:
        member = session.scalar(
            select(AudienceMember).where(
                AudienceMember.audience_id == aud.id, AudienceMember.person_id == pid
            )
        )
        if member:
            member.excluded = True
            member.exclusion_reason = reason or "Manually excluded by user"
            count += 1
        else:
            # Add as explicitly excluded member so future searches filter them out
            member = AudienceMember(
                audience_id=aud.id,
                person_id=pid,
                excluded=True,
                exclusion_reason=reason or "Manually excluded by user",
                source="manual_exclusion",
            )
            session.add(member)
            count += 1

    session.commit()
    return count


# ---------------------------------------------------- CSV Import (FR-2.10) ---


def import_csv_profiles(
    session: Session,
    user: User,
    csv_text: str,
    audience_id: int | None = None,
) -> CSVImportResponse:
    """Parses LinkedIn profile URLs from CSV and imports them as Audience members."""
    reader = csv.reader(io.StringIO(csv_text))
    url_pattern = re.compile(r"https?://(?:www\.)?linkedin\.com/(?:in|sales/lead)/[a-zA-Z0-9_-]+/?", re.IGNORECASE)

    imported_candidates: list[AudienceCandidate] = []
    skipped = 0

    for row in reader:
        line_text = " ".join(row)
        match = url_pattern.search(line_text)
        if not match:
            skipped += 1
            continue

        profile_url = match.group(0).rstrip("/")
        name = "LinkedIn Prospect"
        title = "Prospect"
        company = "—"

        # Try to infer name and title from other columns
        cleaned_cells = [c.strip() for c in row if c.strip() and not url_pattern.search(c)]
        if len(cleaned_cells) >= 1:
            name = cleaned_cells[0]
        if len(cleaned_cells) >= 2:
            title = cleaned_cells[1]
        if len(cleaned_cells) >= 3:
            company = cleaned_cells[2]

        person = session.scalar(
            select(Person).where(
                Person.platform == "linkedin",
                Person.profile_url == profile_url,
            )
        )
        if person is None:
            person = Person(
                platform="linkedin",
                profile_url=profile_url,
                full_name=name,
                headline=title,
                job_title=title,
                company=company,
                connection_status=ConnectionStatus.UNKNOWN,
                last_synced_at=datetime.now(UTC),
            )
            session.add(person)
            session.flush()

        if audience_id:
            member = session.scalar(
                select(AudienceMember).where(
                    AudienceMember.audience_id == audience_id,
                    AudienceMember.person_id == person.id,
                )
            )
            if member is None:
                member = AudienceMember(
                    audience_id=audience_id,
                    person_id=person.id,
                    fit_score=85,
                    match_reason="Imported from CSV list",
                    matched_criteria=["CSV import"],
                    source="csv_import",
                )
                session.add(member)

        imported_candidates.append(
            AudienceCandidate(
                id=str(person.id),
                person_id=person.id,
                name=person.full_name,
                title=person.job_title or person.headline,
                company=person.company or "—",
                location=person.location or "—",
                profile_url=person.profile_url,
                avatar_url=person.avatar_url,
                fit_score=85,
                why_match="Imported from CSV list",
                last_post="Imported contact",
                connection_status="UNKNOWN",
                matched_criteria=["CSV import"],
                initials=_initials(person.full_name),
                avatar_color=_avatar_color(person.full_name),
            )
        )

    session.commit()
    return CSVImportResponse(
        imported_count=len(imported_candidates),
        skipped_count=skipped,
        prospects=imported_candidates,
    )
