"""Linking a user's LinkedIn account through Unipile's hosted auth wizard."""

from __future__ import annotations

from collections.abc import Iterator

import httpx
import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.database.models import UserPlatformAccount
from app.enums import PlatformAccountStatus
from app.main import app
from app.security import hash_token
from app.services import integration_service

pytestmark = pytest.mark.integration

PASSWORD = "test-password-123"
WEBHOOK_SECRET = "test-webhook-secret"


@pytest.fixture
def anon(db: Session, llm, platform) -> Iterator[TestClient]:
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def configured(monkeypatch) -> None:
    """Pretend the server has its Unipile linking configuration filled in."""
    monkeypatch.setattr(settings, "unipile_dsn", "api39.unipile.com:16977")
    monkeypatch.setattr(settings, "unipile_api_key", "test-unipile-key")
    monkeypatch.setattr(settings, "public_api_base_url", "https://api.example.com")
    monkeypatch.setattr(settings, "unipile_webhook_secret", WEBHOOK_SECRET)
    monkeypatch.setattr(settings, "app_base_url", "http://localhost:5173")


@pytest.fixture
def unipile_stub(monkeypatch):
    """Capture what we send Unipile and answer with a hosted-auth URL."""
    sent: list[dict] = []

    class _Response:
        status_code = 200

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {"object": "HostedAuthURL", "url": "https://account.unipile.com/abc123"}

    class _Client:
        def __init__(self, *args, **kwargs) -> None:
            self.headers = kwargs.get("headers", {})

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc) -> None:
            return None

        async def post(self, path, json=None, **kwargs):
            sent.append({"path": path, "json": json, "headers": self.headers})
            return _Response()

        async def delete(self, path, **kwargs):
            sent.append({"path": path, "method": "DELETE"})
            return _Response()

    monkeypatch.setattr(httpx, "AsyncClient", _Client)
    return sent


def auth_header(client: TestClient, email: str) -> dict[str, str]:
    response = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


# ------------------------------------------------------------------ status --


def test_status_reports_not_connected_for_a_new_user(anon: TestClient, user) -> None:
    body = anon.get("/api/integrations/linkedin", headers=auth_header(anon, user.email)).json()
    assert body["connected"] is False
    assert body["status"] == "NOT_CONNECTED"
    assert body["provider"] == "LINKEDIN"


def test_connection_endpoints_require_a_session(anon: TestClient) -> None:
    for method, path in (
        ("get", "/api/integrations/linkedin"),
        ("post", "/api/integrations/linkedin/connect"),
        ("delete", "/api/integrations/linkedin"),
    ):
        assert getattr(anon, method)(path).status_code == 401


def test_connect_is_refused_without_unipile_credentials(
    anon: TestClient, user, monkeypatch
) -> None:
    monkeypatch.setattr(settings, "unipile_api_key", "")
    response = anon.post(
        "/api/integrations/linkedin/connect", headers=auth_header(anon, user.email)
    )
    assert response.status_code == 503
    assert "UNIPILE_API_KEY" in str(response.json()["details"]["missing"])


def test_a_missing_public_address_does_not_block_linking(
    anon: TestClient, user, monkeypatch
) -> None:
    """A public webhook address is an optimisation, not a requirement.

    Without one the connection is reconciled by reading it back from Unipile,
    so a laptop with no tunnel can still link an account.
    """
    monkeypatch.setattr(settings, "unipile_dsn", "api39.unipile.com:16977")
    monkeypatch.setattr(settings, "unipile_api_key", "test-unipile-key")
    monkeypatch.setattr(settings, "public_api_base_url", "")
    monkeypatch.setattr(settings, "unipile_webhook_secret", "")

    status = anon.get(
        "/api/integrations/linkedin", headers=auth_header(anon, user.email)
    ).json()
    assert status["linking_enabled"] is True


# ------------------------------------------------------------- hosted auth --


