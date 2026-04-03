"""Add metadata review dismissed flag

Revision ID: 0003_review_dismissed
Revises: 0002_add_api_keys
Create Date: 2026-04-04 00:00:00

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0003_review_dismissed"
down_revision = "0002_add_api_keys"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("media")}

    if "metadata_review_dismissed" not in columns:
        op.add_column(
            "media",
            sa.Column(
                "metadata_review_dismissed",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ),
        )

    existing_indexes = {index["name"] for index in inspector.get_indexes("media")}
    if op.f("ix_media_metadata_review_dismissed") not in existing_indexes:
        op.create_index(
            op.f("ix_media_metadata_review_dismissed"),
            "media",
            ["metadata_review_dismissed"],
            unique=False,
        )


def downgrade() -> None:
    op.drop_index(op.f("ix_media_metadata_review_dismissed"), table_name="media")
    op.drop_column("media", "metadata_review_dismissed")
