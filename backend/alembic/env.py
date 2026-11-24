from __future__ import annotations

from logging.config import fileConfig

from sqlalchemy import create_engine, pool, text

# Importing the models package registers every table on Base.metadata.
import app.database.models  # noqa: F401
from alembic import context
from app.config import settings
from app.database.database import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Escape '%' for configparser interpolation in case passwords have special chars (%40, etc.)
config.set_main_option("sqlalchemy.url", settings.sqlalchemy_url.replace("%", "%%"))
target_metadata = Base.metadata


def include_object(obj, name, type_, reflected, compare_to) -> bool:
    """Keep autogenerate focused on our own schema."""
    return not (type_ == "table" and obj.schema not in (settings.db_schema, None))


def run_migrations_offline() -> None:
    context.configure(
        url=settings.sqlalchemy_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        version_table_schema=settings.db_schema,
        include_schemas=True,
        include_object=include_object,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = create_engine(
        settings.sqlalchemy_url,
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        connection.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{settings.db_schema}"'))
        connection.commit()

        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            version_table_schema=settings.db_schema,
            include_schemas=True,
            include_object=include_object,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
