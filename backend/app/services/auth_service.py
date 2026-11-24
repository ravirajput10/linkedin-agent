"""Registration, sign-in, token rotation and self-service profile changes.

Access tokens are stateless, so a signed token stays cryptographically valid
until it expires. Two things close that window: ``get_current_user`` re-reads
the account on every request and refuses a deactivated one, and refresh tokens
live in the database where they can be revoked outright.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session, selectinload

import httpx

from app.config import settings
from app.database.models import RefreshToken, User, UserPlatformAccount, UserSettings
from app.enums import (
    ApprovalMode,
    PlatformAccountStatus,
    PlatformProvider,
    UserRole,
    UserStatus,
)
from app.errors import AppError, ConflictError, ErrorCode, NotFoundError, ValidationError
from app.logging import get_logger
from app.schemas.auth import (
    PasswordChange,
    ProfileUpdate,
    RegisterRequest,
    UserSettingsUpdate,
)
from app.security import (
    create_access_token,
    create_oauth_state,
    create_refresh_token,
    decode_token,
    generate_token,
    hash_password,
    hash_token,
    verify_oauth_state,
    verify_password,
)

logger = get_logger(__name__)

USER_LOADERS = (selectinload(User.settings),)


class AuthenticationError(AppError):
    code = ErrorCode.AUTHENTICATION_EXPIRED
    http_status = 401


class AccountLockedError(AppError):
    code = ErrorCode.RATE_LIMIT_REACHED
    http_status = 429


class AccountInactiveError(AppError):
    """Distinct from a bad password: the credentials were right, access is not."""

    code = ErrorCode.AUTHENTICATION_EXPIRED
    http_status = 403


def normalize_email(email: str) -> str:
    return email.strip().lower()


# -- lookup --


def get_user(session: Session, user_id: int) -> User:
    user = session.scalar(select(User).where(User.id == user_id).options(*USER_LOADERS))
    if user is None:
        raise NotFoundError(f"User {user_id} not found.")
    return user


def find_by_email(session: Session, email: str) -> User | None:
    return session.scalar(
        select(User).where(User.email == normalize_email(email)).options(*USER_LOADERS)
    )


def ensure_settings(session: Session, user: User) -> UserSettings:
    """Every user has a settings row; created lazily so older rows self-heal."""
    if user.settings is not None:
        return user.settings
    user_settings = UserSettings(user_id=user.id)
    session.add(user_settings)
    session.flush()
    user.settings = user_settings
    return user_settings


# ----------------------------------------------------------- registration --


def _issue_verification(user: User) -> str:
    """Always issued, even with the flag off, so enabling it needs no backfill."""
    raw = generate_token()
    now = datetime.now(UTC)
    user.verification_token = hash_token(raw)
    user.verification_sent_at = now
    user.verification_expires_at = now + timedelta(
        hours=settings.email_verification_token_hours
    )
    return raw


def create_user(
    session: Session,
    *,
    email: str,
    password: str,
    full_name: str | None = None,
    role: UserRole = UserRole.USER,
    is_active: bool = True,
    email_verified: bool = False,
    plan_id: str | None = None,
    billing_cycle: str | None = None,
) -> tuple[User, str | None]:
    """Create an account and its settings row. Returns ``(user, raw_token)``."""
    address = normalize_email(email)
    if session.scalar(select(func.count()).select_from(User).where(User.email == address)):
        raise ConflictError("An account with that email already exists.")

    verification_pending = settings.require_email_verification and not email_verified
    user = User(
        email=address,
        full_name=(full_name or "").strip() or None,
        hashed_password=hash_password(password),
        role=role,
        is_active=is_active,
        email_verified=email_verified,
        email_verified_at=datetime.now(UTC) if email_verified else None,
        plan_id=plan_id,
        billing_cycle=billing_cycle,
        status=(
            UserStatus.PENDING_VERIFICATION
            if verification_pending
            else (UserStatus.ACTIVE if is_active else UserStatus.DEACTIVATED)
        ),
    )
    session.add(user)
    session.flush()

    raw_token = None if email_verified else _issue_verification(user)
    session.add(UserSettings(user_id=user.id))
    session.flush()
    session.refresh(user)

    logger.info("Created user %s (role=%s, active=%s, plan=%s)", user.email, user.role.value, is_active, plan_id)
    return user, raw_token


def register(session: Session, payload: RegisterRequest) -> tuple[User, str | None]:
    if not settings.allow_registration:
        raise ValidationError("Public registration is disabled. Ask an administrator for an account.")
    return create_user(
        session,
        email=payload.email,
        password=payload.password,
        full_name=payload.full_name,
        plan_id=payload.plan_id,
        billing_cycle=payload.billing_cycle,
    )


def verify_email(session: Session, raw_token: str) -> User:
    digest = hash_token(raw_token.strip())
    user = session.scalar(
        select(User).where(User.verification_token == digest).options(*USER_LOADERS)
    )
    if user is None:
        raise ValidationError("That verification link is not valid.")

    expires_at = user.verification_expires_at
    if expires_at is not None:
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        if expires_at < datetime.now(UTC):
            raise ValidationError("That verification link has expired. Request a new one.")

    user.email_verified = True
    user.email_verified_at = datetime.now(UTC)
    user.verification_token = None
    user.verification_expires_at = None
    if user.status is UserStatus.PENDING_VERIFICATION:
        user.status = UserStatus.ACTIVE
        user.is_active = True
    session.flush()
    return user


def resend_verification(session: Session, email: str) -> str | None:
    """Returns a fresh token, or None when there is nothing to verify.

    The caller must not reveal which of those happened — that would turn this
    endpoint into an account-existence oracle.
    """
    user = find_by_email(session, email)
    if user is None or user.email_verified:
        return None
    raw = _issue_verification(user)
    session.flush()
    return raw


# ----------------------------------------------------------------- tokens --


def _store_refresh_token(
    session: Session,
    user: User,
    token: str,
    jti: str,
    expires_at: datetime,
    *,
    user_agent: str | None,
    ip_address: str | None,
) -> None:
    session.add(
        RefreshToken(
            user_id=user.id,
            jti=jti,
            token_hash=hash_token(token),
            expires_at=expires_at,
            user_agent=(user_agent or "")[:300] or None,
            ip_address=(ip_address or "")[:64] or None,
        )
    )
    session.flush()


def issue_tokens(
    session: Session,
    user: User,
    *,
    user_agent: str | None = None,
    ip_address: str | None = None,
) -> tuple[str, str, datetime]:
    access_token, expires_at = create_access_token(user.id, role=user.role.value)
    refresh, jti, refresh_expires = create_refresh_token(user.id)
    _store_refresh_token(
        session, user, refresh, jti, refresh_expires, user_agent=user_agent, ip_address=ip_address
    )
    return access_token, refresh, expires_at


def revoke_all_tokens(session: Session, user_id: int, reason: str) -> int:
    """Revoke every live refresh token for a user. Returns how many were open."""
    result = session.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC), revoked_reason=reason)
    )
    return int(result.rowcount or 0)


def _record_failed_login(session: Session, user: User, now: datetime) -> None:
    """Count a wrong password, locking the account once the limit is reached.

    Committed here rather than by the request: the caller raises next, and the
    request session rolls back on any exception, which would erase the count
    and make the limit unreachable.
    """
    user.failed_login_attempts += 1
    if user.failed_login_attempts >= settings.login_max_failed_attempts:
        user.locked_until = now + timedelta(minutes=settings.login_lockout_minutes)
        user.failed_login_attempts = 0
        logger.warning("Locked %s after repeated failed sign-ins", user.email)
    session.commit()


def authenticate(
    session: Session,
    *,
    email: str,
    password: str,
    user_agent: str | None = None,
    ip_address: str | None = None,
) -> tuple[User, str, str, datetime]:
    user = find_by_email(session, email)

    # Hash even when the account is missing, so a wrong email and a wrong
    # password take the same time and cannot be told apart by a stopwatch.
    if user is None:
        hash_password(password)
        raise AuthenticationError("Incorrect email or password.")

    now = datetime.now(UTC)
    if user.locked_until is not None and user.locked_until > now:
        raise AccountLockedError(
            "Too many failed sign-in attempts. Try again later.",
            details={"locked_until": user.locked_until.isoformat()},
        )

    if not verify_password(password, user.hashed_password):
        _record_failed_login(session, user, now)
        raise AuthenticationError("Incorrect email or password.")

    user.failed_login_attempts = 0
    user.locked_until = None

    if not user.can_log_in:
        raise AccountInactiveError(
            user.deactivated_reason
            or "This account has been deactivated. Contact an administrator."
        )
    if settings.require_email_verification and not user.email_verified:
        raise AccountInactiveError(
            "Confirm your email address before signing in.",
            details={"verification_required": True},
        )

    user.last_login_at = datetime.now(UTC)
    access_token, refresh, expires_at = issue_tokens(
        session, user, user_agent=user_agent, ip_address=ip_address
    )
    ensure_settings(session, user)
    session.flush()
    return user, access_token, refresh, expires_at


def refresh_session(
    session: Session,
    raw_refresh_token: str,
    *,
    user_agent: str | None = None,
    ip_address: str | None = None,
) -> tuple[User, str, str, datetime]:
    """Rotate a refresh token: the presented one is revoked and replaced."""
    claims = decode_token(raw_refresh_token, expected_type="refresh")
    stored = session.scalar(select(RefreshToken).where(RefreshToken.jti == claims.jti))
    if stored is None:
        raise AuthenticationError("This session is no longer valid. Sign in again.")
    if stored.revoked_at is not None:
        # Replaying a token that was *rotated* means two parties hold it: the
        # legitimate client already swapped it, so whoever presents it again
        # copied it. Drop every session rather than guess which one is real.
        #
        # A token revoked by logout, a password change or an admin is a
        # different story — that one is simply spent, and killing the user's
        # other devices for presenting it would be a denial of service.
        if stored.revoked_reason == "rotated":
            revoke_all_tokens(session, stored.user_id, "reuse_detected")
            session.flush()
        raise AuthenticationError("This session was revoked. Sign in again.")
    if stored.token_hash != hash_token(raw_refresh_token):
        raise AuthenticationError("This session is no longer valid. Sign in again.")

    user = get_user(session, stored.user_id)
    if not user.can_log_in:
        revoke_all_tokens(session, user.id, "deactivated")
        session.flush()
        raise AccountInactiveError(
            user.deactivated_reason or "This account has been deactivated."
        )

    stored.revoked_at = datetime.now(UTC)
    stored.revoked_reason = "rotated"
    access_token, refresh, expires_at = issue_tokens(
        session, user, user_agent=user_agent, ip_address=ip_address
    )
    session.flush()
    return user, access_token, refresh, expires_at


def logout(session: Session, raw_refresh_token: str | None, user_id: int) -> None:
    """Revoke the presented session, or every session when none is given."""
    if not raw_refresh_token:
        revoke_all_tokens(session, user_id, "logout")
        session.flush()
        return
    try:
        claims = decode_token(raw_refresh_token, expected_type="refresh")
    except AppError:
        # An expired or malformed token is already unusable; logout succeeded.
        return
    stored = session.scalar(select(RefreshToken).where(RefreshToken.jti == claims.jti))
    if stored is not None and stored.revoked_at is None:
        stored.revoked_at = datetime.now(UTC)
        stored.revoked_reason = "logout"
    session.flush()


def purge_expired_tokens(session: Session) -> int:
    """Housekeeping: drop rows that can no longer authorize anything."""
    rows = session.query(RefreshToken).filter(
        RefreshToken.expires_at < datetime.now(UTC) - timedelta(days=7)
    )
    deleted = rows.delete(synchronize_session=False)
    return int(deleted or 0)


# ---------------------------------------------------------------- profile --


def update_profile(session: Session, user: User, payload: ProfileUpdate) -> User:
    for field, value in payload.model_dump(exclude_unset=True).items():
        if isinstance(value, str):
            value = value.strip() or None
        if field == "timezone" and value is None:
            continue  # the column is not nullable; an empty box means "unchanged"
        setattr(user, field, value)
    session.flush()
    return user


def change_password(session: Session, user: User, payload: PasswordChange) -> int:
    if not verify_password(payload.current_password, user.hashed_password):
        raise AuthenticationError("Your current password is incorrect.")
    if verify_password(payload.new_password, user.hashed_password):
        raise ValidationError("The new password must differ from the current one.")

    user.hashed_password = hash_password(payload.new_password)
    # Every other device holds a session minted against the old password.
    revoked = revoke_all_tokens(session, user.id, "password_changed")
    session.flush()
    return revoked


def update_settings(
    session: Session, user: User, payload: UserSettingsUpdate
) -> UserSettings:
    user_settings = ensure_settings(session, user)
    changes = payload.model_dump(exclude_unset=True)

    from app.services.safety_service import validate_safety_limits
    validate_safety_limits(changes)

    low = changes.get("min_action_delay_seconds", user_settings.min_action_delay_seconds)
    high = changes.get("max_action_delay_seconds", user_settings.max_action_delay_seconds)
    if low > high:
        raise ValidationError(
            "The minimum action delay cannot be greater than the maximum."
        )

    if changes.get("default_dry_run") is False and settings.dry_run:
        raise ValidationError(
            "Dry run is enforced server-wide. An administrator must turn off "
            "DRY_RUN before any account can run live."
        )

    for field, value in changes.items():
        setattr(user_settings, field, value)
    session.flush()
    return user_settings


# -- LinkedIn OAuth & Onboarding --


def get_linkedin_oauth_url(redirect_uri: str | None = None, state: str | None = None) -> tuple[str, str]:
    """Generate the LinkedIn OAuth 2.0 authorization URL and state token"""
    from urllib.parse import urlencode

    if not settings.linkedin_client_id:
        raise ValidationError(
            "LinkedIn OAuth client ID is not configured. "
            "Please configure LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET in backend/.env.local "
            "or sign in with standard account credentials."
        )

    state_token = state or create_oauth_state()
    default_callback = f"{settings.app_base_url.rstrip('/')}/auth/callback" if settings.app_base_url else "http://localhost:5173/auth/callback"
    redirect_target = redirect_uri or settings.linkedin_redirect_uri or default_callback
    params = {
        "response_type": "code",
        "client_id": settings.linkedin_client_id,
        "redirect_uri": redirect_target,
        "state": state_token,
        "scope": "openid profile email",
    }
    url = f"https://www.linkedin.com/oauth/v2/authorization?{urlencode(params)}"
    return url, state_token


async def login_or_register_linkedin(
    session: Session,
    code: str,
    *,
    state: str | None = None,
    redirect_uri: str | None = None,
) -> User:
    """Exchange authorization code, fetch LinkedIn profile, and authenticate or create user"""
    if not settings.linkedin_client_id or not settings.linkedin_client_secret:
        raise ValidationError(
            "LinkedIn OAuth credentials (LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET) are not configured."
        )

    # Before spending the code: an unsigned or stale state means this callback
    # was not started by our own authorize endpoint (login CSRF).
    verify_oauth_state(state)

    default_callback = f"{settings.app_base_url.rstrip('/')}/auth/callback" if settings.app_base_url else "http://localhost:5173/auth/callback"
    redirect = redirect_uri or settings.linkedin_redirect_uri or default_callback

    # Live token exchange
    token_url = "https://www.linkedin.com/oauth/v2/accessToken"
    userinfo_url = "https://api.linkedin.com/v2/userinfo"
    payload = {
        "grant_type": "authorization_code",
        "code": code,
        "client_id": settings.linkedin_client_id,
        "client_secret": settings.linkedin_client_secret,
        "redirect_uri": redirect,
    }
    headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            token_resp = await client.post(token_url, data=payload, headers=headers)
            if token_resp.is_error:
                logger.error(
                    "LinkedIn token endpoint error status=%s body=%s",
                    token_resp.status_code,
                    token_resp.text,
                )
                try:
                    err_json = token_resp.json()
                    err_desc = (
                        err_json.get("error_description")
                        or err_json.get("error")
                        or token_resp.text
                    )
                except Exception:
                    err_desc = token_resp.text
                raise AuthenticationError(f"LinkedIn authentication failed: {err_desc}")

            token_data = token_resp.json()
            access_token = token_data.get("access_token")

            if not access_token:
                raise AuthenticationError("LinkedIn did not return an access token.")

            userinfo_resp = await client.get(
                userinfo_url,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                },
            )
            if userinfo_resp.is_error:
                logger.error(
                    "LinkedIn userinfo endpoint error status=%s body=%s",
                    userinfo_resp.status_code,
                    userinfo_resp.text,
                )
                raise AuthenticationError(
                    f"LinkedIn userinfo request failed ({userinfo_resp.status_code}): {userinfo_resp.text}"
                )

            userinfo = userinfo_resp.json()
    except AuthenticationError:
        raise
    except Exception as exc:
        logger.error("LinkedIn OAuth code exchange failed: %s", exc)
        raise AuthenticationError(f"Could not complete LinkedIn authentication: {exc}") from exc

    email = userinfo.get("email")
    if not email:
        raise ValidationError("LinkedIn profile did not provide an email address.")
    # The address is about to be matched against existing accounts. Trusting an
    # unverified one would let anyone who types a victim's email into LinkedIn
    # sign in as that victim here.
    if userinfo.get("email_verified") not in (True, "true"):
        raise AuthenticationError(
            "LinkedIn has not verified this email address. Verify it on LinkedIn, then try again."
        )

    member_id = userinfo.get("sub") or f"li_{generate_token(8)}"
    full_name = userinfo.get("name") or userinfo.get("localizedFirstName", "")
    picture = userinfo.get("picture")

    user = find_by_email(session, email)
    if user is None:
        random_pw = generate_token(24)
        user = User(
            email=normalize_email(email),
            full_name=full_name or None,
            hashed_password=hash_password(random_pw),
            role=UserRole.USER,
            is_active=True,
            email_verified=True,
            email_verified_at=datetime.now(UTC),
            picture_url=picture,
            onboarding_step=2,
            status=UserStatus.ACTIVE,
        )
        session.add(user)
        session.flush()
        session.add(UserSettings(user_id=user.id))
        session.flush()
    else:
        if full_name and not user.full_name:
            user.full_name = full_name
        if picture and not user.picture_url:
            user.picture_url = picture
        if user.onboarding_step < 2:
            user.onboarding_step = 2
        session.flush()

    # Link platform account
    account = session.scalar(
        select(UserPlatformAccount).where(
            UserPlatformAccount.user_id == user.id,
            UserPlatformAccount.provider == PlatformProvider.LINKEDIN,
        )
    )
    if account is None:
        account = UserPlatformAccount(
            user_id=user.id,
            provider=PlatformProvider.LINKEDIN,
            status=PlatformAccountStatus.PENDING,
            platform_member_id=member_id,
        )
        session.add(account)
        session.flush()

    return user



def get_onboarding_status(session: Session, user: User) -> dict:
    """Inspect current user onboarding stage, linked account, and extension status"""
    account = session.scalar(
        select(UserPlatformAccount).where(
            UserPlatformAccount.user_id == user.id,
            UserPlatformAccount.provider == PlatformProvider.LINKEDIN,
        )
    )

    now = datetime.now(UTC)
    extension_online = False
    connection_status = "NOT_CONNECTED"

    if account is not None:
        if account.status == PlatformAccountStatus.CONNECTED:
            # Extension is considered online if seen in the last 90 seconds
            last_seen = account.extension_last_seen
            if last_seen and last_seen.tzinfo is None:
                last_seen = last_seen.replace(tzinfo=UTC)
            if last_seen and (now - last_seen) < timedelta(seconds=90):
                extension_online = True
                connection_status = "CONNECTED"
            else:
                connection_status = "EXTENSION_OFFLINE"
        elif account.status == PlatformAccountStatus.WARNING:
            connection_status = "WARNING"
        elif account.status in (PlatformAccountStatus.ERROR, PlatformAccountStatus.EXPIRED):
            connection_status = "SESSION_EXPIRED"
        else:
            connection_status = account.status.value

    # Approval mode display
    settings_row = ensure_settings(session, user)
    mode = "all"
    if (
        settings_row.comment_approval == ApprovalMode.AUTOMATIC
        and settings_row.connection_approval == ApprovalMode.AUTOMATIC
    ):
        mode = "posts" if settings_row.candidate_approval == ApprovalMode.REQUIRED else "automatic"

    return {
        "step": user.onboarding_step,
        "completed": user.onboarding_step >= 4,
        "account_connected": account is not None and account.status == PlatformAccountStatus.CONNECTED,
        "extension_online": extension_online,
        "connection_status": connection_status,
        "approval_mode": mode,
        "member_name": user.full_name,
        "member_email": user.email,
    }


def update_onboarding_status(
    session: Session,
    user: User,
    *,
    step: int,
    approval_mode: str | None = None,
) -> dict:
    """Save user onboarding progress and apply chosen approval mode"""
    user.onboarding_step = step

    if approval_mode:
        settings_row = ensure_settings(session, user)
        normalized_mode = approval_mode.lower()
        if normalized_mode == "all":
            settings_row.comment_approval = ApprovalMode.REQUIRED
            settings_row.connection_approval = ApprovalMode.REQUIRED
            settings_row.candidate_approval = ApprovalMode.REQUIRED
        elif normalized_mode == "posts":
            settings_row.comment_approval = ApprovalMode.AUTOMATIC
            settings_row.connection_approval = ApprovalMode.AUTOMATIC
            settings_row.candidate_approval = ApprovalMode.REQUIRED
        elif normalized_mode == "automatic":
            settings_row.comment_approval = ApprovalMode.AUTOMATIC
            settings_row.connection_approval = ApprovalMode.AUTOMATIC
            settings_row.candidate_approval = ApprovalMode.AUTOMATIC

    session.flush()
    return get_onboarding_status(session, user)


def delete_user_workspace(session: Session, user: User) -> None:
    """Delete workspace and all associated user records with cascading cleanup"""
    # Delete related platform accounts
    session.query(UserPlatformAccount).filter(UserPlatformAccount.user_id == user.id).delete(synchronize_session=False)
    # Delete refresh tokens
    session.query(RefreshToken).filter(RefreshToken.user_id == user.id).delete(synchronize_session=False)
    # Delete settings
    session.query(UserSettings).filter(UserSettings.user_id == user.id).delete(synchronize_session=False)
    # Finally delete user
    session.delete(user)
    session.flush()
    logger.info("Deleted workspace and all data for user %s (%s)", user.id, user.email)

