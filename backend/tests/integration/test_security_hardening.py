"""Regression tests for the production security fixes: login lockout, LinkedIn
OAuth state and email verification, and owner scoping on reply events."""

from __future__ import annotations

from collections.abc import Iterator

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.main import app
from app.security import create_oauth_state
from app.services import auth_service

pytestmark = pytest.mark.integration

PASSWORD = "test-password-123"


@pytest.fixture
def anon(db: Session, llm, platform) -> Iterator[TestClient]:
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def sign_in(client: TestClient, email: str, password: str = PASSWORD):
    return client.post("/api/auth/login", json={"email": email, "password": password})


def auth_header(client: TestClient, email: str) -> dict[str, str]:
    response = sign_in(client, email)
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


# -------------------------------------------------------------- lockout --


@pytest.fixture
def three_strikes(monkeypatch) -> None:
    monkeypatch.setattr(settings, "login_max_failed_attempts", 3)


def test_repeated_wrong_passwords_lock_the_account(
    anon: TestClient, user, three_strikes
) -> None:
    for _ in range(3):
        assert sign_in(anon, user.email, "wrong-password").status_code == 401

    # Locked: even the right password is refused until the lock lapses.
    locked = sign_in(anon, user.email)
    assert locked.status_code == 429
    assert locked.json()["code"] == "RATE_LIMIT_REACHED"


def test_a_successful_sign_in_resets_the_failure_count(
    anon: TestClient, user, three_strikes
) -> None:
    for _ in range(2):
        sign_in(anon, user.email, "wrong-password")
    assert sign_in(anon, user.email).status_code == 200

    for _ in range(2):
        sign_in(anon, user.email, "wrong-password")
    assert sign_in(anon, user.email).status_code == 200


def test_an_admin_password_reset_lifts_the_lock(
    anon: TestClient, admin, user, three_strikes
) -> None:
    headers = auth_header(anon, admin.email)
    for _ in range(3):
        sign_in(anon, user.email, "wrong-password")
    assert sign_in(anon, user.email).status_code == 429

    anon.post(
        f"/api/admin/users/{user.id}/reset-password",
        json={"new_password": "reset-by-the-admin-1"},
        headers=headers,
    )
    assert sign_in(anon, user.email, "reset-by-the-admin-1").status_code == 200


# ------------------------------------------------------- LinkedIn OAuth --


@pytest.fixture
def linkedin(monkeypatch) -> dict:
    """Stands in for LinkedIn's token and userinfo endpoints."""
    monkeypatch.setattr(settings, "linkedin_client_id", "client-id")
    monkeypatch.setattr(settings, "linkedin_client_secret", "client-secret")
    userinfo: dict = {
        "sub": "li-member-1",
        "name": "Lin Kedin",
        "email": "linked@example.com",
        "email_verified": True,
    }

    class FakeClient:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self) -> FakeClient:
            return self

        async def __aexit__(self, *exc) -> bool:
            return False

        async def post(self, *args, **kwargs) -> httpx.Response:
            return httpx.Response(200, json={"access_token": "linkedin-token"})

        async def get(self, *args, **kwargs) -> httpx.Response:
            return httpx.Response(200, json=userinfo)

    monkeypatch.setattr(auth_service.httpx, "AsyncClient", FakeClient)
    return userinfo


def callback(client: TestClient, state: str | None):
    body = {"code": "auth-code", "redirect_uri": "http://localhost:5173/auth/callback"}
    if state is not None:
        body["state"] = state
    return client.post("/api/auth/linkedin/callback", json=body)


def test_authorize_issues_a_state_the_callback_accepts(anon: TestClient, linkedin) -> None:
    state = anon.get("/api/auth/linkedin/authorize").json()["state"]
    response = callback(anon, state)
    assert response.status_code == 200, response.text
    assert response.json()["access_token"]


@pytest.mark.parametrize("state", [None, "", "made-up-state", "a.b.c"])
def test_the_callback_refuses_a_missing_or_forged_state(
    anon: TestClient, linkedin, state
) -> None:
    assert callback(anon, state).status_code == 401


def test_the_callback_refuses_an_expired_state(
    anon: TestClient, linkedin, monkeypatch
) -> None:
    monkeypatch.setattr(settings, "oauth_state_expire_minutes", -1)
    assert callback(anon, create_oauth_state()).status_code == 401


def test_an_unverified_linkedin_email_cannot_claim_an_existing_account(
    anon: TestClient, linkedin, make_user
) -> None:
    make_user(linkedin["email"])
    linkedin["email_verified"] = False

    response = callback(anon, create_oauth_state())
    assert response.status_code == 401
    assert "not verified" in response.json()["message"]


# ------------------------------------------------------- reply events --


def test_reply_events_require_sign_in_and_ownership(anon: TestClient, make_user) -> None:
    owner = make_user("owner@example.com")
    stranger = make_user("stranger@example.com")
    owner_headers = auth_header(anon, owner.email)
    campaign = anon.post(
        "/api/campaigns",
        json={"name": "Hardening", "instruction": "Find people interested in security."},
        headers=owner_headers,
    ).json()
    path = f"/api/campaigns/{campaign['id']}/events/reply-received"
    body = {"person_id": 999_999}

    assert anon.post(path, json=body).status_code == 401

    # Someone else's campaign reads as missing, never as forbidden.
    foreign = anon.post(path, json=body, headers=auth_header(anon, stranger.email))
    assert foreign.status_code == 404
    assert "Campaign" in foreign.json()["message"]

    # The owner gets past the campaign check to the (absent) workflow.
    own = anon.post(path, json=body, headers=owner_headers)
    assert own.status_code == 404
    assert "Workflow" in own.json()["message"]
