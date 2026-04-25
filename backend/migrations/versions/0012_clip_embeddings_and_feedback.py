"""add clip embeddings and library feedback

Revision ID: 0012_clip_embeddings_feedback
Revises: 0011_library_embeddings
Create Date: 2026-04-25 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0012_clip_embeddings_feedback"
down_revision = "0011_library_embeddings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_media_embeddings_embedding_cosine")
    op.execute("DELETE FROM media_embeddings")
    op.execute("ALTER TABLE media_embeddings ALTER COLUMN embedding TYPE vector(512) USING embedding::vector(512)")
    op.execute(
        """
        CREATE INDEX ix_media_embeddings_embedding_cosine
        ON media_embeddings
        USING hnsw (embedding vector_cosine_ops)
        """
    )

    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_type WHERE typname = 'library_feedback_action_enum'
            ) THEN
                CREATE TYPE library_feedback_action_enum AS ENUM (
                    'accepted',
                    'rejected',
                    'auto_applied'
                );
            END IF;
        END
        $$;
        """
    )
    feedback_action = postgresql.ENUM(
        "accepted",
        "rejected",
        "auto_applied",
        name="library_feedback_action_enum",
        create_type=False,
    )
    op.create_table(
        "library_classification_feedback",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("media_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("media.id", ondelete="CASCADE"), nullable=False),
        sa.Column("entity_type", sa.String(length=32), nullable=False),
        sa.Column("suggested_entity_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("owned_entities.id", ondelete="SET NULL"), nullable=True),
        sa.Column("suggested_name", sa.String(length=512), nullable=False),
        sa.Column("series_name", sa.String(length=512), nullable=True),
        sa.Column("model_version", sa.String(length=64), nullable=False),
        sa.Column("action", feedback_action, nullable=False),
        sa.Column("source", sa.String(length=64), nullable=True),
        sa.Column("similarity", sa.Float(), nullable=True),
        sa.Column("explanation", sa.String(length=1024), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_library_classification_feedback_user_id", "library_classification_feedback", ["user_id"])
    op.create_index("ix_library_classification_feedback_media_id", "library_classification_feedback", ["media_id"])
    op.create_index(
        "ix_library_feedback_user_media_entity",
        "library_classification_feedback",
        ["user_id", "media_id", "entity_type"],
    )
    op.create_index(
        "ix_library_feedback_user_name_action",
        "library_classification_feedback",
        ["user_id", "entity_type", "suggested_name", "action"],
    )


def downgrade() -> None:
    op.drop_index("ix_library_feedback_user_name_action", table_name="library_classification_feedback")
    op.drop_index("ix_library_feedback_user_media_entity", table_name="library_classification_feedback")
    op.drop_index("ix_library_classification_feedback_media_id", table_name="library_classification_feedback")
    op.drop_index("ix_library_classification_feedback_user_id", table_name="library_classification_feedback")
    op.drop_table("library_classification_feedback")
    postgresql.ENUM(name="library_feedback_action_enum").drop(op.get_bind(), checkfirst=True)

    op.execute("DROP INDEX IF EXISTS ix_media_embeddings_embedding_cosine")
    op.execute("DELETE FROM media_embeddings")
    op.execute("ALTER TABLE media_embeddings ALTER COLUMN embedding TYPE vector(96) USING embedding::vector(96)")
    op.execute(
        """
        CREATE INDEX ix_media_embeddings_embedding_cosine
        ON media_embeddings
        USING hnsw (embedding vector_cosine_ops)
        """
    )
