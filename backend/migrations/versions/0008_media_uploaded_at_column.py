"""Rename media created_at to uploaded_at and drop ingested_at.

Revision ID: 0008_media_uploaded_at_column
Revises: 0007_owned_entities
Create Date: 2026-04-15 00:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0008_media_uploaded_at_column"
down_revision = "0007_owned_entities"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("media")}

    if "created_at" in columns and "uploaded_at" not in columns:
        op.execute("ALTER TABLE media RENAME COLUMN created_at TO uploaded_at")
        op.execute("ALTER INDEX IF EXISTS ix_media_created_at RENAME TO ix_media_uploaded_at")
    elif "created_at" in columns and "uploaded_at" in columns:
        op.execute("ALTER TABLE media DROP COLUMN created_at")
        op.execute("DROP INDEX IF EXISTS ix_media_created_at")

    op.execute("ALTER TABLE media DROP COLUMN IF EXISTS ingested_at")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("media")}

    op.execute("ALTER TABLE media ADD COLUMN IF NOT EXISTS ingested_at TIMESTAMPTZ NULL")

    if "uploaded_at" in columns and "created_at" not in columns:
        op.execute("ALTER TABLE media RENAME COLUMN uploaded_at TO created_at")
        op.execute("ALTER INDEX IF EXISTS ix_media_uploaded_at RENAME TO ix_media_created_at")
