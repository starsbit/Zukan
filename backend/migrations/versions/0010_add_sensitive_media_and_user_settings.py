"""Add sensitive media classification and user settings

Revision ID: 0010_sensitive_flags
Revises: 0009_remove_anilist
Create Date: 2026-04-05 00:30:00

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0010_sensitive_flags"
down_revision = "0009_remove_anilist"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE media ADD COLUMN IF NOT EXISTS is_sensitive BOOLEAN NOT NULL DEFAULT false")
    op.execute("CREATE INDEX IF NOT EXISTS ix_media_is_sensitive ON media (is_sensitive)")
    op.execute("ALTER TABLE media ALTER COLUMN is_sensitive DROP DEFAULT")

    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS show_sensitive BOOLEAN NOT NULL DEFAULT false")
    op.execute("ALTER TABLE users ALTER COLUMN show_sensitive DROP DEFAULT")


def downgrade() -> None:
    op.drop_column("users", "show_sensitive")
    op.drop_index(op.f("ix_media_is_sensitive"), table_name="media")
    op.drop_column("media", "is_sensitive")
