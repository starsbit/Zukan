"""Scope tags to a per-owner identity.

Revision ID: 0006_per_user_tags
Revises: 0005_entity_mgmt_idx
Create Date: 2026-04-12 00:00:00
"""

from __future__ import annotations

from alembic import op


revision = "0006_per_user_tags"
down_revision = "0005_entity_mgmt_idx"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE tags
        ADD COLUMN IF NOT EXISTS owner_user_id UUID NULL REFERENCES users(id) ON DELETE CASCADE
        """
    )

    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM media_tags mt
                JOIN media m ON m.id = mt.media_id
                WHERE COALESCE(m.owner_id, m.uploader_id) IS NULL
            ) THEN
                RAISE EXCEPTION 'Cannot migrate tags: some tagged media rows have neither owner_id nor uploader_id';
            END IF;
        END
        $$;
        """
    )

    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'tags_name_key'
            ) THEN
                ALTER TABLE tags DROP CONSTRAINT tags_name_key;
            END IF;
        END
        $$;
        """
    )
    op.execute("DROP INDEX IF EXISTS ix_tags_name")

    op.execute(
        """
        INSERT INTO tags (owner_user_id, name, category, media_count)
        SELECT DISTINCT
            COALESCE(m.owner_id, m.uploader_id) AS owner_user_id,
            t.name,
            t.category,
            0
        FROM tags t
        JOIN media_tags mt ON mt.tag_id = t.id
        JOIN media m ON m.id = mt.media_id
        WHERE t.owner_user_id IS NULL
          AND COALESCE(m.owner_id, m.uploader_id) IS NOT NULL
        """
    )

    op.execute(
        """
        UPDATE media_tags AS mt
        SET tag_id = new_tags.id
        FROM media AS m,
             tags AS old_tags,
             tags AS new_tags
        WHERE m.id = mt.media_id
          AND old_tags.id = mt.tag_id
          AND old_tags.owner_user_id IS NULL
          AND new_tags.owner_user_id = COALESCE(m.owner_id, m.uploader_id)
          AND new_tags.name = old_tags.name
          AND new_tags.category = old_tags.category
          AND new_tags.id <> old_tags.id
        """
    )

    op.execute("DELETE FROM tags WHERE owner_user_id IS NULL")

    op.execute("UPDATE tags SET media_count = 0")
    op.execute(
        """
        UPDATE tags AS t
        SET media_count = counts.media_count
        FROM (
            SELECT tag_id, COUNT(*)::int AS media_count
            FROM media_tags
            GROUP BY tag_id
        ) AS counts
        WHERE counts.tag_id = t.id
        """
    )
    op.execute("DELETE FROM tags WHERE media_count <= 0")

    op.execute("ALTER TABLE tags ALTER COLUMN owner_user_id SET NOT NULL")
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'uq_tags_owner_user_id_name'
            ) THEN
                ALTER TABLE tags
                ADD CONSTRAINT uq_tags_owner_user_id_name UNIQUE (owner_user_id, name);
            END IF;
        END
        $$;
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_tags_name ON tags (name)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_tags_owner_user_id ON tags (owner_user_id)")


def downgrade() -> None:
    raise RuntimeError("Migration 0006_per_user_tags is irreversible")
