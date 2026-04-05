"""Add last synced timestamp to user integrations

Revision ID: 0007_last_synced_at
Revises: 0006_add_anilist_sync
Create Date: 2026-04-05 17:45:00

"""

from __future__ import annotations

from alembic import op


revision = "0007_last_synced_at"
down_revision = "0006_add_anilist_sync"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE IF EXISTS user_integrations
        ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ NULL
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE IF EXISTS user_integrations
        DROP COLUMN IF EXISTS last_synced_at
        """
    )
