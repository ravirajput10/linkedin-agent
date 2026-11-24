"""Authentication, per-user isolation and admin user management."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.enums import UserRole
from app.main import app

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


def auth_header(client: TestClient, email: str, password: str = PASSWORD) -> dict[str, str]:
    response = sign_in(client, email, password)
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def make_campaign(client: TestClient, name: str, headers: dict[str, str]) -> dict:
    response = client.post(
        "/api/campaigns",
        json={"name": name, "instruction": f"Find people interested in {name}."},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


# --------------------------------------------------------------- the gate --


def test_protected_endpoints_reject_anonymous_callers(anon: TestClient) -> None:
    for method, path in (
        ("get", "/api/campaigns"),
        ("get", "/api/dashboard"),
        ("get", "/api/candidates"),
        ("get", "/api/approvals/counts"),
        ("get", "/api/settings"),
        ("get", "/api/admin/users"),
        ("get", "/api/auth/me"),
    ):
        response = getattr(anon, method)(path)
        assert response.status_code == 401, f"{method.upper()} {path} -> {response.status_code}"
        assert response.json()["code"] == "AUTHENTICATION_EXPIRED"


def test_health_and_auth_config_stay_public(anon: TestClient) -> None:
    assert anon.get("/health").status_code == 200
    body = anon.get("/api/auth/config").json()
    assert body["allow_registration"] is True
    assert body["min_password_length"] == settings.min_password_length


def test_a_garbage_token_is_rejected(anon: TestClient) -> None:
    response = anon.get("/api/campaigns", headers={"Authorization": "Bearer not-a-jwt"})
    assert response.status_code == 401


# ------------------------------------------------------------- the journey --


def test_register_then_login_then_use_the_agent(anon: TestClient) -> None:
    registration = anon.post(
        "/api/auth/register",
        json={"email": "newcomer@example.com", "password": PASSWORD, "full_name": "New Comer"},
    )
    assert registration.status_code == 201, registration.text
    body = registration.json()
    assert body["verification_required"] is False
    assert body["user"]["role"] == "USER"
    assert body["user"]["is_active"] is True
    assert body["tokens"]["access_token"]
    # Settings are created with the account, not on first visit to the page.
    assert body["user"]["settings"]["max_people_per_day"] == 20

    headers = {"Authorization": f"Bearer {body['tokens']['access_token']}"}
    assert anon.get("/api/campaigns", headers=headers).json()["total"] == 0

    me = anon.get("/api/auth/me", headers=headers).json()
    assert me["email"] == "newcomer@example.com"
    assert me["full_name"] == "New Comer"


def test_registering_a_duplicate_email_conflicts(anon: TestClient, user) -> None:
    response = anon.post(
        "/api/auth/register", json={"email": user.email, "password": PASSWORD}
    )
    assert response.status_code == 409
    assert response.json()["code"] == "CONFLICT"


def test_a_short_password_is_refused(anon: TestClient) -> None:
    response = anon.post(
        "/api/auth/register", json={"email": "short@example.com", "password": "abc"}
    )
    assert response.status_code == 422


def test_login_with_the_wrong_password_fails(anon: TestClient, user) -> None:
    assert sign_in(anon, user.email, "wrong-password").status_code == 401


def test_login_is_case_insensitive_on_the_address(anon: TestClient, user) -> None:
    assert sign_in(anon, user.email.upper()).status_code == 200


# ------------------------------------------------------------------ tokens --


def test_refresh_rotates_the_token_and_retires_the_old_one(anon: TestClient, user) -> None:
    tokens = sign_in(anon, user.email).json()
    first_refresh = tokens["refresh_token"]

    rotated = anon.post("/api/auth/refresh", json={"refresh_token": first_refresh})
    assert rotated.status_code == 200
    assert rotated.json()["refresh_token"] != first_refresh

    # Replaying the retired token is treated as a leak: every session dies.
    replay = anon.post("/api/auth/refresh", json={"refresh_token": first_refresh})
    assert replay.status_code == 401

    reused = anon.post(
        "/api/auth/refresh", json={"refresh_token": rotated.json()["refresh_token"]}
    )
    assert reused.status_code == 401, "reuse detection should have revoked every session"


def test_logout_revokes_only_the_presented_session(anon: TestClient, user) -> None:
    first = sign_in(anon, user.email).json()
    second = sign_in(anon, user.email).json()

    headers = {"Authorization": f"Bearer {first['access_token']}"}
    assert anon.post(
        "/api/auth/logout", json={"refresh_token": first["refresh_token"]}, headers=headers
    ).status_code == 200

    assert anon.post(
        "/api/auth/refresh", json={"refresh_token": first["refresh_token"]}
    ).status_code == 401
    assert anon.post(
        "/api/auth/refresh", json={"refresh_token": second["refresh_token"]}
    ).status_code == 200


def test_changing_the_password_ends_other_sessions(anon: TestClient, user) -> None:
    session = sign_in(anon, user.email).json()
    headers = {"Authorization": f"Bearer {session['access_token']}"}

    response = anon.put(
        "/api/auth/me/password",
        json={"current_password": PASSWORD, "new_password": "a-brand-new-password"},
        headers=headers,
    )
    assert response.status_code == 200

    assert anon.post(
        "/api/auth/refresh", json={"refresh_token": session["refresh_token"]}
    ).status_code == 401
    assert sign_in(anon, user.email, "a-brand-new-password").status_code == 200
    assert sign_in(anon, user.email, PASSWORD).status_code == 401


def test_the_wrong_current_password_is_refused(anon: TestClient, user) -> None:
    headers = auth_header(anon, user.email)
    response = anon.put(
        "/api/auth/me/password",
        json={"current_password": "nope", "new_password": "another-good-password"},
        headers=headers,
    )
    assert response.status_code == 401


# ----------------------------------------------------------------- profile --


def test_profile_and_settings_round_trip(anon: TestClient, user) -> None:
    headers = auth_header(anon, user.email)

    profile = anon.put(
        "/api/auth/me",
        json={"full_name": "Owner Person", "job_title": "CTO", "timezone": "Asia/Kolkata"},
        headers=headers,
    )
    assert profile.status_code == 200
    assert profile.json()["job_title"] == "CTO"
    assert profile.json()["timezone"] == "Asia/Kolkata"

    updated = anon.put(
        "/api/auth/me/settings",
        json={"max_likes_per_day": 12, "comment_style": "TECHNICAL"},
        headers=headers,
    )
    assert updated.status_code == 200
    assert updated.json()["max_likes_per_day"] == 12
    assert updated.json()["comment_style"] == "TECHNICAL"
    # Untouched fields keep their value rather than resetting to the default.
    assert updated.json()["max_comments_per_day"] == 15


def test_settings_reject_an_inverted_delay_window(anon: TestClient, user) -> None:
    headers = auth_header(anon, user.email)
    response = anon.put(
        "/api/auth/me/settings",
        json={"min_action_delay_seconds": 300, "max_action_delay_seconds": 60},
        headers=headers,
    )
    assert response.status_code == 422


def test_a_user_cannot_disable_dry_run_while_the_server_enforces_it(
    anon: TestClient, user
) -> None:
    assert settings.dry_run, "this test assumes the test env keeps DRY_RUN on"
    headers = auth_header(anon, user.email)
    response = anon.put(
        "/api/auth/me/settings", json={"default_dry_run": False}, headers=headers
    )
    assert response.status_code == 422


def test_new_campaigns_inherit_the_account_defaults(anon: TestClient, user) -> None:
    headers = auth_header(anon, user.email)
    anon.put(
        "/api/auth/me/settings",
        json={"max_likes_per_day": 7, "comment_style": "CONVERSATIONAL"},
        headers=headers,
    )

    campaign = make_campaign(anon, "Inherited", headers)
    detail = anon.get(f"/api/campaigns/{campaign['id']}", headers=headers).json()
    assert detail["criteria"]["max_likes_per_day"] == 7
    assert detail["criteria"]["comment_style"] == "CONVERSATIONAL"


# --------------------------------------------------------------- isolation --


def test_one_user_never_sees_another_users_campaigns(
    anon: TestClient, make_user
) -> None:
    alice = make_user("alice@example.com")
    bob = make_user("bob@example.com")

    alice_headers = auth_header(anon, alice.email)
    bob_headers = auth_header(anon, bob.email)

    alice_campaign = make_campaign(anon, "Alice Campaign", alice_headers)
    make_campaign(anon, "Bob Campaign", bob_headers)

    alice_list = anon.get("/api/campaigns", headers=alice_headers).json()
    assert alice_list["total"] == 1
    assert alice_list["items"][0]["name"] == "Alice Campaign"

    bob_list = anon.get("/api/campaigns", headers=bob_headers).json()
    assert bob_list["total"] == 1
    assert bob_list["items"][0]["name"] == "Bob Campaign"

    # Reading someone else's campaign by id reads as missing, not forbidden:
    # a 403 would confirm the id exists.
    stolen = anon.get(f"/api/campaigns/{alice_campaign['id']}", headers=bob_headers)
    assert stolen.status_code == 404

    for method, suffix in (
        ("put", ""),
        ("delete", ""),
        ("post", "/start"),
        ("post", "/pause"),
        ("post", "/stop"),
        ("post", "/run"),
    ):
        path = f"/api/campaigns/{alice_campaign['id']}{suffix}"
        kwargs = {"json": {"name": "hijacked"}} if method == "put" else {}
        response = getattr(anon, method)(path, headers=bob_headers, **kwargs)
        assert response.status_code == 404, f"{method.upper()} {path}"


def test_derived_pages_are_scoped_too(anon: TestClient, make_user) -> None:
    alice = make_user("alice2@example.com")
    bob = make_user("bob2@example.com")
    alice_headers = auth_header(anon, alice.email)
    bob_headers = auth_header(anon, bob.email)

    campaign = make_campaign(anon, "Alice Only", alice_headers)
    anon.post(f"/api/campaigns/{campaign['id']}/start", headers=alice_headers)

    # Alice's campaign creation emitted activity; Bob must not see any of it.
    assert anon.get("/api/activity", headers=alice_headers).json()["total"] > 0
    assert anon.get("/api/activity", headers=bob_headers).json()["total"] == 0

    for path in ("/api/candidates", "/api/posts", "/api/approvals", "/api/scheduled-actions"):
        assert anon.get(path, headers=bob_headers).json()["total"] == 0

    assert (
        anon.get(f"/api/campaigns/{campaign['id']}/candidates", headers=bob_headers).status_code
        == 404
    )
    assert anon.get("/api/dashboard", headers=bob_headers).json()["counters"][
        "active_campaigns"
    ] == 0
    assert anon.get("/api/dashboard", headers=alice_headers).json()["counters"][
        "active_campaigns"
    ] == 1


def test_an_admin_sees_only_their_own_campaigns_on_the_agent_pages(
    anon: TestClient, admin, user
) -> None:
    """Cross-user visibility lives under /api/admin, not on the agent pages."""
    user_headers = auth_header(anon, user.email)
    admin_headers = auth_header(anon, admin.email)

    make_campaign(anon, "A User Campaign", user_headers)

    assert anon.get("/api/campaigns", headers=admin_headers).json()["total"] == 0
    assert anon.get("/api/campaigns", headers=user_headers).json()["total"] == 1


# ------------------------------------------------------------------- admin --


def test_admin_endpoints_refuse_ordinary_users(anon: TestClient, user) -> None:
    headers = auth_header(anon, user.email)
    for method, path in (
        ("get", "/api/admin/users"),
        ("get", "/api/admin/stats"),
        ("post", "/api/admin/users/1/deactivate"),
        ("delete", "/api/admin/users/1"),
    ):
        response = getattr(anon, method)(path, headers=headers)
        assert response.status_code == 403, f"{method.upper()} {path}"


def test_admin_lists_users_with_their_activity(anon: TestClient, admin, user) -> None:
    user_headers = auth_header(anon, user.email)
    make_campaign(anon, "Counted", user_headers)

    admin_headers = auth_header(anon, admin.email)
    body = anon.get("/api/admin/users", headers=admin_headers).json()
    assert body["total"] == 2

    rows = {row["email"]: row for row in body["items"]}
    assert rows[user.email]["campaign_count"] == 1
    assert rows[admin.email]["role"] == "ADMIN"
    # Password material never leaves the server.
    assert "hashed_password" not in rows[user.email]

    stats = anon.get("/api/admin/stats", headers=admin_headers).json()
    assert stats["total_users"] == 2
    assert stats["active_users"] == 2
    assert stats["admins"] == 1
    assert stats["total_campaigns"] == 1


def test_admin_search_and_filter(anon: TestClient, admin, user) -> None:
    headers = auth_header(anon, admin.email)
    found = anon.get("/api/admin/users", params={"search": "owner"}, headers=headers).json()
    assert [row["email"] for row in found["items"]] == [user.email]

    admins = anon.get("/api/admin/users", params={"role": "ADMIN"}, headers=headers).json()
    assert [row["email"] for row in admins["items"]] == [admin.email]


def test_deactivation_blocks_sign_in_and_kills_live_sessions(
    anon: TestClient, admin, user
) -> None:
    session = sign_in(anon, user.email).json()
    user_headers = {"Authorization": f"Bearer {session['access_token']}"}
    assert anon.get("/api/campaigns", headers=user_headers).status_code == 200

    admin_headers = auth_header(anon, admin.email)
    response = anon.post(
        f"/api/admin/users/{user.id}/deactivate",
        json={"reason": "Policy violation"},
        headers=admin_headers,
    )
    assert response.status_code == 200
    assert response.json()["is_active"] is False
    assert response.json()["status"] == "DEACTIVATED"

    # The access token is still cryptographically valid; the account check is
    # what stops it, on the very next request.
    blocked = anon.get("/api/campaigns", headers=user_headers)
    assert blocked.status_code == 403
    assert "Policy violation" in blocked.json()["message"]

    assert anon.post(
        "/api/auth/refresh", json={"refresh_token": session["refresh_token"]}
    ).status_code == 401
    assert sign_in(anon, user.email).status_code == 403


def test_reactivation_restores_access(anon: TestClient, admin, user) -> None:
    admin_headers = auth_header(anon, admin.email)
    anon.post(f"/api/admin/users/{user.id}/deactivate", headers=admin_headers)
    assert sign_in(anon, user.email).status_code == 403

    response = anon.post(f"/api/admin/users/{user.id}/activate", headers=admin_headers)
    assert response.status_code == 200
    assert response.json()["is_active"] is True
    assert sign_in(anon, user.email).status_code == 200


def test_an_admin_cannot_deactivate_themselves(anon: TestClient, admin) -> None:
    headers = auth_header(anon, admin.email)
    response = anon.post(f"/api/admin/users/{admin.id}/deactivate", headers=headers)
    assert response.status_code == 409


def test_the_last_admin_cannot_be_demoted_or_deleted(
    anon: TestClient, admin, make_user
) -> None:
    other_admin = make_user("second-admin@example.com", role=UserRole.ADMIN)
    headers = auth_header(anon, admin.email)

    # Two admins: demoting one is fine.
    demoted = anon.put(
        f"/api/admin/users/{other_admin.id}", json={"role": "USER"}, headers=headers
    )
    assert demoted.status_code == 200
    assert demoted.json()["role"] == "USER"

    # Now there is one left, and it is the caller, so both guards apply.
    assert anon.post(
        f"/api/admin/users/{admin.id}/deactivate", headers=headers
    ).status_code == 409
    assert anon.delete(f"/api/admin/users/{admin.id}", headers=headers).status_code == 409
    assert anon.put(
        f"/api/admin/users/{admin.id}", json={"role": "USER"}, headers=headers
    ).status_code == 409


def test_admin_creates_a_user_who_can_sign_in(anon: TestClient, admin) -> None:
    headers = auth_header(anon, admin.email)
    created = anon.post(
        "/api/admin/users",
        json={
            "email": "invited@example.com",
            "password": "invited-password-123",
            "full_name": "Invited Person",
            "role": "USER",
        },
        headers=headers,
    )
    assert created.status_code == 201
    assert created.json()["email_verified"] is True
    assert sign_in(anon, "invited@example.com", "invited-password-123").status_code == 200


def test_admin_resets_a_password_and_ends_the_users_sessions(
    anon: TestClient, admin, user
) -> None:
    session = sign_in(anon, user.email).json()
    headers = auth_header(anon, admin.email)

    response = anon.post(
        f"/api/admin/users/{user.id}/reset-password",
        json={"new_password": "reset-by-the-admin-1"},
        headers=headers,
    )
    assert response.status_code == 200
    assert anon.post(
        "/api/auth/refresh", json={"refresh_token": session["refresh_token"]}
    ).status_code == 401
    assert sign_in(anon, user.email, "reset-by-the-admin-1").status_code == 200


def test_deleting_a_user_keeps_their_campaigns_as_unowned(
    anon: TestClient, admin, user, db
) -> None:
    from app.database.models import Campaign

    user_headers = auth_header(anon, user.email)
    campaign = make_campaign(anon, "Outlives Its Owner", user_headers)

    admin_headers = auth_header(anon, admin.email)
    assert anon.delete(f"/api/admin/users/{user.id}", headers=admin_headers).status_code == 200

    db.expire_all()
    row = db.get(Campaign, campaign["id"])
    assert row is not None, "deleting a user must not take their campaign data with it"
    assert row.owner_id is None


def test_admin_can_inspect_one_users_campaigns(anon: TestClient, admin, user) -> None:
    user_headers = auth_header(anon, user.email)
    make_campaign(anon, "Under Review", user_headers)

    admin_headers = auth_header(anon, admin.email)
    body = anon.get(f"/api/admin/users/{user.id}/campaigns", headers=admin_headers).json()
    assert [row["name"] for row in body["items"]] == ["Under Review"]
