from __future__ import annotations

import os

os.environ.setdefault("APP_ENV", "test")

from collections.abc import Iterator

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

import app.database.models  # noqa: F401  - registers every table
from app.ai.provider_factory import set_llm_provider_override
from app.ai.providers.mock_provider import MockLLMProvider
from app.config import settings
from app.database.database import Base
from app.integrations.platform.factory import set_platform_adapter_override
from app.integrations.platform.mock_adapter import MockSocialPlatformAdapter


@pytest.fixture(scope="session")
def engine():
    """A Postgres engine for the test schema, or skip the whole integration suite."""
    url = settings.sqlalchemy_url
    try:
        candidate = sa.create_engine(url, poolclass=sa.pool.NullPool)
        with candidate.connect() as conn:
            conn.execute(sa.text(f'CREATE SCHEMA IF NOT EXISTS "{settings.db_schema}"'))
            conn.commit()
    except sa.exc.OperationalError as exc:
        pytest.skip(
            f"PostgreSQL is not reachable for integration tests ({exc.orig}). "
            f"Set DB_PASSWORD in backend/.env.test and create the "
            f"{settings.db_name!r} database.",
            allow_module_level=False,
        )

    Base.metadata.drop_all(candidate)
    Base.metadata.create_all(candidate)
    yield candidate
    Base.metadata.drop_all(candidate)
    candidate.dispose()


@pytest.fixture
def db(engine) -> Iterator[Session]:
    """A session wrapped in a transaction that is rolled back after each test."""
    connection = engine.connect()
    transaction = connection.begin()
    factory = sessionmaker(bind=connection, expire_on_commit=False, join_transaction_mode="create_savepoint")
    session = factory()
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


@pytest.fixture
def llm() -> Iterator[MockLLMProvider]:
    provider = MockLLMProvider()
    set_llm_provider_override(provider)
    yield provider
    set_llm_provider_override(None)


@pytest.fixture
def platform() -> Iterator[MockSocialPlatformAdapter]:
    adapter = MockSocialPlatformAdapter()
    set_platform_adapter_override(adapter)
    yield adapter
    set_platform_adapter_override(None)


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


# ----------------------------------------------------------------- accounts --


@pytest.fixture
def make_user(db: Session):
    """Factory for accounts. ``make_user(role=UserRole.ADMIN)`` for an admin."""
    from app.enums import UserRole
    from app.services import auth_service

    created: list[int] = []

    def _make(
        email: str | None = None,
        password: str = "test-password-123",
        role: UserRole | None = None,
        **kwargs,
    ):
        address = email or f"user{len(created) + 1}@example.com"
        user, _ = auth_service.create_user(
            db,
            email=address,
            password=password,
            role=role or UserRole.USER,
            email_verified=True,
            **kwargs,
        )
        created.append(user.id)
        return user

    return _make


@pytest.fixture
def user(make_user):
    return make_user("owner@example.com")


@pytest.fixture
def admin(make_user):
    from app.enums import UserRole

    return make_user("admin@example.com", role=UserRole.ADMIN)
