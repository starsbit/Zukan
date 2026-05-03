"""Add gallery scaling indexes.

Revision ID: 0017_gallery_scaling_indexes
Revises: 0016_gacha_discard_reimbursement_reasons
Create Date: 2026-05-03 00:00:00
"""

from __future__ import annotations

from alembic import op


revision = "0017_gallery_scaling_indexes"
down_revision = "0016_gacha_discard_reimbursement"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_media_active_captured_browse
        ON media ((coalesce(captured_at, uploaded_at)) DESC, id DESC)
        WHERE deleted_at IS NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_media_active_uploaded_browse
        ON media (uploaded_at DESC, id DESC)
        WHERE deleted_at IS NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_media_active_uploaded_browse")
    op.execute("DROP INDEX IF EXISTS idx_media_active_captured_browse")
