"""create_audiences_tables

Revision ID: e7b9a1c2d3e4
Revises: b8aebb4fbdff
Create Date: 2026-10-20 13:25:00.000000
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = 'e7b9a1c2d3e4'
down_revision: Union[str, None] = 'b8aebb4fbdff'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'audiences',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('owner_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('original_prompt', sa.Text(), nullable=False, server_default=''),
        sa.Column('filters_json', JSONB(), nullable=False, server_default='{}'),
        sa.Column('refresh_schedule', sa.String(length=50), nullable=False, server_default='daily'),
        sa.Column('last_refreshed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('is_archived', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['owner_id'], ['linkedin_agent.users.id'], name=op.f('fk_audiences_owner_id_users'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_audiences')),
        schema='linkedin_agent'
    )
    op.create_index(op.f('ix_linkedin_agent_audiences_owner_id'), 'audiences', ['owner_id'], unique=False, schema='linkedin_agent')
    op.create_index(op.f('ix_linkedin_agent_audiences_created_at'), 'audiences', ['created_at'], unique=False, schema='linkedin_agent')

    op.create_table(
        'audience_members',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('audience_id', sa.Integer(), nullable=False),
        sa.Column('person_id', sa.Integer(), nullable=False),
        sa.Column('fit_score', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('match_reason', sa.Text(), nullable=True),
        sa.Column('matched_criteria', JSONB(), nullable=False, server_default='[]'),
        sa.Column('excluded', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('exclusion_reason', sa.Text(), nullable=True),
        sa.Column('source', sa.String(length=50), nullable=False, server_default='search'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['audience_id'], ['linkedin_agent.audiences.id'], name=op.f('fk_audience_members_audience_id_audiences'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['person_id'], ['linkedin_agent.people.id'], name=op.f('fk_audience_members_person_id_people'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_audience_members')),
        sa.UniqueConstraint('audience_id', 'person_id', name='uq_audience_person'),
        schema='linkedin_agent'
    )
    op.create_index(op.f('ix_linkedin_agent_audience_members_audience_id'), 'audience_members', ['audience_id'], unique=False, schema='linkedin_agent')
    op.create_index(op.f('ix_linkedin_agent_audience_members_person_id'), 'audience_members', ['person_id'], unique=False, schema='linkedin_agent')
    op.create_index(op.f('ix_linkedin_agent_audience_members_created_at'), 'audience_members', ['created_at'], unique=False, schema='linkedin_agent')


def downgrade() -> None:
    op.drop_table('audience_members', schema='linkedin_agent')
    op.drop_table('audiences', schema='linkedin_agent')
