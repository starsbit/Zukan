"""Scope media sha256 uniqueness to uploader.

Revision ID: 0003_media_sha256_uniqueness_per_user
Revises: 0002_user_storage_quota
Create Date: 2026-04-07 00:00:00
"""

from __future__ import annotations

from alembic import op


revision = "0003_uniqueness_per_user"
down_revision = "0002_user_storage_quota"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Previous schema had a global unique index on sha256 via column-level unique.
    op.execute("DROP INDEX IF EXISTS ix_media_sha256")
    op.execute("CREATE INDEX IF NOT EXISTS ix_media_sha256 ON media (sha256)")
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_media_uploader_sha256
        ON media (uploader_id, sha256)
        WHERE uploader_id IS NOT NULL AND sha256 IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_media_uploader_sha256")
    op.execute("DROP INDEX IF EXISTS ix_media_sha256")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS ix_media_sha256 ON media (sha256)")