def test_connect_returns_a_hosted_auth_link_and_records_the_token(
    anon: TestClient, user, db: Session, configured, unipile_stub
) -> None:
    response = anon.post(
        "/api/integrations/linkedin/connect", headers=auth_header(anon, user.email)
    )
    assert response.status_code == 200, response.text
    assert response.json()["url"] == "https://account.unipile.com/abc123"

    assert len(unipile_stub) == 1
    sent = unipile_stub[0]
    assert sent["path"] == "/hosted/accounts/link"
    assert sent["headers"]["X-API-KEY"] == "test-unipile-key"

    payload = sent["json"]
    assert payload["type"] == "create"
    assert payload["providers"] == ["LINKEDIN"]
    assert payload["notify_url"].endswith(f"/integrations/unipile/webhook/{WEBHOOK_SECRET}")
    assert payload["success_redirect_url"].startswith("http://localhost:5173/profile")

    # The echoed `name` must be the random token, never the user's email or id:
    # it travels to a third party and comes back in a webhook.
    assert payload["name"] not in (user.email, str(user.id))
    assert len(payload["name"]) >= 32

    account = db.scalar(
        sa.select(UserPlatformAccount).where(UserPlatformAccount.user_id == user.id)
    )
    assert account is not None
    # Stored as a digest, not the raw token.
    assert account.link_token == hash_token(payload["name"])
    assert account.link_token != payload["name"]
    assert account.status == PlatformAccountStatus.PENDING.value


def test_the_callback_connects_the_account(
    anon: TestClient, user, db: Session, configured, unipile_stub
) -> None:
    headers = auth_header(anon, user.email)
    link = anon.post("/api/integrations/linkedin/connect", headers=headers)
    token = unipile_stub[0]["json"]["name"]

    callback = anon.post(
        f"/api/integrations/unipile/webhook/{WEBHOOK_SECRET}",
        json={"status": "CREATION_SUCCESS", "account_id": "acct_live_123", "name": token},
    )
    assert callback.status_code == 200
    assert link.status_code == 200

    status = anon.get("/api/integrations/linkedin", headers=headers).json()
    assert status["connected"] is True
    assert status["status"] == "CONNECTED"
    assert status["connected_at"]
    # The browser is never told the Unipile account id.
    assert "account_id" not in status

    assert integration_service.connected_account_id(db, user.id) == "acct_live_123"


def test_the_one_time_token_cannot_be_replayed(
    anon: TestClient, user, db: Session, configured, unipile_stub
) -> None:
    headers = auth_header(anon, user.email)
    anon.post("/api/integrations/linkedin/connect", headers=headers)
    token = unipile_stub[0]["json"]["name"]

    body = {"status": "CREATION_SUCCESS", "account_id": "acct_one", "name": token}
    assert anon.post(f"/api/integrations/unipile/webhook/{WEBHOOK_SECRET}", json=body).status_code == 200

    # A second callback quoting the same token must not rebind the account.
    replay = dict(body, account_id="acct_attacker")
    assert anon.post(f"/api/integrations/unipile/webhook/{WEBHOOK_SECRET}", json=replay).status_code == 200
    assert integration_service.connected_account_id(db, user.id) == "acct_one"


def test_a_webhook_with_the_wrong_path_secret_is_a_404(
    anon: TestClient, user, configured, unipile_stub
) -> None:
    anon.post("/api/integrations/linkedin/connect", headers=auth_header(anon, user.email))
    token = unipile_stub[0]["json"]["name"]

    response = anon.post(
        "/api/integrations/unipile/webhook/not-the-secret",
        json={"status": "CREATION_SUCCESS", "account_id": "acct_x", "name": token},
    )
    assert response.status_code == 404


def test_an_unknown_token_changes_nothing(
    anon: TestClient, user, db: Session, configured
) -> None:
    response = anon.post(
        f"/api/integrations/unipile/webhook/{WEBHOOK_SECRET}",
        json={"status": "CREATION_SUCCESS", "account_id": "acct_forged", "name": "guessed"},
    )
    # 200 so Unipile does not retry, but nothing is bound.
    assert response.status_code == 200
    assert integration_service.connected_account_id(db, user.id) is None


def test_a_failed_connection_is_reported_to_the_user(
    anon: TestClient, user, configured, unipile_stub
) -> None:
    headers = auth_header(anon, user.email)
    anon.post("/api/integrations/linkedin/connect", headers=headers)
    token = unipile_stub[0]["json"]["name"]

    anon.post(
        f"/api/integrations/unipile/webhook/{WEBHOOK_SECRET}",
        json={"status": "CREATION_FAILED", "name": token},
    )
    status = anon.get("/api/integrations/linkedin", headers=headers).json()
    assert status["connected"] is False
    assert "CREATION_FAILED" in status["last_error"]


# -------------------------------------------------------------- isolation --


