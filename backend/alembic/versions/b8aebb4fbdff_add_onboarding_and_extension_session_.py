"""add_onboarding_and_extension_session_columns

Revision ID: b8aebb4fbdff
Revises: d8f3a2b1c4e5
Create Date: 2026-10-19 15:11:24.303364
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b8aebb4fbdff'
down_revision: Union[str, None] = 'd8f3a2b1c4e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('user_platform_accounts', sa.Column('extension_last_seen', sa.DateTime(timezone=True), nullable=True), schema='linkedin_agent')
    op.add_column('user_platform_accounts', sa.Column('extension_version', sa.String(length=32), nullable=True), schema='linkedin_agent')
    op.add_column('user_platform_accounts', sa.Column('platform_member_id', sa.String(length=128), nullable=True), schema='linkedin_agent')
    op.add_column('user_platform_accounts', sa.Column('account_tier', sa.String(length=32), nullable=False, server_default='FREE'), schema='linkedin_agent')
    op.create_index(op.f('ix_linkedin_agent_user_platform_accounts_platform_member_id'), 'user_platform_accounts', ['platform_member_id'], unique=False, schema='linkedin_agent')
    op.add_column('users', sa.Column('picture_url', sa.String(length=500), nullable=True), schema='linkedin_agent')
    op.add_column('users', sa.Column('onboarding_step', sa.Integer(), nullable=False, server_default='1'), schema='linkedin_agent')


def downgrade() -> None:
    op.drop_column('users', 'onboarding_step', schema='linkedin_agent')
    op.drop_column('users', 'picture_url', schema='linkedin_agent')
    op.drop_index(op.f('ix_linkedin_agent_user_platform_accounts_platform_member_id'), table_name='user_platform_accounts', schema='linkedin_agent')
    op.drop_column('user_platform_accounts', 'account_tier', schema='linkedin_agent')
    op.drop_column('user_platform_accounts', 'platform_member_id', schema='linkedin_agent')
    op.drop_column('user_platform_accounts', 'extension_version', schema='linkedin_agent')
    op.drop_column('user_platform_accounts', 'extension_last_seen', schema='linkedin_agent')
