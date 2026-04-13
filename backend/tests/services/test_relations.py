from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from backend.app.models.relations import MediaEntity, MediaEntityType
from backend.app.schemas import EntityCreate, ExternalRefCreate
from backend.app.services.relations import RelationService
from backend.tests.services.conftest import ScalarResult


@pytest.mark.asyncio
async def test_replace_entities_deletes_old_and_adds_new(fake_db, media):
    service = RelationService(fake_db)

    with patch("backend.app.services.relations.MediaEntityRepository") as repo_cls:
        repo_cls.return_value.replace_media_entities = AsyncMock()
        await service.replace_entities(media, [EntityCreate(entity_type="character", name="new", role="primary")])

    repo_cls.return_value.replace_media_entities.assert_awaited_once()


@pytest.mark.asyncio
async def test_replace_external_refs_deletes_old_and_adds_new(fake_db, media):
    service = RelationService(fake_db)
    old_ref = SimpleNamespace(id=uuid.uuid4())

    with patch("backend.app.repositories.relations.MediaExternalRefRepository") as ref_repo_cls:
        ref_repo_cls.return_value.get_by_media = AsyncMock(return_value=[old_ref])
        await service.replace_external_refs(media, [ExternalRefCreate(provider="pixiv", external_id="1", url="u")])

    assert old_ref in fake_db.deleted


@pytest.mark.asyncio
async def test_clear_character_name_returns_updated_count(fake_db, user):
    service = RelationService(fake_db)
    owned_entity = SimpleNamespace(id=uuid.uuid4())
    row1 = SimpleNamespace(id=uuid.uuid4())
    row2 = SimpleNamespace(id=uuid.uuid4())
    e1 = SimpleNamespace()
    e2 = SimpleNamespace()

    fake_db.execute = AsyncMock(return_value=ScalarResult(rows=[row1, row2]))

    with patch("backend.app.services.relations.OwnedEntityRepository") as owned_repo_cls, patch(
        "backend.app.services.relations.MediaEntityRepository"
    ) as repo_cls:
        owned_repo = owned_repo_cls.return_value
        owned_repo.get_by_owner_type_name = AsyncMock(return_value=owned_entity)
        owned_repo.recount_entity_ids = AsyncMock()
        owned_repo.get_by_id = AsyncMock(return_value=None)
        repo_cls.return_value.get_entities_for_owned_entity = AsyncMock(return_value=[e1, e2])

        result = await service.clear_character_name(user, character_name="Saber")

    assert result.matched_media == 2
    assert result.updated_media == 2
    assert result.deleted_source is True
    assert fake_db.deleted == [e1, e2]


@pytest.mark.asyncio
async def test_clear_series_name_returns_updated_count(fake_db, user):
    service = RelationService(fake_db)
    owned_entity = SimpleNamespace(id=uuid.uuid4())
    row = SimpleNamespace(id=uuid.uuid4())
    entity = SimpleNamespace()
    fake_db.execute = AsyncMock(return_value=ScalarResult(rows=[row]))

    with patch("backend.app.services.relations.OwnedEntityRepository") as owned_repo_cls, patch(
        "backend.app.services.relations.MediaEntityRepository"
    ) as repo_cls:
        owned_repo = owned_repo_cls.return_value
        owned_repo.get_by_owner_type_name = AsyncMock(return_value=owned_entity)
        owned_repo.recount_entity_ids = AsyncMock()
        owned_repo.get_by_id = AsyncMock(return_value=owned_entity)
        repo_cls.return_value.get_entities_for_owned_entity = AsyncMock(return_value=[entity])

        result = await service.clear_series_name(user, series_name="Fate")

    assert result.matched_media == 1
    assert result.updated_media == 1
    assert result.deleted_source is False


