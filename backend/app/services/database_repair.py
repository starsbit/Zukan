from __future__ import annotations

import logging

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection

from backend.app.config import settings
from backend.app.database.session import engine

logger = logging.getLogger(__name__)

_ADVISORY_LOCK_KEY = "zukan_database_auto_repair"
_TAG_UPSERT_PROBE_NAME = "__zukan_repair_probe__"


async def repair_database_before_migrations() -> None:
    if not settings.database_auto_repair_enabled:
        logger.info("Database auto repair disabled before migrations")
        return

    async with engine.begin() as conn:
        repaired = await repair_database_connection(conn, ensure_constraints=False, probe=False)
        if repaired:
            logger.info("Pre-migration database repair completed")


async def repair_database_after_migrations() -> None:
    if not settings.database_auto_repair_enabled:
        logger.info("Database auto repair disabled after migrations")
        return

    async with engine.begin() as conn:
        changes = await repair_database_connection(conn, ensure_constraints=True, probe=True)

    if changes:
        logger.info(
            "Post-migration database repair completed changes=%s",
            changes,
        )


async def repair_database_connection(
    conn: AsyncConnection,
    *,
    ensure_constraints: bool,
    probe: bool,
) -> int:
    await _acquire_repair_lock(conn)
    tag_changes = await _repair_tags(conn, ensure_constraint=ensure_constraints)
    entity_changes = 0
    if ensure_constraints:
        entity_changes = await _repair_owned_entities(conn, ensure_constraint=True)
    if probe:
        try:
            await _probe_tag_upsert(conn)
        except IntegrityError:
            logger.warning(
                "Tag upsert probe failed after data repair; reindexing tag uniqueness indexes"
            )
            await _reindex_tag_uniqueness(conn)
            await _probe_tag_upsert(conn)
    return tag_changes + entity_changes


async def _acquire_repair_lock(conn: AsyncConnection) -> None:
    await conn.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": _ADVISORY_LOCK_KEY})


async def _repair_tags(conn: AsyncConnection, *, ensure_constraint: bool) -> int:
    if not await _has_columns(conn, "tags", {"id", "owner_user_id", "name", "media_count"}):
        return 0

    await _drop_tag_uniqueness_constraint(conn)
    await _reindex_tag_lookup_indexes(conn)

    changes = 0
    duplicate_groups = await _scalar_int(
        conn,
        """
        SELECT count(*)
        FROM (
            SELECT owner_user_id, name
            FROM tags
            GROUP BY owner_user_id, name
            HAVING count(*) > 1
        ) duplicates
        """,
    )
    if duplicate_groups:
        logger.warning("Repairing %s duplicate tag group(s)", duplicate_groups)

    if await _has_columns(conn, "media_tags", {"media_id", "tag_id"}):
        media_tag_has_ranking_columns = await _has_columns(conn, "media_tags", {"source", "confidence", "created_at"})
        changes += await _execute_rowcount(
            conn,
            """
            WITH ranked AS (
                SELECT
                    id,
                    first_value(id) OVER (
                        PARTITION BY owner_user_id, name
                        ORDER BY media_count DESC, id
                    ) AS keep_id
                FROM tags
            ),
            conflicts AS (
                SELECT mt.ctid
                FROM media_tags AS mt
                JOIN ranked ON ranked.id = mt.tag_id
                JOIN media_tags AS existing
                  ON existing.media_id = mt.media_id
                 AND existing.tag_id = ranked.keep_id
                WHERE ranked.id <> ranked.keep_id
            )
            DELETE FROM media_tags AS mt
            USING conflicts
            WHERE mt.ctid = conflicts.ctid
            """,
        )
        changes += await _execute_rowcount(
            conn,
            """
            WITH ranked AS (
                SELECT
                    id,
                    first_value(id) OVER (
                        PARTITION BY owner_user_id, name
                        ORDER BY media_count DESC, id
                    ) AS keep_id
                FROM tags
            )
            UPDATE media_tags AS mt
            SET tag_id = ranked.keep_id
            FROM ranked
            WHERE mt.tag_id = ranked.id
              AND ranked.id <> ranked.keep_id
            """,
        )
        if media_tag_has_ranking_columns:
            changes += await _execute_rowcount(
                conn,
                """
                DELETE FROM media_tags AS mt
                USING (
                    SELECT
                        ctid,
                        row_number() OVER (
                            PARTITION BY media_id, tag_id
                            ORDER BY
                                CASE source
                                    WHEN 'manual' THEN 0
                                    WHEN 'imported' THEN 1
                                    ELSE 2
                                END,
                                confidence DESC,
                                created_at DESC NULLS LAST,
                                ctid
                        ) AS row_number
                    FROM media_tags
                ) AS ranked
                WHERE mt.ctid = ranked.ctid
                  AND ranked.row_number > 1
                """,
            )
        else:
            changes += await _execute_rowcount(
                conn,
                """
                DELETE FROM media_tags AS mt
                USING (
                    SELECT
                        ctid,
                        row_number() OVER (
                            PARTITION BY media_id, tag_id
                            ORDER BY ctid
                        ) AS row_number
                    FROM media_tags
                ) AS ranked
                WHERE mt.ctid = ranked.ctid
                  AND ranked.row_number > 1
                """,
            )

    changes += await _execute_rowcount(
        conn,
        """
        WITH ranked AS (
            SELECT
                id,
                first_value(id) OVER (
                    PARTITION BY owner_user_id, name
                    ORDER BY media_count DESC, id
                ) AS keep_id
            FROM tags
        )
        DELETE FROM tags AS t
        USING ranked
        WHERE t.id = ranked.id
          AND ranked.id <> ranked.keep_id
        """,
    )

    if await _has_columns(conn, "media_tags", {"media_id", "tag_id"}) and await _has_columns(conn, "media", {"id", "deleted_at"}):
        await conn.execute(text("UPDATE tags SET media_count = 0"))
        changes += await _execute_rowcount(
            conn,
            """
            UPDATE tags AS t
            SET media_count = counts.media_count
            FROM (
                SELECT mt.tag_id, count(DISTINCT m.id)::int AS media_count
                FROM media_tags AS mt
                JOIN media AS m ON m.id = mt.media_id
                WHERE m.deleted_at IS NULL
                GROUP BY mt.tag_id
            ) AS counts
            WHERE counts.tag_id = t.id
              AND t.media_count IS DISTINCT FROM counts.media_count
            """,
        )

    if ensure_constraint:
        await conn.execute(
            text(
                """
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint
                        WHERE conname = 'uq_tags_owner_user_id_name'
                          AND conrelid = 'public.tags'::regclass
                    ) THEN
                        IF to_regclass('public.uq_tags_owner_user_id_name') IS NOT NULL THEN
                            ALTER TABLE tags
                            ADD CONSTRAINT uq_tags_owner_user_id_name
                            UNIQUE USING INDEX uq_tags_owner_user_id_name;
                        ELSE
                            ALTER TABLE tags
                            ADD CONSTRAINT uq_tags_owner_user_id_name
                            UNIQUE (owner_user_id, name);
                        END IF;
                    END IF;
                END
                $$;
                """
            )
        )

    return changes