def test_one_users_connection_is_invisible_to_another(
    anon: TestClient, make_user, configured, unipile_stub
) -> None:
    alice = make_user("alice-int@example.com")
    bob = make_user("bob-int@example.com")

    alice_headers = auth_header(anon, alice.email)
    anon.post("/api/integrations/linkedin/connect", headers=alice_headers)
    token = unipile_stub[0]["json"]["name"]
    anon.post(
        f"/api/integrations/unipile/webhook/{WEBHOOK_SECRET}",
        json={"status": "CREATION_SUCCESS", "account_id": "acct_alice", "name": token},
    )

    assert anon.get("/api/integrations/linkedin", headers=alice_headers).json()["connected"] is True
    bob_status = anon.get(
        "/api/integrations/linkedin", headers=auth_header(anon, bob.email)
    ).json()
    assert bob_status["connected"] is False


def test_disconnect_clears_the_link(
    anon: TestClient, user, db: Session, configured, unipile_stub
) -> None:
    headers = auth_header(anon, user.email)
    anon.post("/api/integrations/linkedin/connect", headers=headers)
    token = unipile_stub[0]["json"]["name"]
    anon.post(
        f"/api/integrations/unipile/webhook/{WEBHOOK_SECRET}",
        json={"status": "CREATION_SUCCESS", "account_id": "acct_bye", "name": token},
    )

    response = anon.delete("/api/integrations/linkedin", headers=headers)
    assert response.status_code == 200
    assert response.json()["connected"] is False
    assert response.json()["status"] == "DISCONNECTED"
    assert integration_service.connected_account_id(db, user.id) is None
    # Unipile was asked to drop the account too.
    assert any(call.get("method") == "DELETE" for call in unipile_stub)


def test_a_dropped_session_is_surfaced_not_silent(
    anon: TestClient, user, configured, unipile_stub
) -> None:
    headers = auth_header(anon, user.email)
    anon.post("/api/integrations/linkedin/connect", headers=headers)
    token = unipile_stub[0]["json"]["name"]
    anon.post(
        f"/api/integrations/unipile/webhook/{WEBHOOK_SECRET}",
        json={"status": "CREATION_SUCCESS", "account_id": "acct_drop", "name": token},
    )

    # Unipile reports the session as logged out: account_id, no name.
    anon.post(
        f"/api/integrations/unipile/webhook/{WEBHOOK_SECRET}",
        json={"account_id": "acct_drop", "message": "Credentials expired"},
    )

    status = anon.get("/api/integrations/linkedin", headers=headers).json()
    assert status["connected"] is False
    assert status["status"] == "ERROR"
    assert "Credentials expired" in status["last_error"]


# ------------------------------------------------- reconcile without a webhook


@pytest.fixture
def no_webhook(monkeypatch) -> None:
    """A server with Unipile credentials but no public address — e.g. a laptop."""
    monkeypatch.setattr(settings, "unipile_dsn", "api39.unipile.com:16977")
    monkeypatch.setattr(settings, "unipile_api_key", "test-unipile-key")
    monkeypatch.setattr(settings, "public_api_base_url", "")
    monkeypatch.setattr(settings, "unipile_webhook_secret", "")
    monkeypatch.setattr(settings, "app_base_url", "http://localhost:5173")


@pytest.fixture
def unipile_reader(monkeypatch):
    """Stub POST (link) and GET (accounts) so reconcile can be exercised."""
    state: dict = {"sent": [], "accounts": [], "account": None, "get_status": 200}

    class _Response:
        def __init__(self, payload, status_code=200):
            self._payload = payload
            self.status_code = status_code
            self.text = ""

        def raise_for_status(self):
            if self.status_code >= 400:
                raise httpx.HTTPStatusError("boom", request=None, response=self)

        def json(self):
            return self._payload

    class _Client:
        def __init__(self, *args, **kwargs):
            self.headers = kwargs.get("headers", {})

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return None

        async def post(self, path, json=None, **kwargs):
            state["sent"].append({"path": path, "json": json})
            return _Response({"object": "HostedAuthURL", "url": "https://account.unipile.com/x"})

        async def get(self, path, **kwargs):
            if state["get_status"] >= 400:
                return _Response({}, state["get_status"])
            if path == "/accounts":
                return _Response({"items": state["accounts"]})
            return _Response(state["account"] or {})

        async def delete(self, path, **kwargs):
            return _Response({}, 200)

    monkeypatch.setattr(httpx, "AsyncClient", _Client)
    return state


