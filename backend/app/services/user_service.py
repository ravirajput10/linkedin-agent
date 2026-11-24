"""Admin-side user management: list, inspect, activate, deactivate, delete."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session

from app.config import settings as app_settings
from app.database.models import Campaign, PersonCampaign, User
from app.enums import CampaignStatus, UserRole, UserStatus
from app.errors import ConflictError, ValidationError
from app.logging import get_logger
from app.schemas.auth import AdminStats, AdminUserRead, AdminUserUpdate
from app.security import hash_password
from app.services import auth_service

logger = get_logger(__name__)


def effective_dry_run(user: User) -> bool:
    """A user may force dry run on; only the server can turn it off.

    The server-wide ``DRY_RUN`` is a safety switch, so it wins whenever it is
    set. With it off, the account's own default decides.
    """
    if app_settings.dry_run:
        return True
    user_settings = user.settings
    return True if user_settings is None else user_settings.default_dry_run


# ------------------------------------------------------------------ query --


def _search_filter(stmt: Select, search: str) -> Select:
    pattern = f"%{search.strip()}%"
    return stmt.where(
        or_(
            User.email.ilike(pattern),
            User.full_name.ilike(pattern),
            User.company.ilike(pattern),
        )
    )


def list_users(
    session: Session,
    *,
    search: str | None = None,
    role: UserRole | None = None,
    status: UserStatus | None = None,
    is_active: bool | None = None,
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[User], int]:
    stmt = select(User)
    count_stmt = select(func.count()).select_from(User)

    if search:
        stmt, count_stmt = _search_filter(stmt, search), _search_filter(count_stmt, search)
    for condition in (
        (User.role == role) if role is not None else None,
        (User.status == status) if status is not None else None,
        (User.is_active.is_(is_active)) if is_active is not None else None,
    ):
        if condition is not None:
            stmt = stmt.where(condition)
            count_stmt = count_stmt.where(condition)

    total = session.scalar(count_stmt) or 0
    users = list(
        session.scalars(stmt.order_by(User.created_at.desc()).offset(offset).limit(limit))
    )
    return users, total


def _activity_counts(session: Session, user_ids: list[int]) -> dict[int, tuple[int, int, int]]:
    """Campaign, running-campaign and candidate totals, in two queries not 3N."""
    if not user_ids:
        return {}

    campaign_rows = session.execute(
        select(
            Campaign.owner_id,
            func.count(Campaign.id),
            func.count(Campaign.id).filter(Campaign.status == CampaignStatus.RUNNING),
        )
        .where(Campaign.owner_id.in_(user_ids))
        .group_by(Campaign.owner_id)
    ).all()

    candidate_rows = session.execute(
        select(Campaign.owner_id, func.count(PersonCampaign.id))
        .join(PersonCampaign, PersonCampaign.campaign_id == Campaign.id)
        .where(Campaign.owner_id.in_(user_ids))
        .group_by(Campaign.owner_id)
    ).all()

    candidates = dict(candidate_rows)
    return {
        owner_id: (total, running, candidates.get(owner_id, 0))
        for owner_id, total, running in campaign_rows
    }


def to_admin_read(session: Session, users: list[User]) -> list[AdminUserRead]:
    counts = _activity_counts(session, [user.id for user in users])
    rows = []
    for user in users:
        campaigns, running, candidates = counts.get(user.id, (0, 0, 0))
        rows.append(
            AdminUserRead(
                **AdminUserRead.model_validate(user).model_dump(
                    exclude={"campaign_count", "active_campaign_count", "candidate_count"}
                ),
                campaign_count=campaigns,
                active_campaign_count=running,
                candidate_count=candidates,
            )
        )
    return rows


def stats(session: Session) -> AdminStats:
    def count_users(*conditions) -> int:
        stmt = select(func.count()).select_from(User)
        for condition in conditions:
            stmt = stmt.where(condition)
        return session.scalar(stmt) or 0

    week_ago = datetime.now(UTC) - timedelta(days=7)
    return AdminStats(
        total_users=count_users(),
        active_users=count_users(User.is_active.is_(True)),
        deactivated_users=count_users(User.is_active.is_(False)),
        pending_verification=count_users(User.status == UserStatus.PENDING_VERIFICATION),
        admins=count_users(User.role == UserRole.ADMIN),
        new_users_last_7_days=count_users(User.created_at >= week_ago),
        total_campaigns=session.scalar(select(func.count()).select_from(Campaign)) or 0,
        running_campaigns=session.scalar(
            select(func.count())
            .select_from(Campaign)
            .where(Campaign.status == CampaignStatus.RUNNING)
        )
        or 0,
    )


# ----------------------------------------------------------------- guards --


def _count_other_active_admins(session: Session, user_id: int) -> int:
    return (
        session.scalar(
            select(func.count())
            .select_from(User)
            .where(
                User.role == UserRole.ADMIN,
                User.is_active.is_(True),
                User.id != user_id,
            )
        )
        or 0
    )


def _guard_last_admin(session: Session, user: User, action: str) -> None:
    """Refuse anything that would leave the system with no way back in."""
    if user.role is not UserRole.ADMIN or not user.is_active:
        return
    if _count_other_active_admins(session, user.id) == 0:
        raise ConflictError(
            f"Cannot {action} the only active administrator. "
            "Promote another user to admin first."
        )


# --------------------------------------------------------------- mutation --


def set_active(
    session: Session,
    user: User,
    *,
    active: bool,
    actor: User,
    reason: str | None = None,
) -> User:
    if user.id == actor.id and not active:
        raise ConflictError("You cannot deactivate your own account.")
    if not active:
        _guard_last_admin(session, user, "deactivate")

    if user.is_active == active:
        return user

    user.is_active = active
    if active:
        user.deactivated_at = None
        user.deactivated_reason = None
        user.deactivated_by_id = None
        pending = app_settings.require_email_verification and not user.email_verified
        user.status = UserStatus.PENDING_VERIFICATION if pending else UserStatus.ACTIVE
    else:
        user.deactivated_at = datetime.now(UTC)
        user.deactivated_reason = (reason or "").strip() or None
        user.deactivated_by_id = actor.id
        user.status = UserStatus.DEACTIVATED
        # Kill live sessions now; an access token would otherwise stay valid
        # until it expires on its own.
        auth_service.revoke_all_tokens(session, user.id, "deactivated")

    session.flush()
    logger.info(
        "User %s %s by %s", user.email, "activated" if active else "deactivated", actor.email
    )
    return user


def update_user(session: Session, user: User, payload: AdminUserUpdate, *, actor: User) -> User:
    changes = payload.model_dump(exclude_unset=True)

    new_role = changes.get("role")
    if new_role is not None and new_role is not user.role:
        if user.id == actor.id and new_role is not UserRole.ADMIN:
            raise ConflictError("You cannot remove your own administrator role.")
        if user.role is UserRole.ADMIN:
            _guard_last_admin(session, user, "demote")

    for field, value in changes.items():
        if isinstance(value, str):
            value = value.strip() or None
        if field == "timezone" and value is None:
            continue
        setattr(user, field, value)

    if changes.get("email_verified") and user.email_verified_at is None:
        user.email_verified_at = datetime.now(UTC)
        user.verification_token = None
        if user.status is UserStatus.PENDING_VERIFICATION:
            user.status = UserStatus.ACTIVE

    session.flush()
    return user


def reset_password(session: Session, user: User, new_password: str, *, actor: User) -> int:
    user.hashed_password = hash_password(new_password)
    # A reset is how an admin rescues a locked-out user, so it clears the lock.
    user.failed_login_attempts = 0
    user.locked_until = None
    revoked = auth_service.revoke_all_tokens(session, user.id, "admin")
    session.flush()
    logger.info("Password for %s reset by %s", user.email, actor.email)
    return revoked


def delete_user(session: Session, user: User, *, actor: User) -> None:
    if user.id == actor.id:
        raise ConflictError("You cannot delete your own account.")
    _guard_last_admin(session, user, "delete")

    # Campaign.owner_id is ON DELETE SET NULL, so a deleted user's campaigns
    # survive as unowned rather than silently taking their data with them.
    orphaned = (
        session.scalar(
            select(func.count()).select_from(Campaign).where(Campaign.owner_id == user.id)
        )
        or 0
    )
    session.delete(user)
    session.flush()
    logger.info(
        "User %s deleted by %s (%d campaigns left unowned)", user.email, actor.email, orphaned
    )


# -------------------------------------------------------------- bootstrap --


def ensure_bootstrap_admin(session: Session) -> User | None:
    """Seed the first administrator from ``ADMIN_EMAIL`` / ``ADMIN_PASSWORD``.

    Only runs when the users table is empty, so it can never overwrite a real
    account or quietly resurrect one an admin deleted.
    """
    if not app_settings.admin_email or not app_settings.admin_password:
        return None
    if session.scalar(select(func.count()).select_from(User)):
        return None

    if len(app_settings.admin_password) < app_settings.min_password_length:
        raise ValidationError(
            f"ADMIN_PASSWORD must be at least {app_settings.min_password_length} characters."
        )

    user, _ = auth_service.create_user(
        session,
        email=app_settings.admin_email,
        password=app_settings.admin_password,
        full_name=app_settings.admin_full_name,
        role=UserRole.ADMIN,
        email_verified=True,
    )
    session.commit()
    logger.warning(
        "Seeded bootstrap administrator %s from ADMIN_EMAIL/ADMIN_PASSWORD. "
        "Change the password and clear those variables once you have signed in.",
        user.email,
    )
    return user
