"""add multi-gateway subscriptions and payment event logs

Adds the multi-gateway SaaS billing tables:
- subscriptions: Tracks user subscription state, trial countdown, provider customer/subscription IDs
- payment_event_logs: Idempotency log guaranteeing at-most-once processing for webhooks
- plans: Adds stripe_monthly_price_id, stripe_annual_price_id, stripe_product_id, razorpay_plan_id

Revision ID: e3a1f9b2c8d7
Revises: 0a1d3d7c8a7d
Create Date: 2026-11-02
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "e3a1f9b2c8d7"
down_revision: Union[str, None] = "0a1d3d7c8a7d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA = "linkedin_agent"

PAYMENT_PROVIDER = sa.Enum(
    "STRIPE", "RAZORPAY", name="paymentprovider", native_enum=False, length=32
)
SUBSCRIPTION_STATUS = sa.Enum(
    "TRIALING",
    "ACTIVE",
    "PAST_DUE",
    "CANCELED",
    "INCOMPLETE",
    "UNPAID",
    name="subscriptionstatus",
    native_enum=False,
    length=32,
)


def upgrade() -> None:
    # 1. Add gateway price fields to plans
    op.add_column(
        "plans",
        sa.Column("stripe_monthly_price_id", sa.String(length=100), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "plans",
        sa.Column("stripe_annual_price_id", sa.String(length=100), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "plans",
        sa.Column("stripe_product_id", sa.String(length=100), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "plans",
        sa.Column("razorpay_plan_id", sa.String(length=100), nullable=True),
        schema=SCHEMA,
    )

    # 2. Create subscriptions table
    op.create_table(
        "subscriptions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("provider", PAYMENT_PROVIDER, server_default="STRIPE", nullable=False),
        sa.Column("provider_customer_id", sa.String(length=100), nullable=False),
        sa.Column("provider_subscription_id", sa.String(length=100), nullable=True),
        sa.Column("provider_price_id", sa.String(length=100), nullable=True),
        sa.Column("plan_id", sa.String(length=64), server_default="starter", nullable=False),
        sa.Column("billing_cycle", sa.String(length=20), server_default="monthly", nullable=False),
        sa.Column(
            "status",
            SUBSCRIPTION_STATUS,
            server_default="TRIALING",
            nullable=False,
        ),
        sa.Column("trial_start_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("trial_ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("current_period_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancel_at_period_end", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("canceled_at", sa.DateTime(timezone=True), nullable=True),
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
            ["plan_id"],
            [f"{SCHEMA}.plans.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            [f"{SCHEMA}.users.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_subscriptions_user_id", "subscriptions", ["user_id"], unique=True, schema=SCHEMA
    )
    op.create_index(
        "ix_subscriptions_provider", "subscriptions", ["provider"], unique=False, schema=SCHEMA
    )
    op.create_index(
        "ix_subscriptions_provider_customer_id",
        "subscriptions",
        ["provider_customer_id"],
        unique=False,
        schema=SCHEMA,
    )
    op.create_index(
        "ix_subscriptions_provider_subscription_id",
        "subscriptions",
        ["provider_subscription_id"],
        unique=False,
        schema=SCHEMA,
    )
    op.create_index(
        "ix_subscriptions_plan_id", "subscriptions", ["plan_id"], unique=False, schema=SCHEMA
    )
    op.create_index(
        "ix_subscriptions_status", "subscriptions", ["status"], unique=False, schema=SCHEMA
    )
    op.create_index(
        "ix_subscriptions_trial_ends_at",
        "subscriptions",
        ["trial_ends_at"],
        unique=False,
        schema=SCHEMA,
    )
    op.create_index(
        "ix_subscriptions_current_period_end",
        "subscriptions",
        ["current_period_end"],
        unique=False,
        schema=SCHEMA,
    )

    # 3. Create payment_event_logs table (Idempotency)
    op.create_table(
        "payment_event_logs",
        sa.Column("id", sa.String(length=100), nullable=False),
        sa.Column("provider", PAYMENT_PROVIDER, nullable=False),
        sa.Column("event_type", sa.String(length=100), nullable=False),
        sa.Column(
            "processed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("payload_summary", sa.Text(), nullable=True),
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
        sa.PrimaryKeyConstraint("id"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_payment_event_logs_provider",
        "payment_event_logs",
        ["provider"],
        unique=False,
        schema=SCHEMA,
    )
    op.create_index(
        "ix_payment_event_logs_event_type",
        "payment_event_logs",
        ["event_type"],
        unique=False,
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_index("ix_payment_event_logs_event_type", table_name="payment_event_logs", schema=SCHEMA)
    op.drop_index("ix_payment_event_logs_provider", table_name="payment_event_logs", schema=SCHEMA)
    op.drop_table("payment_event_logs", schema=SCHEMA)

    op.drop_index("ix_subscriptions_current_period_end", table_name="subscriptions", schema=SCHEMA)
    op.drop_index("ix_subscriptions_trial_ends_at", table_name="subscriptions", schema=SCHEMA)
    op.drop_index("ix_subscriptions_status", table_name="subscriptions", schema=SCHEMA)
    op.drop_index("ix_subscriptions_plan_id", table_name="subscriptions", schema=SCHEMA)
    op.drop_index("ix_subscriptions_provider_subscription_id", table_name="subscriptions", schema=SCHEMA)
    op.drop_index("ix_subscriptions_provider_customer_id", table_name="subscriptions", schema=SCHEMA)
    op.drop_index("ix_subscriptions_provider", table_name="subscriptions", schema=SCHEMA)
    op.drop_index("ix_subscriptions_user_id", table_name="subscriptions", schema=SCHEMA)
    op.drop_table("subscriptions", schema=SCHEMA)

    op.drop_column("plans", "razorpay_plan_id", schema=SCHEMA)
    op.drop_column("plans", "stripe_product_id", schema=SCHEMA)
    op.drop_column("plans", "stripe_annual_price_id", schema=SCHEMA)
    op.drop_column("plans", "stripe_monthly_price_id", schema=SCHEMA)

