"""add library classification settings and media embeddings

Revision ID: 0011_library_embeddings
Revises: 0010_media_flags
Create Date: 2026-04-23 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0011_library_embeddings"
down_revision = "0010_media_flags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "library_classification_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )

    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute(
        """
        CREATE TABLE media_embeddings (
            media_id UUID PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
            uploader_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            embedding vector(96) NOT NULL,
            model_version VARCHAR(64) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.create_index("ix_media_embeddings_uploader_id", "media_embeddings", ["uploader_id"])
    op.execute(
        """
        CREATE INDEX ix_media_embeddings_embedding_cosine
        ON media_embeddings
        USING hnsw (embedding vector_cosine_ops)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_media_embeddings_embedding_cosine")
    op.drop_index("ix_media_embeddings_uploader_id", table_name="media_embeddings")
    op.execute("DROP TABLE IF EXISTS media_embeddings")
    op.drop_column("users", "library_classification_enabled")
