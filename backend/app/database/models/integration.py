from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.database import Base
from app.database.types import TimestampMixin, enum_column
from app.enums import PlatformAccountStatus, PlatformProvider

if TYPE_CHECKING:
    from app.database.models.user import User


class UserPlatformAccount(TimestampMixin, Base):
    """One third-party identity a user has linked, via Unipile's hosted wizard.

    No credential of the member's is stored here, and none ever reaches this
    application: the member signs in on Unipile's own hosted page, and all we
    receive back is an opaque ``account_id`` to quote on later API calls. That
    id is only usable together with our server-side Unipile API key, which
    lives in the environment and never leaves it.
    """

    __tablename__ = "user_platform_accounts"
    __table_args__ = (
        # One linked identity per provider per user. Reconnecting updates this
        # row rather than accumulating dead ones.
        UniqueConstraint("user_id", "provider", name="user_platform_account"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    provider: Mapped[PlatformProvider] = mapped_column(
        enum_column(PlatformProvider), nullable=False, index=True
    )

    status: Mapped[PlatformAccountStatus] = mapped_column(
        enum_column(PlatformAccountStatus),
        default=PlatformAccountStatus.PENDING,
        nullable=False,
        index=True,
    )

    #: Unipile's account id. Null until the member finishes the wizard.
    account_id: Mapped[str | None] = mapped_column(String(128), index=True)

    #: SHA-256 of the one-time token handed to Unipile as the hosted-auth
    #: ``name``. Unipile echoes the raw value back on its callback, so matching
    #: the digest is both how the callback is routed to a user and how it is
    #: authenticated — a forged callback would have to guess 32 random bytes.
    link_token: Mapped[str | None] = mapped_column(String(64), index=True)
    link_requested_at: Mapped[datetime | None] = mapped_column()
    link_expires_at: Mapped[datetime | None] = mapped_column()

    connected_at: Mapped[datetime | None] = mapped_column()
    disconnected_at: Mapped[datetime | None] = mapped_column()

    #: What Unipile last reported, shown to the user so a dropped session is
    #: explained rather than appearing as a silent failure mid-campaign.
    last_error: Mapped[str | None] = mapped_column(Text)
    last_checked_at: Mapped[datetime | None] = mapped_column()

    # -- extension pairing & heartbeat (FR-1.4, FR-1.5, FR-1.6) -------------
    extension_last_seen: Mapped[datetime | None] = mapped_column()
    extension_version: Mapped[str | None] = mapped_column(String(32))
    platform_member_id: Mapped[str | None] = mapped_column(String(128), index=True)
    account_tier: Mapped[str] = mapped_column(String(32), default="FREE", nullable=False)

    user: Mapped[User] = relationship(back_populates="platform_accounts")

    @property
    def is_usable(self) -> bool:
        return self.status is PlatformAccountStatus.CONNECTED and bool(self.account_id)
