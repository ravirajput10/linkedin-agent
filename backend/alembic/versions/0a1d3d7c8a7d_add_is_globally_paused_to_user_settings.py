"""add_is_globally_paused_to_user_settings

Revision ID: 0a1d3d7c8a7d
Revises: f9c3d5e7a1b2
Create Date: 2026-10-27 10:29:06.207081
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0a1d3d7c8a7d'
down_revision: Union[str, None] = 'f9c3d5e7a1b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


SCHEMA = "linkedin_agent"


def upgrade() -> None:
    op.add_column(
        "user_settings",
        sa.Column("is_globally_paused", sa.Boolean(), server_default="false", nullable=False),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_column("user_settings", "is_globally_paused", schema=SCHEMA)
