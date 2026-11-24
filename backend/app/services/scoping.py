"""Row-level ownership.

``Campaign.owner_id`` is the single root of ownership. Everything else the UI
shows — candidates, posts, approvals, scheduled actions, activity, analytics —
hangs off a ``campaign_id``, so restricting a query to the campaigns a user owns
restricts all of it.

Admins are *not* given a wider view on the ordinary agent pages. An admin runs
their own campaigns like anyone else, and their dashboard shows those; the
cross-user view lives on ``/api/admin/*`` where it is explicit. Mixing other
people's candidates into an admin's own Candidates page would be surprising and
would make "what is my agent doing" unanswerable.
"""

from __future__ import annotations

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.database.models import Campaign, User
from app.errors import NotFoundError


def owned_campaign_ids(owner_id: int) -> Select:
    """Subquery of campaign ids visible to ``owner_id``."""
    return select(Campaign.id).where(Campaign.owner_id == owner_id)


def restrict(stmt: Select, column, owner_id: int | None) -> Select:
    """Narrow ``stmt`` to rows whose ``column`` is an owned campaign id.

    ``owner_id=None`` means unrestricted and is reserved for admin endpoints
    and background workers, which already know what they are operating on.
    """
    if owner_id is None:
        return stmt
    return stmt.where(column.in_(owned_campaign_ids(owner_id)))


def restrict_nullable(stmt: Select, column, owner_id: int | None) -> Select:
    """As ``restrict``, for columns that may be NULL.

    A NULL ``campaign_id`` marks a system-level row — a log line emitted by the
    scheduler itself, say. Those belong to no user, so a scoped query drops
    them rather than showing one person's agent an unrelated system event.
    """
    if owner_id is None:
        return stmt
    return stmt.where(column.in_(owned_campaign_ids(owner_id)))


def assert_owns_campaign(session: Session, campaign_id: int, owner_id: int | None) -> None:
    """Raise 404 — not 403 — when a campaign is someone else's.

    Answering "forbidden" would confirm the row exists, which tells an attacker
    how many campaigns the system holds and which ids are real.
    """
    if owner_id is None:
        return
    owned = session.scalar(
        select(Campaign.id).where(Campaign.id == campaign_id, Campaign.owner_id == owner_id)
    )
    if owned is None:
        raise NotFoundError(f"Campaign {campaign_id} not found.")


def scope_for(user: User) -> int:
    """The owner id to filter by for this user on the ordinary agent pages."""
    return user.id
