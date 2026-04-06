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
    op.add_column("media", sa.Column("is_sensitive", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.create_index(op.f("ix_media_is_sensitive"), "media", ["is_sensitive"], unique=False)
    op.alter_column("media", "is_sensitive", server_default=None)

    op.add_column("users", sa.Column("show_sensitive", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.alter_column("users", "show_sensitive", server_default=None)


def downgrade() -> None:
    op.drop_column("users", "show_sensitive")
    op.drop_index(op.f("ix_media_is_sensitive"), table_name="media")
    op.drop_column("media", "is_sensitive")
