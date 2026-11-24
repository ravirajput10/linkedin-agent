from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.database import Base
from app.database.types import TimestampMixin, enum_column
from app.enums import (
    ApprovalMode,
    CommentLength,
    CommentStyle,
    ConnectionMessageMode,
    UserRole,
    UserStatus,
)

if TYPE_CHECKING:
    from app.database.models.plan import Plan
    from app.database.models.subscription import Subscription


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    full_name: Mapped[str | None] = mapped_column(String(200))
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)

    role: Mapped[UserRole] = mapped_column(
        enum_column(UserRole), default=UserRole.USER, nullable=False, index=True
    )
    status: Mapped[UserStatus] = mapped_column(
        enum_column(UserStatus), default=UserStatus.ACTIVE, nullable=False, index=True
    )

    #: Kept alongside ``status`` because every request-gating query reads this one
    #: column. ``user_service.set_active`` is the only place the two may change.
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # -- email verification (dormant until REQUIRE_EMAIL_VERIFICATION is on) ---
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    email_verified_at: Mapped[datetime | None] = mapped_column()
    #: SHA-256 digest, never the token itself.
    verification_token: Mapped[str | None] = mapped_column(String(64), index=True)
    verification_sent_at: Mapped[datetime | None] = mapped_column()
    verification_expires_at: Mapped[datetime | None] = mapped_column()

    # -- profile --------------------------------------------------------------
    job_title: Mapped[str | None] = mapped_column(String(200))
    company: Mapped[str | None] = mapped_column(String(200))
    linkedin_url: Mapped[str | None] = mapped_column(String(500))
    picture_url: Mapped[str | None] = mapped_column(String(500))
    onboarding_step: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), default="UTC", nullable=False)
    bio: Mapped[str | None] = mapped_column(Text)

    # -- audit ----------------------------------------------------------------
    last_login_at: Mapped[datetime | None] = mapped_column()
    #: Wrong passwords since the last successful sign-in or lockout.
    failed_login_attempts: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    #: Sign-in is refused until this moment, even with the right password.
    locked_until: Mapped[datetime | None] = mapped_column()
    deactivated_at: Mapped[datetime | None] = mapped_column()
    deactivated_reason: Mapped[str | None] = mapped_column(Text)
    #: The admin who last deactivated this account. SET NULL so removing an admin
    #: never cascades into the users they administered.
    deactivated_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )

    # -- subscription & plan --------------------------------------------------
    plan_id: Mapped[str | None] = mapped_column(
        ForeignKey("plans.id", ondelete="SET NULL"), nullable=True, index=True
    )
    billing_cycle: Mapped[str | None] = mapped_column(String(20), nullable=True)

    plan: Mapped[Plan | None] = relationship(back_populates="users")

    settings: Mapped[UserSettings | None] = relationship(
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
        foreign_keys="UserSettings.user_id",
    )
    refresh_tokens: Mapped[list[RefreshToken]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    platform_accounts: Mapped[list[UserPlatformAccount]] = relationship(  # noqa: F821
        back_populates="user", cascade="all, delete-orphan"
    )
    subscription: Mapped[Subscription | None] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )

    @property
    def is_admin(self) -> bool:
        return self.role is UserRole.ADMIN

    @property
    def can_log_in(self) -> bool:
        """Verification is checked separately so the refusal can name its reason."""
        return self.is_active and self.status is not UserStatus.DEACTIVATED


class UserSettings(TimestampMixin, Base):
    """Per-user defaults applied to every campaign the user creates.

    These are starting values, not live overrides: ``create_campaign`` copies
    them into the campaign's own ``campaign_criteria`` row, so editing them
    later never silently changes a campaign that is already running.
    """

    __tablename__ = "user_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False, index=True
    )

    # -- safety ---------------------------------------------------------------
    #: A user may force dry run on, but cannot turn it off while the server-wide
    #: DRY_RUN is set. Enforced by ``user_service.effective_dry_run``.
    default_dry_run: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_globally_paused: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="false"
    )

    # -- rate limits ----------------------------------------------------------
    max_people_per_day: Mapped[int] = mapped_column(Integer, default=20, nullable=False)
    max_likes_per_day: Mapped[int] = mapped_column(Integer, default=60, nullable=False)
    max_comments_per_day: Mapped[int] = mapped_column(Integer, default=15, nullable=False)
    max_connections_per_day: Mapped[int] = mapped_column(Integer, default=15, nullable=False)
    max_people_per_run: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    min_action_delay_seconds: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    max_action_delay_seconds: Mapped[int] = mapped_column(Integer, default=180, nullable=False)

    # -- engagement defaults --------------------------------------------------
    initial_posts_to_like: Mapped[int] = mapped_column(Integer, default=2, nullable=False)
    evaluate_post_index: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    minimum_relevance_score: Mapped[int] = mapped_column(Integer, default=75, nullable=False)
    minimum_candidate_score: Mapped[int] = mapped_column(Integer, default=70, nullable=False)
    generate_comment: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    connection_delay_hours: Mapped[int] = mapped_column(Integer, default=48, nullable=False)

    # -- tone -----------------------------------------------------------------
    comment_length: Mapped[CommentLength] = mapped_column(
        enum_column(CommentLength), default=CommentLength.SHORT, nullable=False
    )
    comment_style: Mapped[CommentStyle] = mapped_column(
        enum_column(CommentStyle), default=CommentStyle.PROFESSIONAL, nullable=False
    )
    connection_message_mode: Mapped[ConnectionMessageMode] = mapped_column(
        enum_column(ConnectionMessageMode),
        default=ConnectionMessageMode.AI_GENERATED,
        nullable=False,
    )
    connection_message_template: Mapped[str | None] = mapped_column(Text)

    # -- approval gates -------------------------------------------------------
    candidate_approval: Mapped[ApprovalMode] = mapped_column(
        enum_column(ApprovalMode), default=ApprovalMode.AUTOMATIC, nullable=False
    )
    comment_approval: Mapped[ApprovalMode] = mapped_column(
        enum_column(ApprovalMode), default=ApprovalMode.REQUIRED, nullable=False
    )
    connection_approval: Mapped[ApprovalMode] = mapped_column(
        enum_column(ApprovalMode), default=ApprovalMode.REQUIRED, nullable=False
    )

    user: Mapped[User] = relationship(back_populates="settings", foreign_keys=[user_id])


class RefreshToken(TimestampMixin, Base):
    """One issued refresh token, stored as a digest so the table is not a key ring."""

    __tablename__ = "refresh_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    #: The JWT ``jti``. Unique, so a replayed token cannot create a second row.
    jti: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)

    expires_at: Mapped[datetime] = mapped_column(nullable=False, index=True)
    revoked_at: Mapped[datetime | None] = mapped_column()
    #: logout | rotated | deactivated | password_changed | admin
    revoked_reason: Mapped[str | None] = mapped_column(String(50))

    user_agent: Mapped[str | None] = mapped_column(String(300))
    ip_address: Mapped[str | None] = mapped_column(String(64))

    user: Mapped[User] = relationship(back_populates="refresh_tokens")
