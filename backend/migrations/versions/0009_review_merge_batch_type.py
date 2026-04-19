"""Add review_merge batch type.

Revision ID: 0009_review_merge_batch_type
Revises: 0008_media_uploaded_at_column
Create Date: 2026-04-19 00:00:00
"""

from __future__ import annotations

from alembic import op


revision = "0009_review_merge_batch_type"
down_revision = "0008_media_uploaded_at_column"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE batch_type_enum ADD VALUE IF NOT EXISTS 'review_merge'")


def downgrade() -> None:
    # PostgreSQL enum value removal is intentionally not automated here.
    pass
