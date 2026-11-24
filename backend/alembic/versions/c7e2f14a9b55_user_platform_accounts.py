"""user_platform_accounts: linked LinkedIn identities per user

Stores no credential of the member's. Unipile's hosted auth wizard handles the
sign-in and returns only an opaque account id, which is useless without the
server-side API key.

Revision ID: c7e2f14a9b55
Revises: b4c1d9e27f30
Create Date: 2026-10-12
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c7e2f14a9b55"
down_revision: Union[str, None] = "b4c1d9e27f30"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA = "linkedin_agent"

PROVIDER = sa.Enum(
    "LINKEDIN", name="platformprovider", native_enum=False, length=64
)
ACCOUNT_STATUS = sa.Enum(
    "PENDING",
    "CONNECTED",
    "DISCONNECTED",
    "ERROR",
    name="platformaccountstatus",
    native_enum=False,
    length=64,
)


def upgrade() -> None:
    op.create_table(
        "user_platform_accounts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("provider", PROVIDER, nullable=False),
        sa.Column("status", ACCOUNT_STATUS, nullable=False, server_default="PENDING"),
        sa.Column("account_id", sa.String(length=128), nullable=True),
        sa.Column("link_token", sa.String(length=64), nullable=True),
        sa.Column("link_requested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("link_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("connected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("disconnected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("last_checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            [f"{SCHEMA}.users.id"],
            name=op.f("fk_user_platform_accounts_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_user_platform_accounts")),
        # One linked identity per provider per user; reconnect updates the row.
        sa.UniqueConstraint("user_id", "provider", name="user_platform_account"),
        schema=SCHEMA,
    )

    for column, unique in (
        ("created_at", False),
        ("user_id", False),
        ("provider", False),
        ("status", False),
        ("account_id", False),
        ("link_token", False),
    ):
        op.create_index(
            op.f(f"ix_linkedin_agent_user_platform_accounts_{column}"),
            "user_platform_accounts",
            [column],
            unique=unique,
            schema=SCHEMA,
        )


def downgrade() -> None:
    op.drop_table("user_platform_accounts", schema=SCHEMA)
