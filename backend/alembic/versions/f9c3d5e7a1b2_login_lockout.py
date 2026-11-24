"""login_lockout

Revision ID: f9c3d5e7a1b2
Revises: e262e3eb5509
Create Date: 2026-10-26 12:00:00.000000
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "f9c3d5e7a1b2"
down_revision: Union[str, None] = "e262e3eb5509"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA = "linkedin_agent"


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("failed_login_attempts", sa.Integer(), server_default="0", nullable=False),
        schema=SCHEMA,
    )
    op.add_column("users", sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True), schema=SCHEMA)


def downgrade() -> None:
    op.drop_column("users", "locked_until", schema=SCHEMA)
    op.drop_column("users", "failed_login_attempts", schema=SCHEMA)