async def _repair_owned_entities(conn: AsyncConnection, *, ensure_constraint: bool) -> int:
    if not await _has_columns(
        conn,
        "owned_entities",
        {"id", "owner_user_id", "entity_type", "normalized_name", "media_count", "updated_at"},
    ):
        return 0

    changes = 0
    duplicate_groups = await _scalar_int(
        conn,
        """
        SELECT count(*)
        FROM (
            SELECT owner_user_id, entity_type, normalized_name
            FROM owned_entities
            GROUP BY owner_user_id, entity_type, normalized_name
            HAVING count(*) > 1
        ) duplicates
        """,
    )
    if duplicate_groups:
        logger.warning("Repairing %s duplicate owned entity group(s)", duplicate_groups)

    if await _has_columns(conn, "media_entities", {"entity_id"}):
        changes += await _execute_rowcount(
            conn,
            """
            WITH ranked AS (
                SELECT
                    id,
                    first_value(id) OVER (
                        PARTITION BY owner_user_id, entity_type, normalized_name
                        ORDER BY media_count DESC, updated_at DESC NULLS LAST, id
                    ) AS keep_id
                FROM owned_entities
            )
            UPDATE media_entities AS me
            SET entity_id = ranked.keep_id
            FROM ranked
            WHERE me.entity_id = ranked.id
              AND ranked.id <> ranked.keep_id
            """,
        )

    if await _has_columns(conn, "library_classification_feedback", {"suggested_entity_id"}):
        changes += await _execute_rowcount(
            conn,
            """
            WITH ranked AS (
                SELECT
                    id,
                    first_value(id) OVER (
                        PARTITION BY owner_user_id, entity_type, normalized_name
                        ORDER BY media_count DESC, updated_at DESC NULLS LAST, id
                    ) AS keep_id
                FROM owned_entities
            )
            UPDATE library_classification_feedback AS feedback
            SET suggested_entity_id = ranked.keep_id
            FROM ranked
            WHERE feedback.suggested_entity_id = ranked.id
              AND ranked.id <> ranked.keep_id
            """,
        )

    changes += await _execute_rowcount(
        conn,
        """
        WITH ranked AS (
            SELECT
                id,
                first_value(id) OVER (
                    PARTITION BY owner_user_id, entity_type, normalized_name
                    ORDER BY media_count DESC, updated_at DESC NULLS LAST, id
                ) AS keep_id
            FROM owned_entities
        )
        DELETE FROM owned_entities AS oe
        USING ranked
        WHERE oe.id = ranked.id
          AND oe.id <> ranked.keep_id
        """,
    )

    if await _has_columns(conn, "media_entities", {"media_id", "entity_id"}) and await _has_columns(conn, "media", {"id", "deleted_at"}):
        await conn.execute(text("UPDATE owned_entities SET media_count = 0"))
        changes += await _execute_rowcount(
            conn,
            """
            UPDATE owned_entities AS oe
            SET media_count = counts.media_count
            FROM (
                SELECT me.entity_id, count(DISTINCT m.id)::int AS media_count
                FROM media_entities AS me
                JOIN media AS m ON m.id = me.media_id
                WHERE me.entity_id IS NOT NULL
                  AND m.deleted_at IS NULL
                GROUP BY me.entity_id
            ) AS counts
            WHERE counts.entity_id = oe.id
              AND oe.media_count IS DISTINCT FROM counts.media_count
            """,
        )

    if ensure_constraint:
        await conn.execute(
            text(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS uq_owned_entities_owner_type_normalized_name
                ON owned_entities (owner_user_id, entity_type, normalized_name)
                """
            )
        )

    return changes


async def _probe_tag_upsert(conn: AsyncConnection) -> None:
    if not await _has_columns(conn, "tags", {"owner_user_id", "name", "category", "media_count"}):
        return
    if not await _has_columns(conn, "users", {"id"}):
        return
    if not await _tag_constraint_exists(conn):
        return

    nested = await conn.begin_nested()
    try:
        await conn.execute(
            text(
                """
                INSERT INTO tags (owner_user_id, name, category, media_count)
                SELECT id, :probe_name, 0, 0
                FROM users
                ORDER BY id
                LIMIT 1
                ON CONFLICT ON CONSTRAINT uq_tags_owner_user_id_name
                DO UPDATE SET category = tags.category
                RETURNING id
                """
            ),
            {"probe_name": _TAG_UPSERT_PROBE_NAME},
        )
    except Exception:
        await nested.rollback()
        raise
    else:
        await nested.rollback()


async def _reindex_tag_uniqueness(conn: AsyncConnection) -> None:
    if await _index_exists(conn, "uq_tags_owner_user_id_name"):
        logger.info("Reindexing tag uniqueness index after database repair index=uq_tags_owner_user_id_name")
        await conn.execute(text("REINDEX INDEX public.uq_tags_owner_user_id_name"))
    await conn.execute(text("REINDEX INDEX public.tags_pkey"))


async def _drop_tag_uniqueness_constraint(conn: AsyncConnection) -> None:
    if await _tag_constraint_exists(conn):
        logger.warning("Dropping tag uniqueness constraint before database repair")
        await conn.execute(text("ALTER TABLE tags DROP CONSTRAINT uq_tags_owner_user_id_name"))
    if await _index_exists(conn, "uq_tags_owner_user_id_name"):
        logger.warning("Dropping standalone tag uniqueness index before database repair")
        await conn.execute(text("DROP INDEX public.uq_tags_owner_user_id_name"))


async def _reindex_tag_lookup_indexes(conn: AsyncConnection) -> None:
    for index_name in ("ix_tags_name", "ix_tags_owner_user_id"):
        if await _index_exists(conn, index_name):
            logger.info("Reindexing tag lookup index before database repair index=%s", index_name)
            await conn.execute(text(f"REINDEX INDEX public.{index_name}"))


async def _index_exists(conn: AsyncConnection, index_name: str) -> bool:
    result = await conn.execute(text("SELECT to_regclass(:index_name) IS NOT NULL"), {"index_name": f"public.{index_name}"})
    return bool(result.scalar_one())


async def _tag_constraint_exists(conn: AsyncConnection) -> bool:
    result = await conn.execute(
        text(
            """
            SELECT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'uq_tags_owner_user_id_name'
                  AND conrelid = 'public.tags'::regclass
            )
            """
        )
    )
    return bool(result.scalar_one())


async def _has_columns(conn: AsyncConnection, table_name: str, columns: set[str]) -> bool:
    if not await _has_table(conn, table_name):
        return False
    result = await conn.execute(
        text(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = :table_name
            """
        ),
        {"table_name": table_name},
    )
    existing = {str(row.column_name) for row in result}
    return columns.issubset(existing)


async def _has_table(conn: AsyncConnection, table_name: str) -> bool:
    result = await conn.execute(text("SELECT to_regclass(:table_name) IS NOT NULL"), {"table_name": f"public.{table_name}"})
    return bool(result.scalar_one())


async def _scalar_int(conn: AsyncConnection, sql: str) -> int:
    result = await conn.execute(text(sql))
    return int(result.scalar_one() or 0)


async def _execute_rowcount(conn: AsyncConnection, sql: str) -> int:
    result = await conn.execute(text(sql))
    return max(0, int(result.rowcount or 0))
