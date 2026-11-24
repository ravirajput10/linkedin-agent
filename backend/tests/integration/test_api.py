"""API tests against a live TestClient and PostgreSQL."""

from __future__ import annotations

import json
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.main import app

pytestmark = pytest.mark.integration


def _sign_in(test_client: TestClient, email: str, password: str = "test-password-123") -> str:
    response = test_client.post("/api/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


@pytest.fixture
def anon_client(db: Session, llm, platform) -> Iterator[TestClient]:
    """No Authorization header: for testing that endpoints are actually gated."""
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def client(anon_client: TestClient, user) -> TestClient:
    """Signed in as an ordinary user. Everything it creates is owned by ``user``."""
    anon_client.headers["Authorization"] = f"Bearer {_sign_in(anon_client, user.email)}"
    return anon_client


@pytest.fixture
def admin_client(anon_client: TestClient, admin) -> TestClient:
    anon_client.headers["Authorization"] = f"Bearer {_sign_in(anon_client, admin.email)}"
    return anon_client


def test_health(client: TestClient) -> None:
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["llm_provider"] == "mock"


def test_analyze_then_create_then_start(client: TestClient) -> None:
    analysis = client.post(
        "/api/campaigns/analyze",
        json={
            "instruction": (
                "Find CTOs and Engineering Managers in SaaS companies in India who "
                "post about Java, AI, microservices and architecture. Ignore "
                "recruiters, job posts and motivational content."
            )
        },
    )
    assert analysis.status_code == 200
    parsed = analysis.json()
    assert parsed["suggested_name"]
    assert parsed["criteria"]["job_titles"]
    assert parsed["provider"] == "mock"
    assert parsed["prompt_version"] == "v1"

    created = client.post(
        "/api/campaigns",
        json={
            "name": parsed["suggested_name"],
            "instruction": "Find CTOs in SaaS companies in India posting about Java and AI.",
            "criteria": parsed["criteria"],
            "exclusions": [{"exclusion_type": "company", "value": "Acme"}],
        },
    )
    assert created.status_code == 201
    campaign = created.json()
    assert campaign["status"] == "DRAFT"
    assert campaign["criteria"]["job_titles"] == parsed["criteria"]["job_titles"]
    assert len(campaign["exclusions"]) == 1

    started = client.post(f"/api/campaigns/{campaign['id']}/start")
    assert started.status_code == 200
    assert started.json()["campaign"]["status"] == "RUNNING"


def test_criteria_edits_survive_the_round_trip(client: TestClient) -> None:
    created = client.post(
        "/api/campaigns",
        json={"name": "Editable", "instruction": "Find backend engineers in India."},
    ).json()

    updated = client.put(
        f"/api/campaigns/{created['id']}",
        json={
            "criteria": {
                **created["criteria"],
                "job_titles": ["Principal Engineer"],
                "minimum_relevance_score": 90,
            }
        },
    )
    assert updated.status_code == 200
    assert updated.json()["criteria"]["job_titles"] == ["Principal Engineer"]
    assert updated.json()["criteria"]["minimum_relevance_score"] == 90


def test_criteria_cannot_be_edited_while_running(client: TestClient) -> None:
    created = client.post(
        "/api/campaigns",
        json={"name": "Locked", "instruction": "Find backend engineers in India."},
    ).json()
    client.post(f"/api/campaigns/{created['id']}/start")

    response = client.put(
        f"/api/campaigns/{created['id']}",
        json={"criteria": {**created["criteria"], "job_titles": ["CTO"]}},
    )
    assert response.status_code == 409
    assert response.json()["code"] == "CONFLICT"


def test_pause_resume_stop(client: TestClient) -> None:
    created = client.post(
        "/api/campaigns",
        json={"name": "Lifecycle", "instruction": "Find backend engineers in India."},
    ).json()
    campaign_id = created["id"]

    client.post(f"/api/campaigns/{campaign_id}/start")
    assert client.post(f"/api/campaigns/{campaign_id}/pause").json()["campaign"]["status"] == "PAUSED"
    assert client.post(f"/api/campaigns/{campaign_id}/resume").json()["campaign"]["status"] == "RUNNING"
    assert client.post(f"/api/campaigns/{campaign_id}/stop").json()["campaign"]["status"] == "STOPPED"


def test_starting_twice_conflicts(client: TestClient) -> None:
    created = client.post(
        "/api/campaigns",
        json={"name": "Double start", "instruction": "Find backend engineers in India."},
    ).json()
    client.post(f"/api/campaigns/{created['id']}/start")
    assert client.post(f"/api/campaigns/{created['id']}/start").status_code == 409


def test_missing_campaign_returns_a_structured_404(client: TestClient) -> None:
    response = client.get("/api/campaigns/999999")
    assert response.status_code == 404
    assert response.json()["code"] == "NOT_FOUND"


def test_invalid_payload_returns_a_structured_422(client: TestClient) -> None:
    response = client.post("/api/campaigns", json={"name": "x"})
    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"


def test_dashboard_shape(client: TestClient) -> None:
    body = client.get("/api/dashboard").json()
    assert "counters" in body and "agent" in body
    assert body["agent"]["state"] in ("IDLE", "RUNNING")
    for key in (
        "active_campaigns",
        "candidates_discovered",
        "posts_liked",
        "comments_posted",
        "connections_sent",
        "actions_today",
    ):
        assert key in body["counters"]


def test_analytics_shape(client: TestClient) -> None:
    body = client.get("/api/analytics?days=7").json()
    assert len(body["time_series"]) == 7
    assert {point["label"] for point in body["funnel"]} >= {"Candidates discovered"}
    assert "by_provider" in body["ai"]


def test_settings_exposes_configuration_but_no_secrets(client: TestClient) -> None:
    body = client.get("/api/settings").json()
    assert body["llm"]["provider"] == "mock"
    assert body["platform"] == "mock"
    assert len(body["prompts"]) == 5
    assert all(prompt["system_prompt_exists"] for prompt in body["prompts"])

    # No key anywhere in the payload carries a credential. (A substring scan is
    # the wrong test: "max_context_tokens" legitimately contains "token".)
    def every_key(node):
        if isinstance(node, dict):
            for key, value in node.items():
                yield key
                yield from every_key(value)
        elif isinstance(node, list):
            for item in node:
                yield from every_key(item)

    sensitive_keys = {
        "api_key",
        "claude_api_key",
        "secret_key",
        "client_secret",
        "db_password",
        "password",
        "access_token",
        "refresh_token",
    }
    assert sensitive_keys.isdisjoint(set(every_key(body)))

    # Nor does any configured secret value leak as content.
    serialized = json.dumps(body)
    for value in (settings.secret_key, settings.db_password, settings.claude_api_key):
        if value:
            assert value not in serialized


def test_approvals_list_and_counts(client: TestClient) -> None:
    assert client.get("/api/approvals").json()["items"] == []
    counts = client.get("/api/approvals/counts").json()
    assert set(counts) == {"CANDIDATE", "COMMENT", "CONNECTION"}


def test_activity_feed_records_campaign_events(client: TestClient) -> None:
    client.post(
        "/api/campaigns",
        json={"name": "Audited", "instruction": "Find backend engineers in India."},
    )
    body = client.get("/api/activity").json()
    assert body["total"] >= 1
    assert any("created as a draft" in item["message"] for item in body["items"])


def test_scheduled_actions_endpoint(client: TestClient) -> None:
    body = client.get("/api/scheduled-actions").json()
    assert body["items"] == []
    assert body["total"] == 0