@pytest.mark.asyncio
async def test_merge_character_name_repoints_source_rows_and_deletes_source_entity(fake_db, user):
    service = RelationService(fake_db)
    source_entity = SimpleNamespace(id=uuid.uuid4(), name="Saber")
    target_entity = SimpleNamespace(id=uuid.uuid4(), name="Artoria")
    media_row = SimpleNamespace(id=uuid.uuid4())
    source_link = MediaEntity(
        media_id=media_row.id,
        entity_type=MediaEntityType.character,
        entity_id=source_entity.id,
        name="Saber",
        role="primary",
        source="tagger",
        confidence=0.8,
        created_at=datetime.now(timezone.utc),
    )
    target_link = MediaEntity(
        media_id=media_row.id,
        entity_type=MediaEntityType.character,
        entity_id=target_entity.id,
        name="Artoria",
        role="primary",
        source="manual",
        confidence=0.6,
        created_at=datetime.now(timezone.utc),
    )
    fake_db.execute = AsyncMock(return_value=ScalarResult(rows=[media_row]))

    with patch("backend.app.services.relations.OwnedEntityRepository") as owned_repo_cls, patch(
        "backend.app.services.relations.MediaEntityRepository"
    ) as repo_cls:
        owned_repo = owned_repo_cls.return_value
        owned_repo.get_by_owner_type_name = AsyncMock(side_effect=[source_entity])
        owned_repo.get_or_create = AsyncMock(return_value=target_entity)
        owned_repo.recount_entity_ids = AsyncMock()
        owned_repo.get_by_id = AsyncMock(return_value=None)

        repo = repo_cls.return_value
        repo.get_entities_for_owned_entity = AsyncMock(side_effect=[[source_link], [target_link]])

        result = await service.merge_character_name(user, character_name="Saber", target_name="Artoria")

    assert result.matched_media == 1
    assert result.updated_media == 1
    assert result.deleted_source is True
    assert source_link in fake_db.deleted


@pytest.mark.asyncio
async def test_merge_series_name_repoints_to_new_target_when_missing(fake_db, user):
    service = RelationService(fake_db)
    source_entity = SimpleNamespace(id=uuid.uuid4(), name="Fate")
    target_entity = SimpleNamespace(id=uuid.uuid4(), name="Fate/stay night")
    media_row = SimpleNamespace(id=uuid.uuid4())
    source_link = MediaEntity(
        media_id=media_row.id,
        entity_type=MediaEntityType.series,
        entity_id=source_entity.id,
        name="Fate",
        role="primary",
        source="tagger",
        confidence=0.9,
        created_at=datetime.now(timezone.utc),
    )
    fake_db.execute = AsyncMock(return_value=ScalarResult(rows=[media_row]))

    with patch("backend.app.services.relations.OwnedEntityRepository") as owned_repo_cls, patch(
        "backend.app.services.relations.MediaEntityRepository"
    ) as repo_cls:
        owned_repo = owned_repo_cls.return_value
        owned_repo.get_by_owner_type_name = AsyncMock(side_effect=[source_entity])
        owned_repo.get_or_create = AsyncMock(return_value=target_entity)
        owned_repo.recount_entity_ids = AsyncMock()
        owned_repo.get_by_id = AsyncMock(return_value=None)

        repo = repo_cls.return_value
        repo.get_entities_for_owned_entity = AsyncMock(side_effect=[[source_link], []])

        result = await service.merge_series_name(user, series_name="Fate", target_name="Fate/stay night")

    assert result.matched_media == 1
    assert result.updated_media == 1
    assert result.deleted_source is True
    assert source_link.entity_id == target_entity.id
    assert source_link.name == "Fate/stay night"


@pytest.mark.asyncio
async def test_trash_media_by_character_name_tracks_trashed_and_already(fake_db, user):
    service = RelationService(fake_db)
    m1 = SimpleNamespace(deleted_at=None)
    m2 = SimpleNamespace(deleted_at=datetime.now(timezone.utc))
    fake_db.execute = AsyncMock(return_value=ScalarResult(rows=[m1, m2]))

    result = await service.trash_media_by_character_name(user, character_name="Saber")

    assert result.matched_media == 2
    assert result.trashed_media == 1
    assert result.already_trashed == 1
    fake_db.commit.assert_awaited_once()
