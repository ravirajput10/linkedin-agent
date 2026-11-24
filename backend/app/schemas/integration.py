"""Request and response models for third-party account linking."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.enums import PlatformProvider


class ConnectAccountRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: True re-authorises an account LinkedIn signed out, keeping the same
    #: Unipile account id rather than creating a second one.
    reconnect: bool = False


class RefreshAccountRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    account_id: str | None = None


class HostedAuthLink(BaseModel):
    """Where to send the browser. Single-use and short-lived."""

    url: str
    expires_at: datetime | None = None


class PlatformAccountRead(BaseModel):
    """Connection state for the UI.

    Deliberately omits the Unipile ``account_id``: the browser has no use for
    it, and it is the one identifier that, paired with the server's API key,
    addresses the member's live LinkedIn session.
    """

    provider: PlatformProvider
    status: str
    connected: bool
    connected_at: datetime | None = None
    disconnected_at: datetime | None = None
    last_error: str | None = None
    #: False when the server lacks the Unipile configuration, so the UI can
    #: explain the disabled button instead of failing on click.
    linking_enabled: bool = True
