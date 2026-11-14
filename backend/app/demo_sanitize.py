import asyncio
import logging
import uuid
from dataclasses import dataclass
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
    ("albums", "DELETE FROM albums"),
)

STEPS: tuple[str, ...] = (
    "UPDATE tags SET media_count = (SELECT count(*) FROM media_tags WHERE media_tags.tag_id = tags.id)",
    """UPDATE owned_entities SET media_count = (
    SELECT count(DISTINCT media_id) FROM media_entities WHERE media_entities.entity_id = owned_entities.id)""",
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


DEMO_ALBUM_NAMESPACE = uuid.UUID("5f0c3f4e-2a8b-4c1e-9d47-6b1f0a7e3c21")
DEMO_ALBUM_SIZE = 48


@dataclass(frozen=True)
class DemoAlbum:
    name: str
    description: str
    tags: tuple[str, ...]
    cover_tag: str | None = None


DEMO_ALBUMS: tuple[DemoAlbum, ...] = (
    DemoAlbum("Skies & Clouds", "Open skies, drifting clouds and the occasional sunset.", ("sky", "cloud"), "sunset"),
    DemoAlbum("School Days", "Uniforms, classrooms and after-school moments.", ("school_uniform",)),
    DemoAlbum("Kemonomimi", "Characters with animal ears.", ("animal_ears",)),
    DemoAlbum("Kimono", "Traditional Japanese outfits.", ("kimono",)),
    DemoAlbum("Snack Break", "Food, sweets and tea time.", ("food",)),
    DemoAlbum("Winter", "Snowy scenes and cold days.", ("snow",)),
)

CREATE_ALBUM_SQL = "INSERT INTO albums (id, name, description, version) VALUES (:id, :name, :description, 1)"

FILL_ALBUM_SQL = """INSERT INTO album_media (album_id, media_id, position)
SELECT CAST(:id AS uuid), picked.id, row_number() OVER (ORDER BY picked.captured_at DESC, picked.id) - 1
FROM (
    SELECT media.id, media.captured_at FROM media
    WHERE (
        SELECT count(DISTINCT tags.name) FROM media_tags JOIN tags ON tags.id = media_tags.tag_id
        WHERE media_tags.media_id = media.id AND tags.name = ANY(:tags)
    ) = cardinality(CAST(:tags AS text[]))
    ORDER BY media.captured_at DESC, media.id
    LIMIT :size
) AS picked"""

SET_ALBUM_COVER_SQL = """UPDATE albums SET cover_media_id = COALESCE(
    (SELECT album_media.media_id FROM album_media
     JOIN media_tags ON media_tags.media_id = album_media.media_id
     JOIN tags ON tags.id = media_tags.tag_id
     WHERE album_media.album_id = :id AND album_media.position > 0 AND tags.name = :cover_tag
     ORDER BY media_tags.confidence DESC, album_media.media_id LIMIT 1),
    (SELECT media_id FROM album_media WHERE album_id = :id ORDER BY position, media_id LIMIT 1))
WHERE id = :id"""

DROP_EMPTY_ALBUMS_SQL = "DELETE FROM albums WHERE NOT EXISTS (SELECT 1 FROM album_media WHERE album_media.album_id = albums.id)"


def demo_album_id(album: DemoAlbum) -> uuid.UUID:
    return uuid.uuid5(DEMO_ALBUM_NAMESPACE, album.name)


async def create_demo_albums(conn) -> None:
    for album in DEMO_ALBUMS:
        album_id = demo_album_id(album)
        await conn.execute(
            text(CREATE_ALBUM_SQL), {"id": album_id, "name": album.name, "description": album.description}
        )
        await conn.execute(text(FILL_ALBUM_SQL), {"id": album_id, "tags": list(album.tags), "size": DEMO_ALBUM_SIZE})
        await conn.execute(text(SET_ALBUM_COVER_SQL), {"id": album_id, "cover_tag": album.cover_tag})
    await conn.execute(text(DROP_EMPTY_ALBUMS_SQL))


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
    await create_demo_albums(conn)
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
