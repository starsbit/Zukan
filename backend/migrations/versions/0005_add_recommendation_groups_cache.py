"""Add recommendation groups cache to import_batches

Revision ID: 0005_recommendation_cache
Revises: 0004_add_user_integrations
Create Date: 2026-04-05 00:00:00

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0005_recommendation_cache"
down_revision = "0004_add_user_integrations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_columns = {col["name"] for col in inspector.get_columns("import_batches")}

    if "recommendation_groups" not in existing_columns:
        op.add_column("import_batches", sa.Column("recommendation_groups", postgresql.JSONB(), nullable=True))

    if "recommendations_computed_at" not in existing_columns:
        op.add_column("import_batches", sa.Column("recommendations_computed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("import_batches", "recommendations_computed_at")
    op.drop_column("import_batches", "recommendation_groups")
