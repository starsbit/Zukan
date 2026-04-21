"""Add media classification override columns.

Revision ID: 0010_media_flags
Revises: 0009_review_merge_batch_type
Create Date: 2026-04-20 00:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0010_media_flags"
down_revision = "0009_review_merge_batch_type"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("media", sa.Column("is_nsfw_override", sa.Boolean(), nullable=True))
    op.add_column("media", sa.Column("is_sensitive_override", sa.Boolean(), nullable=True))


def downgrade() -> None:
    op.drop_column("media", "is_sensitive_override")
    op.drop_column("media", "is_nsfw_override")
