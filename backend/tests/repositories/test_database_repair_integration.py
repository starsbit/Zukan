from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError

from backend.app.models.library_classification import (
    LibraryClassificationFeedback,
    LibraryClassificationFeedbackAction,
)
from backend.app.models.relations import MediaEntity, OwnedEntity
from backend.app.models.tags import MediaTag, Tag
from backend.app.services import database_repair
from backend.app.services.database_repair import repair_database_connection


@pytest.mark.asyncio
async def test_database_repair_merges_duplicate_tags_and_recounts_live_media(db_engine, db_session, make_user, make_media):
    user = await make_user()
    user_id = user.id
    media_with_both = await make_media(uploader_id=user.id)
    media_with_source_only = await make_media(uploader_id=user.id)
    deleted_media = await make_media(uploader_id=user.id, deleted=True)
    media_with_both_id = media_with_both.id
    media_with_source_only_id = media_with_source_only.id
    deleted_media_id = deleted_media.id

    await db_session.execute(text("ALTER TABLE tags DROP CONSTRAINT uq_tags_owner_user_id_name"))

    low_count = Tag(owner_user_id=user.id, name="multiple_girls", category=0, media_count=1)
    keep = Tag(owner_user_id=user.id, name="multiple_girls", category=4, media_count=10)
    db_session.add_all([low_count, keep])
    await db_session.flush()
    keep_id = keep.id
    db_session.add_all(
        [
            MediaTag(media_id=media_with_both.id, tag_id=low_count.id, confidence=0.7),
            MediaTag(media_id=media_with_both.id, tag_id=keep.id, confidence=0.9),
            MediaTag(media_id=media_with_source_only.id, tag_id=low_count.id, confidence=0.8),
            MediaTag(media_id=deleted_media.id, tag_id=keep.id, confidence=0.9),
        ]
    )
    await db_session.commit()

    async with db_engine.begin() as conn:
        await repair_database_connection(conn, ensure_constraints=True, probe=True)

    db_session.expire_all()
    tags = (
        await db_session.execute(
            select(Tag).where(Tag.owner_user_id == user_id, Tag.name == "multiple_girls")
        )
    ).scalars().all()
    assert len(tags) == 1
    assert tags[0].id == keep_id
    assert tags[0].media_count == 2

    media_tag_rows = (
        await db_session.execute(select(MediaTag).where(MediaTag.tag_id == keep_id))
    ).scalars().all()
    assert {row.media_id for row in media_tag_rows} == {media_with_both_id, media_with_source_only_id, deleted_media_id}

    constraint_exists = (
        await db_session.execute(
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
    ).scalar_one()
    assert constraint_exists is True


@pytest.mark.asyncio
async def test_database_repair_merges_owned_entities_and_repoints_feedback(db_engine, db_session, make_user, make_media):
    user = await make_user()
    user_id = user.id
    media_one = await make_media(uploader_id=user.id)
    media_two = await make_media(uploader_id=user.id)

    await db_session.execute(text("ALTER TABLE owned_entities DROP CONSTRAINT uq_owned_entities_owner_type_normalized_name"))

    source = OwnedEntity(
        id=uuid.uuid4(),
        owner_user_id=user.id,
        entity_type="character",
        name="Saber",
        normalized_name="saber",
        media_count=1,
    )
    keep = OwnedEntity(
        id=uuid.uuid4(),
        owner_user_id=user.id,
        entity_type="character",
        name="Artoria",
        normalized_name="saber",
        media_count=5,
    )
    db_session.add_all([source, keep])
    await db_session.flush()
    keep_id = keep.id
    db_session.add_all(
        [
            MediaEntity(media_id=media_one.id, entity_id=source.id, entity_type="character", name="Saber", role="primary", source="tagger"),
            MediaEntity(media_id=media_two.id, entity_id=keep.id, entity_type="character", name="Artoria", role="primary", source="manual"),
            LibraryClassificationFeedback(
                id=uuid.uuid4(),
                user_id=user.id,
                media_id=media_one.id,
                entity_type="character",
                suggested_entity_id=source.id,
                suggested_name="Saber",
                model_version="test",
                action=LibraryClassificationFeedbackAction.accepted,
            ),
        ]
    )
    await db_session.commit()

    async with db_engine.begin() as conn:
        await repair_database_connection(conn, ensure_constraints=True, probe=True)

    db_session.expire_all()
    entities = (
        await db_session.execute(
            select(OwnedEntity).where(
                OwnedEntity.owner_user_id == user_id,
                OwnedEntity.entity_type == "character",
                OwnedEntity.normalized_name == "saber",
            )
        )
    ).scalars().all()
    assert len(entities) == 1
    assert entities[0].id == keep_id
    assert entities[0].media_count == 2

    linked_count = (
        await db_session.execute(select(func.count()).select_from(MediaEntity).where(MediaEntity.entity_id == keep_id))
    ).scalar_one()
    assert linked_count == 2

    feedback = (await db_session.execute(select(LibraryClassificationFeedback))).scalar_one()
    assert feedback.suggested_entity_id == keep_id


@pytest.mark.asyncio
async def test_database_repair_reindexes_and_retries_failed_tag_probe():
    first_failure = IntegrityError("probe", {}, Exception("duplicate"))
    with (
        patch("backend.app.services.database_repair._acquire_repair_lock", AsyncMock()),
        patch("backend.app.services.database_repair._repair_tags", AsyncMock(return_value=0)),
        patch("backend.app.services.database_repair._repair_owned_entities", AsyncMock(return_value=0)),
        patch("backend.app.services.database_repair._probe_tag_upsert", AsyncMock(side_effect=[first_failure, None])) as probe,
        patch("backend.app.services.database_repair._reindex_tag_uniqueness", AsyncMock()) as reindex,
    ):
        repaired = await repair_database_connection(object(), ensure_constraints=True, probe=True)

    assert repaired == 0
    assert probe.await_count == 2
    reindex.assert_awaited_once()


@pytest.mark.asyncio
async def test_tag_repair_reindexes_lookup_indexes_before_mutating_tags():
    order: list[str] = []

    async def _has_columns(conn, table_name, columns):
        return table_name == "tags"

    async def _reindex_lookup(conn):
        order.append("reindex")

    async def _drop_unique(conn):
        order.append("drop_unique")

    async def _execute_rowcount(conn, sql):
        order.append("mutate")
        return 0

    with (
        patch("backend.app.services.database_repair._has_columns", AsyncMock(side_effect=_has_columns)),
        patch("backend.app.services.database_repair._drop_tag_uniqueness_constraint", AsyncMock(side_effect=_drop_unique)),
        patch("backend.app.services.database_repair._reindex_tag_lookup_indexes", AsyncMock(side_effect=_reindex_lookup)),
        patch("backend.app.services.database_repair._scalar_int", AsyncMock(return_value=1)),
        patch("backend.app.services.database_repair._execute_rowcount", AsyncMock(side_effect=_execute_rowcount)),
    ):
        await database_repair._repair_tags(object(), ensure_constraint=False)

    assert order == ["drop_unique", "reindex", "mutate"]


@pytest.mark.asyncio
async def test_tag_repair_drops_unique_index_before_dedupe():
    order: list[str] = []

    async def _has_columns(conn, table_name, columns):
        return table_name == "tags"

    async def _execute_rowcount(conn, sql):
        order.append("dedupe")
        return 0

    async def _drop_unique(conn):
        order.append("drop_unique")

    with (
        patch("backend.app.services.database_repair._has_columns", AsyncMock(side_effect=_has_columns)),
        patch("backend.app.services.database_repair._drop_tag_uniqueness_constraint", AsyncMock(side_effect=_drop_unique)),
        patch("backend.app.services.database_repair._reindex_tag_lookup_indexes", AsyncMock()),
        patch("backend.app.services.database_repair._scalar_int", AsyncMock(return_value=1)),
        patch("backend.app.services.database_repair._execute_rowcount", AsyncMock(side_effect=_execute_rowcount)),
    ):
        await database_repair._repair_tags(object(), ensure_constraint=False)

    assert order == ["drop_unique", "dedupe"]