def test_linking_works_without_a_public_webhook_address(
    anon: TestClient, user, db: Session, no_webhook, unipile_reader
) -> None:
    headers = auth_header(anon, user.email)

    response = anon.post("/api/integrations/linkedin/connect", headers=headers)
    assert response.status_code == 200, response.text

    # No notify_url is sent when the server has no public address.
    payload = unipile_reader["sent"][0]["json"]
    assert "notify_url" not in payload
    token = payload["name"]

    # The member finishes on Unipile; we learn about it by reading back.
    unipile_reader["accounts"] = [
        {"id": "acct_polled", "name": token, "sources": [{"id": "s1", "status": "OK"}]}
    ]
    refreshed = anon.post("/api/integrations/linkedin/refresh", headers=headers)
    assert refreshed.status_code == 200
    assert refreshed.json()["connected"] is True
    assert integration_service.connected_account_id(db, user.id) == "acct_polled"


def test_reconcile_ignores_an_account_belonging_to_someone_else(
    anon: TestClient, user, db: Session, no_webhook, unipile_reader
) -> None:
    headers = auth_header(anon, user.email)
    anon.post("/api/integrations/linkedin/connect", headers=headers)

    # An account exists at Unipile, but its name is not our token.
    unipile_reader["accounts"] = [{"id": "acct_other", "name": "someone-elses-token"}]
    refreshed = anon.post("/api/integrations/linkedin/refresh", headers=headers)

    assert refreshed.json()["connected"] is False
    assert integration_service.connected_account_id(db, user.id) is None


def test_reconcile_surfaces_an_unhealthy_source(
    anon: TestClient, user, no_webhook, unipile_reader
) -> None:
    headers = auth_header(anon, user.email)
    anon.post("/api/integrations/linkedin/connect", headers=headers)
    token = unipile_reader["sent"][0]["json"]["name"]

    unipile_reader["accounts"] = [
        {"id": "acct_sick", "name": token, "sources": [{"id": "s1", "status": "OK"}]}
    ]
    anon.post("/api/integrations/linkedin/refresh", headers=headers)

    # Later, LinkedIn logs the session out.
    unipile_reader["account"] = {
        "id": "acct_sick",
        "sources": [{"id": "s1", "status": "CREDENTIALS"}],
    }
    status = anon.post("/api/integrations/linkedin/refresh", headers=headers).json()

    assert status["connected"] is False
    assert status["status"] == "ERROR"
    assert "signed this session out" in status["last_error"]


def test_reconcile_recovers_when_the_session_comes_back(
    anon: TestClient, user, no_webhook, unipile_reader
) -> None:
    headers = auth_header(anon, user.email)
    anon.post("/api/integrations/linkedin/connect", headers=headers)
    token = unipile_reader["sent"][0]["json"]["name"]

    unipile_reader["accounts"] = [{"id": "acct_back", "name": token}]
    anon.post("/api/integrations/linkedin/refresh", headers=headers)

    unipile_reader["account"] = {"id": "acct_back", "sources": [{"id": "s1", "status": "CREDENTIALS"}]}
    assert anon.post("/api/integrations/linkedin/refresh", headers=headers).json()["status"] == "ERROR"

    unipile_reader["account"] = {"id": "acct_back", "sources": [{"id": "s1", "status": "OK"}]}
    healed = anon.post("/api/integrations/linkedin/refresh", headers=headers).json()
    assert healed["connected"] is True
    assert healed["last_error"] is None


def test_reconcile_drops_an_account_deleted_at_unipile(
    anon: TestClient, user, db: Session, no_webhook, unipile_reader
) -> None:
    headers = auth_header(anon, user.email)
    anon.post("/api/integrations/linkedin/connect", headers=headers)
    token = unipile_reader["sent"][0]["json"]["name"]
    unipile_reader["accounts"] = [{"id": "acct_gone", "name": token}]
    anon.post("/api/integrations/linkedin/refresh", headers=headers)

    unipile_reader["get_status"] = 404
    status = anon.post("/api/integrations/linkedin/refresh", headers=headers).json()

    assert status["connected"] is False
    assert status["status"] == "DISCONNECTED"
    assert integration_service.connected_account_id(db, user.id) is None
