"""user accounts, roles, per-user settings and refresh tokens

Adds the authentication layer on top of the stub ``users`` table created by the
initial schema. ``is_superuser`` is replaced by a ``role`` enum: two columns
answering the same authorization question is exactly the kind of thing that
drifts, so the boolean is backfilled into the enum and then dropped.

Revision ID: b4c1d9e27f30
Revises: a90a28314707
Create Date: 2026-10-07
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b4c1d9e27f30"
down_revision: Union[str, None] = "a90a28314707"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA = "linkedin_agent"

USER_ROLE = sa.Enum("ADMIN", "USER", name="userrole", native_enum=False, length=64)
USER_STATUS = sa.Enum(
    "PENDING_VERIFICATION",
    "ACTIVE",
    "DEACTIVATED",
    name="userstatus",
    native_enum=False,
    length=64,
)
COMMENT_LENGTH = sa.Enum(
    "SHORT", "MEDIUM", "LONG", name="commentlength", native_enum=False, length=64
)
COMMENT_STYLE = sa.Enum(
    "PROFESSIONAL",
    "TECHNICAL",
    "CONVERSATIONAL",
    name="commentstyle",
    native_enum=False,
    length=64,
)
CONNECTION_MESSAGE_MODE = sa.Enum(
    "NONE",
    "TEMPLATE",
    "AI_GENERATED",
    name="connectionmessagemode",
    native_enum=False,
    length=64,
)
APPROVAL_MODE = sa.Enum(
    "REQUIRED", "AUTOMATIC", name="approvalmode", native_enum=False, length=64
)


def upgrade() -> None:
    # ----------------------------------------------------------------- users --
    op.add_column("users", sa.Column("role", USER_ROLE, nullable=True), schema=SCHEMA)
    op.add_column("users", sa.Column("status", USER_STATUS, nullable=True), schema=SCHEMA)
    op.add_column(
        "users",
        sa.Column("email_verified", sa.Boolean(), server_default="false", nullable=False),
        schema=SCHEMA,
    )
    for name, column in (
        ("email_verified_at", sa.Column("email_verified_at", sa.DateTime(timezone=True))),
        ("verification_token", sa.Column("verification_token", sa.String(length=64))),
        ("verification_sent_at", sa.Column("verification_sent_at", sa.DateTime(timezone=True))),
        (
            "verification_expires_at",
            sa.Column("verification_expires_at", sa.DateTime(timezone=True)),
        ),
        ("job_title", sa.Column("job_title", sa.String(length=200))),
        ("company", sa.Column("company", sa.String(length=200))),
        ("linkedin_url", sa.Column("linkedin_url", sa.String(length=500))),
        ("bio", sa.Column("bio", sa.Text())),
        ("last_login_at", sa.Column("last_login_at", sa.DateTime(timezone=True))),
        ("deactivated_at", sa.Column("deactivated_at", sa.DateTime(timezone=True))),
        ("deactivated_reason", sa.Column("deactivated_reason", sa.Text())),
        ("deactivated_by_id", sa.Column("deactivated_by_id", sa.Integer())),
    ):
        op.add_column("users", column, schema=SCHEMA)

    op.add_column(
        "users",
        sa.Column("timezone", sa.String(length=64), server_default="UTC", nullable=False),
        schema=SCHEMA,
    )

    # Backfill before the columns become NOT NULL.
    op.execute(
        f"UPDATE {SCHEMA}.users SET role = CASE WHEN is_superuser THEN 'ADMIN' ELSE 'USER' END"
    )
    op.execute(
        f"UPDATE {SCHEMA}.users SET status = "
        f"CASE WHEN is_active THEN 'ACTIVE' ELSE 'DEACTIVATED' END"
    )
    # Accounts that predate verification were trusted already; marking them
    # unverified would lock them out the moment the flag is turned on.
    op.execute(f"UPDATE {SCHEMA}.users SET email_verified = true")

    op.alter_column("users", "role", nullable=False, schema=SCHEMA)
    op.alter_column("users", "status", nullable=False, schema=SCHEMA)

    op.create_index(
        op.f("ix_linkedin_agent_users_role"), "users", ["role"], unique=False, schema=SCHEMA
    )
    op.create_index(
        op.f("ix_linkedin_agent_users_status"), "users", ["status"], unique=False, schema=SCHEMA
    )
    op.create_index(
        op.f("ix_linkedin_agent_users_verification_token"),
        "users",
        ["verification_token"],
        unique=False,
        schema=SCHEMA,
    )
    op.create_foreign_key(
        op.f("fk_users_deactivated_by_id_users"),
        "users",
        "users",
        ["deactivated_by_id"],
        ["id"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
        ondelete="SET NULL",
    )

    op.drop_column("users", "is_superuser", schema=SCHEMA)

    # --------------------------------------------------------- user_settings --
    op.create_table(
        "user_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("default_dry_run", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("max_people_per_day", sa.Integer(), nullable=False, server_default="20"),
        sa.Column("max_likes_per_day", sa.Integer(), nullable=False, server_default="60"),
        sa.Column("max_comments_per_day", sa.Integer(), nullable=False, server_default="15"),
        sa.Column("max_connections_per_day", sa.Integer(), nullable=False, server_default="15"),
        sa.Column("max_people_per_run", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("min_action_delay_seconds", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("max_action_delay_seconds", sa.Integer(), nullable=False, server_default="180"),
        sa.Column("initial_posts_to_like", sa.Integer(), nullable=False, server_default="2"),
        sa.Column("evaluate_post_index", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("minimum_relevance_score", sa.Integer(), nullable=False, server_default="75"),
        sa.Column("minimum_candidate_score", sa.Integer(), nullable=False, server_default="70"),
        sa.Column("generate_comment", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("connection_delay_hours", sa.Integer(), nullable=False, server_default="48"),
        sa.Column("comment_length", COMMENT_LENGTH, nullable=False, server_default="SHORT"),
        sa.Column(
            "comment_style", COMMENT_STYLE, nullable=False, server_default="PROFESSIONAL"
        ),
        sa.Column(
            "connection_message_mode",
            CONNECTION_MESSAGE_MODE,
            nullable=False,
            server_default="AI_GENERATED",
        ),
        sa.Column("connection_message_template", sa.Text(), nullable=True),
        sa.Column(
            "candidate_approval", APPROVAL_MODE, nullable=False, server_default="AUTOMATIC"
        ),
        sa.Column("comment_approval", APPROVAL_MODE, nullable=False, server_default="REQUIRED"),
        sa.Column(
            "connection_approval", APPROVAL_MODE, nullable=False, server_default="REQUIRED"
        ),
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
            name=op.f("fk_user_settings_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_user_settings")),
        sa.UniqueConstraint("user_id", name=op.f("uq_user_settings_user_id")),
        schema=SCHEMA,
    )
    op.create_index(
        op.f("ix_linkedin_agent_user_settings_created_at"),
        "user_settings",
        ["created_at"],
        unique=False,
        schema=SCHEMA,
    )
    op.create_index(
        op.f("ix_linkedin_agent_user_settings_user_id"),
        "user_settings",
        ["user_id"],
        unique=True,
        schema=SCHEMA,
    )

    # Every existing account gets a settings row so nothing has to special-case
    # its absence.
    op.execute(f"INSERT INTO {SCHEMA}.user_settings (user_id) SELECT id FROM {SCHEMA}.users")

    # -------------------------------------------------------- refresh_tokens --
    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("jti", sa.String(length=64), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_reason", sa.String(length=50), nullable=True),
        sa.Column("user_agent", sa.String(length=300), nullable=True),
        sa.Column("ip_address", sa.String(length=64), nullable=True),
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
            name=op.f("fk_refresh_tokens_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_refresh_tokens")),
        sa.UniqueConstraint("jti", name=op.f("uq_refresh_tokens_jti")),
        schema=SCHEMA,
    )
    for column, unique in (
        ("created_at", False),
        ("user_id", False),
        ("jti", True),
        ("token_hash", False),
        ("expires_at", False),
    ):
        op.create_index(
            op.f(f"ix_linkedin_agent_refresh_tokens_{column}"),
            "refresh_tokens",
            [column],
            unique=unique,
            schema=SCHEMA,
        )


def downgrade() -> None:
    op.drop_table("refresh_tokens", schema=SCHEMA)
    op.drop_table("user_settings", schema=SCHEMA)

    op.add_column(
        "users",
        sa.Column("is_superuser", sa.Boolean(), server_default="false", nullable=False),
        schema=SCHEMA,
    )
    op.execute(f"UPDATE {SCHEMA}.users SET is_superuser = (role = 'ADMIN')")

    op.drop_constraint(
        op.f("fk_users_deactivated_by_id_users"), "users", type_="foreignkey", schema=SCHEMA
    )
    op.drop_index(
        op.f("ix_linkedin_agent_users_verification_token"), table_name="users", schema=SCHEMA
    )
    op.drop_index(op.f("ix_linkedin_agent_users_status"), table_name="users", schema=SCHEMA)
    op.drop_index(op.f("ix_linkedin_agent_users_role"), table_name="users", schema=SCHEMA)

    for column in (
        "deactivated_by_id",
        "deactivated_reason",
        "deactivated_at",
        "last_login_at",
        "bio",
        "timezone",
        "linkedin_url",
        "company",
        "job_title",
        "verification_expires_at",
        "verification_sent_at",
        "verification_token",
        "email_verified_at",
        "email_verified",
        "status",
        "role",
    ):
        op.drop_column("users", column, schema=SCHEMA)
