"""Request and response models for authentication, profile and admin user management."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.config import settings
from app.enums import (
    ApprovalMode,
    CommentLength,
    CommentStyle,
    ConnectionMessageMode,
    UserRole,
    UserStatus,
)
from app.schemas.common import ORMModel


def _validate_password(value: str) -> str:
    """One rule, enforced in one place, so every endpoint reports it identically."""
    if len(value) < settings.min_password_length:
        raise ValueError(
            f"Password must be at least {settings.min_password_length} characters."
        )
    if value.strip() != value:
        raise ValueError("Password must not begin or end with whitespace.")
    return value


class PasswordField(BaseModel):
    password: str

    @field_validator("password")
    @classmethod
    def _check(cls, value: str) -> str:
        return _validate_password(value)


# ------------------------------------------------------------------- user --


class UserSettingsRead(ORMModel):
    default_dry_run: bool
    max_people_per_day: int
    max_likes_per_day: int
    max_comments_per_day: int
    max_connections_per_day: int
    max_people_per_run: int
    min_action_delay_seconds: int
    max_action_delay_seconds: int
    initial_posts_to_like: int
    evaluate_post_index: int
    minimum_relevance_score: int
    minimum_candidate_score: int
    generate_comment: bool
    connection_delay_hours: int
    comment_length: CommentLength
    comment_style: CommentStyle
    connection_message_mode: ConnectionMessageMode
    connection_message_template: str | None = None
    candidate_approval: ApprovalMode
    comment_approval: ApprovalMode
    connection_approval: ApprovalMode
    is_globally_paused: bool = False


class UserSettingsUpdate(BaseModel):
    """Every field optional: the settings page sends only what changed."""

    model_config = ConfigDict(extra="forbid")

    default_dry_run: bool | None = None
    is_globally_paused: bool | None = None
    max_people_per_day: int | None = Field(default=None, ge=1, le=200)
    max_likes_per_day: int | None = Field(default=None, ge=0, le=500)
    max_comments_per_day: int | None = Field(default=None, ge=0, le=200)
    max_connections_per_day: int | None = Field(default=None, ge=0, le=100)
    max_people_per_run: int | None = Field(default=None, ge=1, le=100)
    min_action_delay_seconds: int | None = Field(default=None, ge=0, le=86_400)
    max_action_delay_seconds: int | None = Field(default=None, ge=0, le=86_400)
    initial_posts_to_like: int | None = Field(default=None, ge=0, le=10)
    evaluate_post_index: int | None = Field(default=None, ge=1, le=20)
    minimum_relevance_score: int | None = Field(default=None, ge=0, le=100)
    minimum_candidate_score: int | None = Field(default=None, ge=0, le=100)
    generate_comment: bool | None = None
    connection_delay_hours: int | None = Field(default=None, ge=0, le=720)
    comment_length: CommentLength | None = None
    comment_style: CommentStyle | None = None
    connection_message_mode: ConnectionMessageMode | None = None
    connection_message_template: str | None = Field(default=None, max_length=2000)
    candidate_approval: ApprovalMode | None = None
    comment_approval: ApprovalMode | None = None
    connection_approval: ApprovalMode | None = None


class UserRead(ORMModel):
    id: int
    email: EmailStr
    full_name: str | None = None
    role: UserRole
    status: UserStatus
    is_active: bool
    email_verified: bool
    job_title: str | None = None
    company: str | None = None
    linkedin_url: str | None = None
    picture_url: str | None = None
    onboarding_step: int = 1
    timezone: str = "UTC"
    bio: str | None = None
    plan_id: str | None = None
    billing_cycle: str | None = None
    last_login_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class UserProfile(UserRead):
    """``/auth/me``: the account plus its settings, so the shell needs one call."""

    settings: UserSettingsRead | None = None


class ProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    full_name: str | None = Field(default=None, max_length=200)
    job_title: str | None = Field(default=None, max_length=200)
    company: str | None = Field(default=None, max_length=200)
    linkedin_url: str | None = Field(default=None, max_length=500)
    timezone: str | None = Field(default=None, max_length=64)
    bio: str | None = Field(default=None, max_length=2000)


class PasswordChange(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def _check(cls, value: str) -> str:
        return _validate_password(value)


# ------------------------------------------------------------------ auth ---


class SecurityConfigResponse(BaseModel):
    turnstile_site_key: str


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str | None = Field(default=None, max_length=200)
    plan_id: str | None = Field(default=None, max_length=64)
    billing_cycle: str | None = Field(default=None, max_length=20)
    turnstile_token: str | None = Field(default=None, description="Cloudflare Turnstile challenge token")

    @field_validator("password")
    @classmethod
    def _check(cls, value: str) -> str:
        return _validate_password(value)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    turnstile_token: str | None = Field(default=None, description="Cloudflare Turnstile challenge token")


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_at: datetime
    user: UserProfile


class RefreshRequest(BaseModel):
    refresh_token: str


class AccessToken(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_at: datetime


class RegisterResponse(BaseModel):
    """Registration returns tokens only when the account can log in at once.

    With ``REQUIRE_EMAIL_VERIFICATION`` on, ``tokens`` is null and the caller
    must confirm the emailed token first.
    """

    user: UserProfile
    tokens: TokenPair | None = None
    verification_required: bool = False
    #: Only populated outside production, where no mail is actually sent.
    verification_token: str | None = None


class VerifyEmailRequest(BaseModel):
    token: str = Field(min_length=8, max_length=200)


class ResendVerificationRequest(BaseModel):
    email: EmailStr


class AuthConfig(BaseModel):
    """What the sign-in screen needs to know before anyone has signed in."""

    allow_registration: bool
    require_email_verification: bool
    min_password_length: int


# ----------------------------------------------------------------- admin ---


class AdminUserRead(UserRead):
    """A user row with the activity totals the admin list sorts and filters on."""

    campaign_count: int = 0
    active_campaign_count: int = 0
    candidate_count: int = 0
    deactivated_at: datetime | None = None
    deactivated_reason: str | None = None


class AdminUserCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: str | None = Field(default=None, max_length=200)
    role: UserRole = UserRole.USER
    is_active: bool = True
    #: Admin-created accounts skip verification by default; the admin vouched.
    email_verified: bool = True

    @field_validator("password")
    @classmethod
    def _check(cls, value: str) -> str:
        return _validate_password(value)


class AdminUserUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    full_name: str | None = Field(default=None, max_length=200)
    role: UserRole | None = None
    job_title: str | None = Field(default=None, max_length=200)
    company: str | None = Field(default=None, max_length=200)
    timezone: str | None = Field(default=None, max_length=64)
    email_verified: bool | None = None


class DeactivateRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class AdminPasswordReset(BaseModel):
    new_password: str

    @field_validator("new_password")
    @classmethod
    def _check(cls, value: str) -> str:
        return _validate_password(value)


class AdminStats(BaseModel):
    total_users: int
    active_users: int
    deactivated_users: int
    pending_verification: int
    admins: int
    new_users_last_7_days: int
    total_campaigns: int
    running_campaigns: int


# -- LinkedIn OAuth & Onboarding (FR-1.1, FR-1.2, FR-1.3) ---------------------


class LinkedInOAuthAuthorizeResponse(BaseModel):
    authorize_url: str
    state: str


class LinkedInOAuthCallbackRequest(BaseModel):
    code: str
    state: str | None = None
    redirect_uri: str | None = None


class OnboardingStatus(BaseModel):
    step: int
    completed: bool = False
    account_connected: bool
    extension_online: bool
    connection_status: str
    approval_mode: str
    member_name: str | None = None
    member_email: str | None = None


class OnboardingUpdateRequest(BaseModel):
    step: int = Field(ge=1, le=5)
    approval_mode: str | None = None

