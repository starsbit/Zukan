"""Add per-user storage quota in MB.

Revision ID: 0002_user_storage_quota
Revises: 0001_release_baseline
Create Date: 2026-04-07 00:00:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0002_user_storage_quota"
down_revision = "0001_release_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    existing_columns = [c["name"] for c in inspect(conn).get_columns("users")]
    if "storage_quota_mb" not in existing_columns:
        op.add_column(
            "users",
            sa.Column("storage_quota_mb", sa.Integer(), nullable=False, server_default="10240"),
        )


def downgrade() -> None:
    op.drop_column("users", "storage_quota_mb")
