"""First release schema baseline.

Revision ID: 0001_release_baseline
Revises:
Create Date: 2026-04-06 00:00:00
"""

from __future__ import annotations

from alembic import op

from backend.app.database.base import Base

# Ensure model metadata is loaded before create_all.
from backend.app.models import albums as _albums  # noqa: F401
from backend.app.models import auth as _auth  # noqa: F401
from backend.app.models import media as _media  # noqa: F401
from backend.app.models import media_interactions as _media_interactions  # noqa: F401
from backend.app.models import notifications as _notifications  # noqa: F401
from backend.app.models import processing as _processing  # noqa: F401
from backend.app.models import relations as _relations  # noqa: F401
from backend.app.models import tags as _tags  # noqa: F401


revision = "0001_release_baseline"
down_revision = "0010_sensitive_flags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind, checkfirst=True)

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_media_entities_type_name
        ON media_entities (entity_type, name)
        """
    )

    op.execute(
        """
        CREATE OR REPLACE FUNCTION fn_bump_version() RETURNS TRIGGER AS $$
        BEGIN
            NEW.version = OLD.version + 1;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
        """
    )
    for table in ("media", "albums", "users"):
        op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_version ON {table}")
        op.execute(
            f"""
            CREATE TRIGGER trg_{table}_version
            BEFORE UPDATE ON {table} FOR EACH ROW
            EXECUTE FUNCTION fn_bump_version()
            """
        )

    op.execute(
        """
        CREATE OR REPLACE FUNCTION fn_media_tag_after_delete() RETURNS TRIGGER AS $$
        BEGIN
            UPDATE tags SET media_count = media_count - 1 WHERE id = OLD.tag_id;
            DELETE FROM tags WHERE id = OLD.tag_id AND media_count <= 0;
            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql
        """
    )
    op.execute("DROP TRIGGER IF EXISTS trg_media_tag_after_delete ON media_tags")
    op.execute(
        """
        CREATE TRIGGER trg_media_tag_after_delete
        AFTER DELETE ON media_tags FOR EACH ROW
        EXECUTE FUNCTION fn_media_tag_after_delete()
        """
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION fn_media_tag_after_insert() RETURNS TRIGGER AS $$
        BEGIN
            UPDATE tags SET media_count = media_count + 1 WHERE id = NEW.tag_id;
            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql
        """
    )
    op.execute("DROP TRIGGER IF EXISTS trg_media_tag_after_insert ON media_tags")
    op.execute(
        """
        CREATE TRIGGER trg_media_tag_after_insert
        AFTER INSERT ON media_tags FOR EACH ROW
        EXECUTE FUNCTION fn_media_tag_after_insert()
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_media_tag_after_insert ON media_tags")
    op.execute("DROP TRIGGER IF EXISTS trg_media_tag_after_delete ON media_tags")
    op.execute("DROP TRIGGER IF EXISTS trg_media_version ON media")
    op.execute("DROP TRIGGER IF EXISTS trg_albums_version ON albums")
    op.execute("DROP TRIGGER IF EXISTS trg_users_version ON users")

    op.execute("DROP FUNCTION IF EXISTS fn_media_tag_after_insert()")
    op.execute("DROP FUNCTION IF EXISTS fn_media_tag_after_delete()")
    op.execute("DROP FUNCTION IF EXISTS fn_bump_version()")

    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind, checkfirst=True)
