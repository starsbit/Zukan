"""add embedding backfill batch type

Revision ID: 0013_embedding_backfill_batch
Revises: 0012_clip_embeddings_feedback
Create Date: 2026-04-25 00:00:00.000000
"""

from __future__ import annotations

from alembic import op


revision = "0013_embedding_backfill_batch"
down_revision = "0012_clip_embeddings_feedback"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE batch_type_enum ADD VALUE IF NOT EXISTS 'embedding_backfill'")
    op.execute("ALTER TYPE processing_step_enum ADD VALUE IF NOT EXISTS 'embedding'")


def downgrade() -> None:
    # PostgreSQL cannot remove enum values without recreating the type; leave them in place.
    pass
