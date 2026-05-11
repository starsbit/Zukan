"""Use copy-based collection upgrades.

Revision ID: 0018_copy_based_upgrades
Revises: 0017_gallery_scaling_indexes
Create Date: 2026-05-11 00:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0018_copy_based_upgrades"
down_revision = "0017_gallery_scaling_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("gacha_pull_items", "upgrade_material_granted")
    op.drop_column("user_collection_items", "upgrade_xp")


def downgrade() -> None:
    op.add_column(
        "user_collection_items",
        sa.Column("upgrade_xp", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "gacha_pull_items",
        sa.Column("upgrade_material_granted", sa.Integer(), nullable=False, server_default="0"),
    )
