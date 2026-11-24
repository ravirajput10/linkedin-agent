"""create plans table and link to users

Adds the SaaS tiers management model (plans) with pricing, quotas, badges,
and features list, plus plan_id and billing_cycle foreign key on users. Seeds
the initial Starter, Professional, and Enterprise plans.

Revision ID: d8f3a2b1c4e5
Revises: c7e2f14a9b55
Create Date: 2026-10-13
"""

from __future__ import annotations

import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "d8f3a2b1c4e5"
down_revision: Union[str, None] = "c7e2f14a9b55"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA = "linkedin_agent"


def upgrade() -> None:
    op.create_table(
        "plans",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("badge", sa.String(length=50), nullable=True),
        sa.Column("monthly_price", sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column("annual_price", sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column("currency", sa.String(length=10), server_default="USD", nullable=False),
        sa.Column("trial_days", sa.Integer(), server_default="14", nullable=False),
        sa.Column("is_recommended", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "button_label",
            sa.String(length=100),
            server_default="Start Free Trial",
            nullable=False,
        ),
        sa.Column("max_campaigns", sa.Integer(), server_default="5", nullable=False),
        sa.Column("monthly_ai_prospects", sa.Integer(), server_default="1000", nullable=False),
        sa.Column("daily_action_limit", sa.Integer(), server_default="50", nullable=False),
        sa.Column("has_smart_pacing", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("has_2fa_proxy", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("has_custom_ai_prompts", sa.Boolean(), server_default="false", nullable=False),
        sa.Column(
            "features",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="[]",
            nullable=False,
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
        sa.PrimaryKeyConstraint("id", name=op.f("pk_plans")),
        schema=SCHEMA,
    )

    for column, unique in (
        ("created_at", False),
        ("is_active", False),
        ("sort_order", False),
    ):
        op.create_index(
            op.f(f"ix_linkedin_agent_plans_{column}"),
            "plans",
            [column],
            unique=unique,
            schema=SCHEMA,
        )

    op.add_column(
        "users",
        sa.Column("plan_id", sa.String(length=64), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "users",
        sa.Column("billing_cycle", sa.String(length=20), nullable=True),
        schema=SCHEMA,
    )
    op.create_foreign_key(
        op.f("fk_users_plan_id_plans"),
        "users",
        "plans",
        ["plan_id"],
        ["id"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
        ondelete="SET NULL",
    )
    op.create_index(
        op.f("ix_linkedin_agent_users_plan_id"),
        "users",
        ["plan_id"],
        unique=False,
        schema=SCHEMA,
    )

    # Seed initial plans
    plans_table = sa.table(
        "plans",
        sa.column("id", sa.String),
        sa.column("name", sa.String),
        sa.column("description", sa.Text),
        sa.column("badge", sa.String),
        sa.column("monthly_price", sa.Numeric),
        sa.column("annual_price", sa.Numeric),
        sa.column("currency", sa.String),
        sa.column("trial_days", sa.Integer),
        sa.column("is_recommended", sa.Boolean),
        sa.column("is_active", sa.Boolean),
        sa.column("sort_order", sa.Integer),
        sa.column("button_label", sa.String),
        sa.column("max_campaigns", sa.Integer),
        sa.column("monthly_ai_prospects", sa.Integer),
        sa.column("daily_action_limit", sa.Integer),
        sa.column("has_smart_pacing", sa.Boolean),
        sa.column("has_2fa_proxy", sa.Boolean),
        sa.column("has_custom_ai_prompts", sa.Boolean),
        sa.column("features", postgresql.JSONB),
        schema=SCHEMA,
    )

    op.bulk_insert(
        plans_table,
        [
            {
                "id": "starter",
                "name": "Starter",
                "description": "Ideal for individual creators & founders exploring outreach.",
                "badge": None,
                "monthly_price": 29.00,
                "annual_price": 24.00,
                "currency": "USD",
                "trial_days": 14,
                "is_recommended": False,
                "is_active": True,
                "sort_order": 1,
                "button_label": "Start Free Trial",
                "max_campaigns": 1,
                "monthly_ai_prospects": 150,
                "daily_action_limit": 25,
                "has_smart_pacing": True,
                "has_2fa_proxy": True,
                "has_custom_ai_prompts": False,
                "features": [
                    "1 Active campaign",
                    "150 AI prospect evaluations / mo",
                    "Basic human-paced engagement",
                    "Chrome extension session linking",
                    "Standard approval queues",
                ],
            },
            {
                "id": "pro",
                "name": "Professional",
                "description": "The complete AI growth toolkit for sales leads & recruiters.",
                "badge": "Most Popular",
                "monthly_price": 49.00,
                "annual_price": 39.00,
                "currency": "USD",
                "trial_days": 14,
                "is_recommended": True,
                "is_active": True,
                "sort_order": 2,
                "button_label": "Start 14-Day Free Trial",
                "max_campaigns": 5,
                "monthly_ai_prospects": 1000,
                "daily_action_limit": 50,
                "has_smart_pacing": True,
                "has_2fa_proxy": True,
                "has_custom_ai_prompts": False,
                "features": [
                    "5 Active campaigns",
                    "1,000 AI prospect evaluations / mo",
                    "Smart human pacing & auto-delays",
                    "AI personalized connection notes",
                    "LinkedIn 2FA in-popup resolver",
                    "Priority email & chat support",
                ],
            },
            {
                "id": "enterprise",
                "name": "Enterprise",
                "description": "Maximum scale & security for teams and agencies.",
                "badge": "High Volume",
                "monthly_price": 129.00,
                "annual_price": 99.00,
                "currency": "USD",
                "trial_days": 14,
                "is_recommended": False,
                "is_active": True,
                "sort_order": 3,
                "button_label": "Start with Enterprise",
                "max_campaigns": -1,
                "monthly_ai_prospects": 5000,
                "daily_action_limit": 100,
                "has_smart_pacing": True,
                "has_2fa_proxy": True,
                "has_custom_ai_prompts": True,
                "features": [
                    "Unlimited active campaigns",
                    "5,000 AI prospect evaluations / mo",
                    "Dedicated residential proxy IP",
                    "Custom AI prompts & brand guardrails",
                    "Multi-user roles & administration",
                ],
            },
        ],
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("fk_users_plan_id_plans"),
        "users",
        schema=SCHEMA,
        type_="foreignkey",
    )
    op.drop_index(
        op.f("ix_linkedin_agent_users_plan_id"),
        table_name="users",
        schema=SCHEMA,
    )
    op.drop_column("users", "billing_cycle", schema=SCHEMA)
    op.drop_column("users", "plan_id", schema=SCHEMA)

    op.drop_table("plans", schema=SCHEMA)
