"""SQLAlchemy engine, session factory and declarative base."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime

from sqlalchemy import DateTime, MetaData, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

metadata = MetaData(schema=settings.db_schema, naming_convention=NAMING_CONVENTION)


class Base(DeclarativeBase):
    metadata = metadata

    type_annotation_map = {datetime: DateTime(timezone=True)}


engine = create_engine(
    settings.sqlalchemy_url,
    echo=settings.db_echo,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
    future=True,
)


@event.listens_for(engine, "connect")
def _set_search_path(dbapi_connection, connection_record) -> None:
    cursor = dbapi_connection.cursor()
    cursor.execute(f'SET search_path TO "{settings.db_schema}", public')
    cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


def utcnow() -> datetime:
    return datetime.now(UTC)


@contextmanager
def session_scope() -> Iterator[Session]:
    """Transactional session for background workers and services."""
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_db() -> Iterator[Session]:
    """FastAPI dependency yielding a request-scoped session."""
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
