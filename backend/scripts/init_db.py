"""One-command database setup.

    python -m scripts.init_db

Creates the database and schema if they are missing, generates the initial
Alembic migration the first time it runs, then applies all migrations.

Reads its connection settings from the env file selected by ``APP_ENV``.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from urllib.parse import quote_plus

import psycopg
from psycopg import sql

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from app.config import settings


def admin_dsn() -> str:
    password = f":{quote_plus(settings.db_password)}" if settings.db_password else ""
    return (
        f"postgresql://{quote_plus(settings.db_user)}{password}"
        f"@{settings.db_host}:{settings.db_port}/postgres"
    )


def app_dsn() -> str:
    password = f":{quote_plus(settings.db_password)}" if settings.db_password else ""
    return (
        f"postgresql://{quote_plus(settings.db_user)}{password}"
        f"@{settings.db_host}:{settings.db_port}/{settings.db_name}"
    )


def ensure_database() -> None:
    with psycopg.connect(admin_dsn(), autocommit=True) as conn:
        exists = conn.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s", (settings.db_name,)
        ).fetchone()
        if exists:
            print(f"  database {settings.db_name!r} already exists")
            return
        conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(settings.db_name)))
        print(f"  created database {settings.db_name!r}")


def ensure_schema() -> None:
    with psycopg.connect(app_dsn(), autocommit=True) as conn:
        conn.execute(
            sql.SQL("CREATE SCHEMA IF NOT EXISTS {}").format(sql.Identifier(settings.db_schema))
        )
        print(f"  schema {settings.db_schema!r} ready")


def alembic(*args: str) -> None:
    result = subprocess.run(
        [sys.executable, "-m", "alembic", *args], cwd=BACKEND_ROOT, check=False
    )
    if result.returncode != 0:
        raise SystemExit(f"alembic {' '.join(args)} failed with exit code {result.returncode}")


def ensure_initial_migration() -> None:
    versions = BACKEND_ROOT / "alembic" / "versions"
    versions.mkdir(parents=True, exist_ok=True)
    if any(versions.glob("*.py")):
        print("  migrations already present")
        return
    print("  generating the initial migration from the ORM models")
    alembic("revision", "--autogenerate", "-m", "initial schema")


def main() -> None:
    print(f"Setting up {settings.db_name}.{settings.db_schema} on "
          f"{settings.db_host}:{settings.db_port} as {settings.db_user}")

    if not settings.db_password:
        print(
            "\n  DB_PASSWORD is empty. If your PostgreSQL requires a password, set it in "
            f"backend/.env.{settings.app_env.value} before running this script.\n"
        )

    try:
        ensure_database()
        ensure_schema()
    except psycopg.OperationalError as exc:
        raise SystemExit(
            f"\nCould not connect to PostgreSQL: {exc}\n"
            f"Check DB_HOST / DB_PORT / DB_USER / DB_PASSWORD in "
            f"backend/.env.{settings.app_env.value}."
        ) from exc

    ensure_initial_migration()
    alembic("upgrade", "head")
    print("\nDatabase is ready.")


if __name__ == "__main__":
    main()
