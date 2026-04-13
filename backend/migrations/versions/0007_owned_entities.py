"""Add per-owner canonical entities for character and series metadata.

Revision ID: 0007_owned_entities
Revises: 0006_per_user_tags
Create Date: 2026-04-12 00:30:00
"""

from __future__ import annotations

from alembic import op


revision = "0007_owned_entities"
down_revision = "0006_per_user_tags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS owned_entities (
            id UUID PRIMARY KEY,
            owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            entity_type VARCHAR(32) NOT NULL,
            name VARCHAR(512) NOT NULL,
            normalized_name VARCHAR(512) NOT NULL,
            media_count INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_owned_entities_owner_type_normalized_name
        ON owned_entities (owner_user_id, entity_type, normalized_name)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_owned_entities_owner_type_media_count_name
        ON owned_entities (owner_user_id, entity_type, media_count, name)
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_owned_entities_owner_user_id ON owned_entities (owner_user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_owned_entities_entity_type ON owned_entities (entity_type)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_owned_entities_normalized_name ON owned_entities (normalized_name)")

    op.execute(
        """
        ALTER TABLE media_entities
        ADD CONSTRAINT fk_media_entities_entity_id_owned_entities
        FOREIGN KEY (entity_id) REFERENCES owned_entities(id) ON DELETE SET NULL
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_media_entities_entity_id_media_id ON media_entities (entity_id, media_id)")

    op.execute(
        """
        INSERT INTO owned_entities (id, owner_user_id, entity_type, name, normalized_name, media_count)
        SELECT
            gen_random_uuid(),
            COALESCE(m.owner_id, m.uploader_id) AS owner_user_id,
            me.entity_type,
            me.name,
            btrim(regexp_replace(lower(coalesce(me.name, '')), '[^a-z0-9]+', '_', 'g'), '_') AS normalized_name,
            0
        FROM media_entities me
        JOIN media m ON m.id = me.media_id
        WHERE COALESCE(m.owner_id, m.uploader_id) IS NOT NULL
        GROUP BY
            COALESCE(m.owner_id, m.uploader_id),
            me.entity_type,
            me.name,
            btrim(regexp_replace(lower(coalesce(me.name, '')), '[^a-z0-9]+', '_', 'g'), '_')
        ON CONFLICT (owner_user_id, entity_type, normalized_name) DO NOTHING
        """
    )

    op.execute(
        """
        UPDATE media_entities AS me
        SET entity_id = oe.id
        FROM media AS m,
             owned_entities AS oe
        WHERE m.id = me.media_id
          AND oe.owner_user_id = COALESCE(m.owner_id, m.uploader_id)
          AND oe.entity_type = me.entity_type
          AND oe.normalized_name = btrim(regexp_replace(lower(coalesce(me.name, '')), '[^a-z0-9]+', '_', 'g'), '_')
        """
    )

    op.execute("UPDATE owned_entities SET media_count = 0")
    op.execute(
        """
        UPDATE owned_entities AS oe
        SET media_count = counts.media_count
        FROM (
            SELECT me.entity_id, COUNT(DISTINCT me.media_id)::int AS media_count
            FROM media_entities me
            JOIN media m ON m.id = me.media_id
            WHERE me.entity_id IS NOT NULL
              AND m.deleted_at IS NULL
            GROUP BY me.entity_id
        ) AS counts
        WHERE counts.entity_id = oe.id
        """
    )
    op.execute("DELETE FROM owned_entities WHERE media_count <= 0")


def downgrade() -> None:
    raise RuntimeError("Migration 0007_owned_entities is irreversible")
