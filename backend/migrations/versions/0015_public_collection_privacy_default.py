"""make collection privacy public by default

Revision ID: 0015_public_collection_default
Revises: 0014_gacha_collections_trades
Create Date: 2026-04-29 04:45:00.000000
"""

from alembic import op


revision = "0015_public_collection_default"
down_revision = "0014_gacha_collections_trades"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("user_collection_privacy", "visibility", server_default="public")


def downgrade() -> None:
    op.alter_column("user_collection_privacy", "visibility", server_default="private")
