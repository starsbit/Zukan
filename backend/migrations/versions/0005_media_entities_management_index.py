"""Add composite index for metadata management lookups.

Revision ID: 0005_entity_mgmt_idx
Revises: 0004_welcome_notification
Create Date: 2026-04-11 00:00:00
"""

from __future__ import annotations

from alembic import op


revision = "0005_entity_mgmt_idx"
down_revision = "0004_welcome_notification"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_media_entities_type_name_media_id
        ON media_entities (entity_type, name, media_id)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_media_entities_type_name_media_id")
