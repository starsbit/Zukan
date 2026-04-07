"""Add welcome notification type.

Revision ID: 0004_add_welcome_notification_type
Revises: 0003_uniqueness_per_user
Create Date: 2026-04-07 00:00:00
"""

from __future__ import annotations

from alembic import op


revision = "0004_welcome_notification"
down_revision = "0003_uniqueness_per_user"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'welcome'")


def downgrade() -> None:
    pass
