"""Sign-up, sign-in, session refresh, profile and per-user settings."""

from __future__ import annotations

from fastapi import APIRouter, Request, status

from app.api.deps import (
    CurrentUser,
    DbSession,
    client_fingerprint,
    verify_turnstile_challenge,
)
from app.config import settings as app_settings
from app.database.models import User
from app.logging import get_logger
from app.schemas.auth import (
    AccessToken,
    AuthConfig,
    LinkedInOAuthAuthorizeResponse,
    LinkedInOAuthCallbackRequest,
    LoginRequest,
    OnboardingStatus,
    OnboardingUpdateRequest,
    PasswordChange,
    ProfileUpdate,
    RefreshRequest,
    RegisterRequest,
    RegisterResponse,
    ResendVerificationRequest,
    SecurityConfigResponse,
    TokenPair,
    UserProfile,
    UserSettingsRead,
    UserSettingsUpdate,
    VerifyEmailRequest,
)
from app.schemas.common import MessageResponse
from app.services import auth_service

logger = get_logger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])


def _profile(session, user: User) -> UserProfile:
    auth_service.ensure_settings(session, user)
    return UserProfile.model_validate(user)


def _token_pair(session, user: User, access: str, refresh: str, expires_at) -> TokenPair:
    return TokenPair(
        access_token=access,
        refresh_token=refresh,
        expires_at=expires_at,
        user=_profile(session, user),
    )


@router.get("/config", response_model=AuthConfig)
def auth_config() -> AuthConfig:
    """Public. Lets the sign-in screen hide registration when it is disabled."""
    return AuthConfig(
        allow_registration=app_settings.allow_registration,
        require_email_verification=app_settings.require_email_verification,
        min_password_length=app_settings.min_password_length,
    )


@router.get("/linkedin/authorize", response_model=LinkedInOAuthAuthorizeResponse)
def linkedin_authorize() -> LinkedInOAuthAuthorizeResponse:
    """Generate the LinkedIn OAuth 2.0 authorization URL (FR-1.1)."""
    url, state = auth_service.get_linkedin_oauth_url()
    return LinkedInOAuthAuthorizeResponse(authorize_url=url, state=state)


@router.post("/linkedin/callback", response_model=TokenPair)
async def linkedin_callback(
    session: DbSession, payload: LinkedInOAuthCallbackRequest, request: Request
) -> TokenPair:
    """Exchange OAuth code and issue session tokens (FR-1.1, FR-1.2)."""
    user = await auth_service.login_or_register_linkedin(
        session, payload.code, state=payload.state, redirect_uri=payload.redirect_uri
    )
    user_agent, ip = client_fingerprint(request)
    access, refresh, expires_at = auth_service.issue_tokens(
        session, user, user_agent=user_agent, ip_address=ip
    )
    tokens = _token_pair(session, user, access, refresh, expires_at)
    session.commit()
    return tokens


@router.get("/security-config", response_model=SecurityConfigResponse)
def get_security_config() -> SecurityConfigResponse:
    """Public endpoint delivering active Cloudflare Turnstile site key (US-CF.1)."""
    return SecurityConfigResponse(
        turnstile_site_key=app_settings.cloudflare_turnstile_site_key,
    )


@router.post("/register", response_model=RegisterResponse, status_code=status.HTTP_201_CREATED)
async def register(session: DbSession, payload: RegisterRequest, request: Request) -> RegisterResponse:
    await verify_turnstile_challenge(request, payload.turnstile_token)

    user, raw_token = auth_service.register(session, payload)

    if app_settings.require_email_verification:
        session.commit()
        logger.info("Registered %s; awaiting email verification", user.email)
        return RegisterResponse(
            user=_profile(session, user),
            tokens=None,
            verification_required=True,
            # No mail is sent yet, so outside production the token is returned
            # directly; otherwise there would be no way to finish signing up.
            verification_token=None if app_settings.is_production else raw_token,
        )

    user_agent, ip = client_fingerprint(request)
    access, refresh, expires_at = auth_service.issue_tokens(
        session, user, user_agent=user_agent, ip_address=ip
    )
    tokens = _token_pair(session, user, access, refresh, expires_at)
    session.commit()
    return RegisterResponse(user=tokens.user, tokens=tokens, verification_required=False)


@router.post("/login", response_model=TokenPair)
async def login(session: DbSession, payload: LoginRequest, request: Request) -> TokenPair:
    await verify_turnstile_challenge(request, payload.turnstile_token)

    user_agent, ip = client_fingerprint(request)
    user, access, refresh, expires_at = auth_service.authenticate(
        session,
        email=payload.email,
        password=payload.password,
        user_agent=user_agent,
        ip_address=ip,
    )
    tokens = _token_pair(session, user, access, refresh, expires_at)
    session.commit()
    return tokens


