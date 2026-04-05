"""Add AniList sync preferences and batch type

Revision ID: 0006_add_anilist_sync
Revises: 0005_recommendation_cache
Create Date: 2026-04-05 16:30:00

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0006_add_anilist_sync"
down_revision = "0005_recommendation_cache"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    columns = {column["name"] for column in inspector.get_columns("users")}
    if "anilist_import_visibility" not in columns:
        op.add_column(
            "users",
            sa.Column("anilist_import_visibility", sa.String(length=32), nullable=False, server_default="private"),
        )

    op.execute("ALTER TYPE batch_type_enum ADD VALUE IF NOT EXISTS 'anilist_sync'")


def downgrade() -> None:
    op.drop_column("users", "anilist_import_visibility")
