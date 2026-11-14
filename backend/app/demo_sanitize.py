import asyncio
import logging
from sqlalchemy import text
from backend.app.config import settings
from backend.app.database.session import engine

logger = logging.getLogger(__name__)

UNSAFE_MEDIA_SQL = """DELETE FROM media
WHERE deleted_at IS NOT NULL
   OR COALESCE(is_nsfw_override, is_nsfw)
   OR COALESCE(is_sensitive_override, is_sensitive)"""

COUNTED_STEPS: tuple[tuple[str, str], ...] = (
    ("media", UNSAFE_MEDIA_SQL),
    ("tags", "DELETE FROM tags WHERE NOT EXISTS (SELECT 1 FROM media_tags WHERE media_tags.tag_id = tags.id)"),
    (
        "entities",
        """DELETE FROM owned_entities
WHERE NOT EXISTS (SELECT 1 FROM media_entities WHERE media_entities.entity_id = owned_entities.id)""",
    ),
    ("albums", "DELETE FROM albums WHERE NOT EXISTS (SELECT 1 FROM album_media WHERE album_media.album_id = albums.id)"),
)

STEPS: tuple[str, ...] = (
    "UPDATE tags SET media_count = (SELECT count(*) FROM media_tags WHERE media_tags.tag_id = tags.id)",
    """UPDATE owned_entities SET media_count = (
    SELECT count(DISTINCT media_id) FROM media_entities WHERE media_entities.entity_id = owned_entities.id)""",
    """UPDATE albums SET cover_media_id = (
    SELECT media_id FROM album_media WHERE album_media.album_id = albums.id ORDER BY position, media_id LIMIT 1)
WHERE cover_media_id IS NULL""",
    """UPDATE media SET review_suggested_characters = NULL, review_suggested_series = NULL,
    review_suggestions_computed_at = NULL""",
    "DELETE FROM auth_exchanges",
    "DELETE FROM refresh_tokens",
    "DELETE FROM auth_sessions",
    "DELETE FROM api_keys",
    "DELETE FROM notifications",
    "DELETE FROM import_batch_items",
    "DELETE FROM import_batches",
    "DELETE FROM storage_migrations",
    """UPDATE users SET username = 'demo', email = 'demo@localhost', hashed_password = '!demo',
    show_nsfw = false, show_sensitive = false, avatar_media_id = NULL, last_seen_announcement_id = NULL""",
    "UPDATE library_storage SET ingest_interval_seconds = 0, last_scan = NULL, last_ingest = NULL",
)


class DemoSanitizeError(RuntimeError):
    pass


async def sanitize_demo_connection(conn) -> dict[str, int]:
    if not settings.demo_mode:
        raise DemoSanitizeError("Refusing to sanitize: DEMO_MODE is not enabled")
    await conn.execute(text("SELECT pg_advisory_xact_lock(hashtext('zukan_demo_sanitize'))"))
    removed: dict[str, int] = {}
    removed["media"] = (await conn.execute(text(COUNTED_STEPS[0][1]))).rowcount
    for statement in STEPS[:2]:
        await conn.execute(text(statement))
    for name, statement in COUNTED_STEPS[1:]:
        removed[name] = (await conn.execute(text(statement))).rowcount
    for statement in STEPS[2:]:
        await conn.execute(text(statement))
    return removed


async def sanitize_demo_database() -> dict[str, int]:
    async with engine.begin() as conn:
        removed = await sanitize_demo_connection(conn)
    logger.info(
        "Demo database sanitized removed_media=%s removed_tags=%s removed_entities=%s removed_albums=%s",
        removed["media"],
        removed["tags"],
        removed["entities"],
        removed["albums"],
    )
    return removed


async def _main() -> None:
    from backend.app.database import init_db

    await init_db()
    await sanitize_demo_database()
    await engine.dispose()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(_main())
