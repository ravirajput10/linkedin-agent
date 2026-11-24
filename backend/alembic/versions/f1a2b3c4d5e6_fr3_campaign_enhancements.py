"""fr3_campaign_enhancements

Revision ID: f1a2b3c4d5e6
Revises: e7b9a1c2d3e4
Create Date: 2026-10-21 10:30:00.000000
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, None] = 'e7b9a1c2d3e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add audience_id and is_archived to campaigns
    op.add_column(
        'campaigns',
        sa.Column('audience_id', sa.Integer(), nullable=True),
        schema='linkedin_agent'
    )
    op.add_column(
        'campaigns',
        sa.Column('is_archived', sa.Boolean(), nullable=False, server_default='false'),
        schema='linkedin_agent'
    )
    op.create_foreign_key(
        'fk_campaigns_audience_id_audiences',
        'campaigns',
        'audiences',
        ['audience_id'],
        ['id'],
        source_schema='linkedin_agent',
        referent_schema='linkedin_agent',
        ondelete='SET NULL'
    )
    op.create_index(
        op.f('ix_linkedin_agent_campaigns_audience_id'),
        'campaigns',
        ['audience_id'],
        unique=False,
        schema='linkedin_agent'
    )

    # 2. Add single_campaign_lock and daily_intake_limit to campaign_criteria
    op.add_column(
        'campaign_criteria',
        sa.Column('single_campaign_lock', sa.Boolean(), nullable=False, server_default='true'),
        schema='linkedin_agent'
    )
    op.add_column(
        'campaign_criteria',
        sa.Column('daily_intake_limit', sa.Integer(), nullable=False, server_default='20'),
        schema='linkedin_agent'
    )


def downgrade() -> None:
    op.drop_column('campaign_criteria', 'daily_intake_limit', schema='linkedin_agent')
    op.drop_column('campaign_criteria', 'single_campaign_lock', schema='linkedin_agent')
    op.drop_index(op.f('ix_linkedin_agent_campaigns_audience_id'), table_name='campaigns', schema='linkedin_agent')
    op.drop_constraint('fk_campaigns_audience_id_audiences', 'campaigns', schema='linkedin_agent', type_='foreignkey')
    op.drop_column('campaigns', 'is_archived', schema='linkedin_agent')
    op.drop_column('campaigns', 'audience_id', schema='linkedin_agent')
