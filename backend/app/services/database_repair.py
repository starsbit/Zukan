"""Repair derived counts in the global library after schema migration."""

import logging
from sqlalchemy import text
from backend.app.config import settings
from backend.app.database.session import engine

logger = logging.getLogger(__name__)


async def repair_database_after_migrations():
    if settings.database_auto_repair_enabled:
        async with engine.begin() as connection:
            await repair_database_connection(
                connection, ensure_constraints=True, probe=True
            )


async def repair_database_connection(conn, *, ensure_constraints=True, probe=True):
    await conn.execute(
        text("SELECT pg_advisory_xact_lock(hashtext('zukan_database_auto_repair'))")
    )
    await conn.execute(
        text(
            "UPDATE tags SET media_count = (SELECT count(*) FROM media_tags WHERE tag_id = tags.id)"
        )
    )
    await conn.execute(
        text("""UPDATE owned_entities SET media_count = (
        SELECT count(DISTINCT me.media_id) FROM media_entities me JOIN media m ON m.id = me.media_id
        WHERE me.entity_id = owned_entities.id AND m.deleted_at IS NULL)""")
    )
    if probe:
        savepoint = await conn.begin_nested()
        try:
            await conn.execute(
                text("""INSERT INTO tags(name, category, media_count)
                VALUES ('__zukan_repair_probe__',0,0)
                ON CONFLICT ON CONSTRAINT uq_tags_name DO UPDATE SET category = tags.category""")
            )
        finally:
            await savepoint.rollback()
    return 0
