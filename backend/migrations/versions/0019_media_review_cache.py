"""Add media review suggestion cache.

Revision ID: 0019_media_review_cache
Revises: 0018_copy_based_upgrades
Create Date: 2026-05-11 00:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0019_media_review_cache"
down_revision = "0018_copy_based_upgrades"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("media", sa.Column("review_suggested_characters", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column("media", sa.Column("review_suggested_series", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column("media", sa.Column("review_suggestions_computed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("media", "review_suggestions_computed_at")
    op.drop_column("media", "review_suggested_series")
    op.drop_column("media", "review_suggested_characters")
