from __future__ import annotations
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
import pytest
from sqlalchemy import select
from backend.app.errors.error import AppError
from backend.app.models.media import Media
from backend.app.models.processing import ItemStatus
from backend.app.schemas import MediaListState, MediaMetadataFilter, NsfwFilter, SensitiveFilter, TagFilterMode
from backend.app.services.media.query import MediaQueryService

class _ScalarListResult:
    def __init__(self, items):
        self._items = items

    def scalars(self):
        return self

    def all(self):
        return self._items

class _ScalarOneResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value

def _record_filter_value(seen: dict[str, str], key: str):
    def _inner(stmt, value):
        seen[key] = value
        return stmt

    return _inner

def _record_entity_filter_value(seen: dict[str, object], key: str):
    def _inner(stmt, values, mode):
        seen[key] = (values, mode)
        return stmt

    return _inner

@pytest.fixture
def service(fake_db):
    return MediaQueryService(fake_db)

@pytest.mark.asyncio
async def test_get_active_media_raises_for_deleted_or_missing(service, media):
    service._media_repo.get_by_id = AsyncMock(return_value=None)
    with pytest.raises(AppError):
        await service.get_active_media(media.id)

    media.deleted_at = datetime.now(timezone.utc)
    service._media_repo.get_by_id = AsyncMock(return_value=media)
    with pytest.raises(AppError):
        await service.get_active_media(media.id)

@pytest.mark.asyncio
async def test_repo_passthrough_methods(service):
    media_id = uuid.uuid4()
    service._media_repo.get_by_id = AsyncMock(return_value='m')
    service._media_repo.get_by_sha256 = AsyncMock(return_value='s')
    service._media_repo.get_by_ids = AsyncMock(return_value=['x'])
    service._media_repo.get_by_id_with_relations = AsyncMock(return_value='r')
    service._media_repo.get_expired_trash = AsyncMock(return_value=['e'])
    service._media_repo.get_active_ids = AsyncMock(return_value={media_id})
    assert await service.get_media_by_id(media_id) == 'm'
    assert await service.get_media_by_sha256('abc') == 's'
    assert await service.get_media_by_ids([media_id]) == ['x']
    assert await service.get_media_with_relations(media_id, deleted=None) == 'r'
    assert await service.get_expired_trash(datetime.now(timezone.utc)) == ['e']
    assert await service.get_active_media_ids([media_id]) == {media_id}

@pytest.mark.asyncio
async def test_execute_based_query_helpers(service, fake_db):
    media_id = uuid.uuid4()
    fake_db.execute = AsyncMock(side_effect=[_ScalarListResult([1]), _ScalarOneResult('item'), _ScalarListResult([ItemStatus.done])])
    fake_db.get = AsyncMock(return_value='batch')
    assert await service.list_trashed_media(SimpleNamespace(is_admin=True, id=uuid.uuid4())) == [1]
    assert await service.get_upload_batch_item_for_media(media_id) == 'item'
    assert await service.get_import_batch(uuid.uuid4()) == 'batch'
    assert await service.get_import_batch_statuses(uuid.uuid4()) == [ItemStatus.done]

@pytest.mark.asyncio
async def test_list_character_and_series_suggestions_and_downloadables(service, user, media):
    service._entity_repo.list_character_suggestions = AsyncMock(return_value=[{'name': 'Saber', 'media_count': 3}])
    service._entity_repo.list_series_suggestions = AsyncMock(return_value=[{'name': 'Fate/stay night', 'media_count': 2}])
    assert await service.list_character_suggestions(user, q='   ', limit=5) == []
    assert await service.list_character_suggestions(user, q=' sa ', limit=5) == [{'name': 'Saber', 'media_count': 3}]
    assert await service.list_series_suggestions(user, q='   ', limit=5) == []
    assert await service.list_series_suggestions(user, q=' fate ', limit=5) == [{'name': 'Fate/stay night', 'media_count': 2}]
    media.deleted_at = None
    user.id = user.id
    service._media_repo.get_by_ids = AsyncMock(return_value=[media])
    rows = await service.get_downloadable_media(user, [media.id])
    assert rows == [media]
    media.deleted_at = datetime.now(timezone.utc)
    with pytest.raises(AppError):
        await service.get_downloadable_media(user, [media.id])