@router.post("/refresh", response_model=AccessToken)
def refresh(session: DbSession, payload: RefreshRequest, request: Request) -> AccessToken:
    user_agent, ip = client_fingerprint(request)
    _, access, new_refresh, expires_at = auth_service.refresh_session(
        session, payload.refresh_token, user_agent=user_agent, ip_address=ip
    )
    session.commit()
    return AccessToken(
        access_token=access, refresh_token=new_refresh, expires_at=expires_at
    )


@router.post("/logout", response_model=MessageResponse)
def logout(
    session: DbSession,
    current_user: CurrentUser,
    payload: RefreshRequest | None = None,
) -> MessageResponse:
    """Revoke the presented session, or every session when none is given."""
    auth_service.logout(session, payload.refresh_token if payload else None, current_user.id)
    session.commit()
    return MessageResponse(message="Signed out.")


@router.post("/logout-all", response_model=MessageResponse)
def logout_everywhere(session: DbSession, current_user: CurrentUser) -> MessageResponse:
    revoked = auth_service.revoke_all_tokens(session, current_user.id, "logout")
    session.commit()
    return MessageResponse(
        message="Signed out everywhere.", detail=f"{revoked} session(s) ended."
    )


# --------------------------------------------------------- email verification


@router.post("/verify-email", response_model=MessageResponse)
def verify_email(session: DbSession, payload: VerifyEmailRequest) -> MessageResponse:
    user = auth_service.verify_email(session, payload.token)
    session.commit()
    return MessageResponse(message=f"{user.email} is verified. You can sign in now.")


@router.post("/resend-verification", response_model=MessageResponse)
def resend_verification(
    session: DbSession, payload: ResendVerificationRequest
) -> MessageResponse:
    token = auth_service.resend_verification(session, payload.email)
    session.commit()
    # Always the same answer: a different one would reveal which addresses have
    # accounts.
    return MessageResponse(
        message="If that address has an unverified account, a new link is on its way.",
        detail=None if app_settings.is_production else token,
    )


# ------------------------------------------------------------------ me ------


@router.get("/me", response_model=UserProfile)
def read_me(session: DbSession, current_user: CurrentUser) -> UserProfile:
    profile = _profile(session, current_user)
    session.commit()
    return profile


@router.put("/me", response_model=UserProfile)
def update_me(
    session: DbSession, current_user: CurrentUser, payload: ProfileUpdate
) -> UserProfile:
    user = auth_service.update_profile(session, current_user, payload)
    profile = _profile(session, user)
    session.commit()
    return profile


@router.put("/me/password", response_model=MessageResponse)
def change_my_password(
    session: DbSession, current_user: CurrentUser, payload: PasswordChange
) -> MessageResponse:
    revoked = auth_service.change_password(session, current_user, payload)
    session.commit()
    return MessageResponse(
        message="Password updated.",
        detail=f"{revoked} other session(s) were signed out. Sign in again.",
    )


@router.get("/me/settings", response_model=UserSettingsRead)
def read_my_settings(session: DbSession, current_user: CurrentUser) -> UserSettingsRead:
    user_settings = auth_service.ensure_settings(session, current_user)
    result = UserSettingsRead.model_validate(user_settings)
    session.commit()
    return result


@router.put("/me/settings", response_model=UserSettingsRead)
def update_my_settings(
    session: DbSession, current_user: CurrentUser, payload: UserSettingsUpdate
) -> UserSettingsRead:
    user_settings = auth_service.update_settings(session, current_user, payload)
    result = UserSettingsRead.model_validate(user_settings)
    session.commit()
    return result


# -- onboarding & workspace --


@router.get("/me/onboarding", response_model=OnboardingStatus)
def get_my_onboarding(session: DbSession, current_user: CurrentUser) -> OnboardingStatus:
    """Get current onboarding stage and connection status (FR-1.3)."""
    status_data = auth_service.get_onboarding_status(session, current_user)
    session.commit()
    return OnboardingStatus(**status_data)


@router.put("/me/onboarding", response_model=OnboardingStatus)
def update_my_onboarding(
    session: DbSession, current_user: CurrentUser, payload: OnboardingUpdateRequest
) -> OnboardingStatus:
    """Update onboarding progress and approval mode (FR-1.3, FR-6.1)."""
    status_data = auth_service.update_onboarding_status(
        session, current_user, step=payload.step, approval_mode=payload.approval_mode
    )
    session.commit()
    return OnboardingStatus(**status_data)


@router.delete("/me/workspace", response_model=MessageResponse)
def delete_my_workspace(session: DbSession, current_user: CurrentUser) -> MessageResponse:
    """Delete workspace and all associated user data permanently (FR-1.10)."""
    auth_service.delete_user_workspace(session, current_user)
    session.commit()
    return MessageResponse(message="Workspace and all associated data have been permanently deleted.")

