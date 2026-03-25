from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from backend.app.models.relations import MediaEntity
from backend.app.schemas import EntityCreate, ExternalRefCreate
from backend.app.services.relations import RelationService
from backend.tests.services.conftest import ScalarResult


@pytest.mark.asyncio
async def test_replace_entities_deletes_old_and_adds_new(fake_db, media):
    service = RelationService(fake_db)
    old_entity = MediaEntity(media_id=media.id, entity_type="character", name="old", role="primary", source="manual")

    with patch("backend.app.services.relations.MediaEntityRepository") as repo_cls:
        repo_cls.return_value.get_by_media = AsyncMock(return_value=[old_entity])
        await service.replace_entities(media, [EntityCreate(entity_type="character", name="new", role="primary")])

    assert old_entity in fake_db.deleted
    assert any(isinstance(item, MediaEntity) and item.name == "new" for item in fake_db.added)


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
    row1 = SimpleNamespace(id=uuid.uuid4())
    row2 = SimpleNamespace(id=uuid.uuid4())
    fake_db.execute = AsyncMock(return_value=ScalarResult(rows=[row1, row2]))

    e1 = SimpleNamespace()
    e2 = SimpleNamespace()
    with patch("backend.app.services.relations.MediaEntityRepository") as repo_cls:
        repo_cls.return_value.get_char_entities_by_name = AsyncMock(return_value=[e1, e2])
        result = await service.clear_character_name(user, character_name="Saber")

    assert result.matched_media == 2
    assert result.updated_media == 2
    assert fake_db.deleted == [e1, e2]


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
