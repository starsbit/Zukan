from __future__ import annotations
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
import pytest
from backend.app.errors.error import AppError
from backend.app.models.relations import MediaEntityType
from backend.app.models.relations import MediaEntity
from backend.app.schemas import EntityCreate, ExternalRefCreate, MediaAnnotationBatchUpdate, MediaEntityBatchUpdate, MediaMetadataUpdate, MediaUpdate
from backend.app.services.media.metadata import MediaMetadataService

@pytest.mark.asyncio
async def test_update_media_metadata_raises_on_version_conflict(fake_db, stub_query, media, user):
    payload = MediaUpdate(version=999)
    stub_query.get_active_media.return_value = media

    service = MediaMetadataService(fake_db, stub_query, SimpleNamespace(_set_favorite_state=AsyncMock()))

    with pytest.raises(AppError) as exc:
        await service.update_media_metadata(media.id, user, payload)

    assert exc.value.status_code == 409
    fake_db.commit.assert_not_awaited()

@pytest.mark.asyncio
async def test_update_media_metadata_resets_captured_at_to_uploaded_at(fake_db, stub_query, media, user):
    expected_detail = SimpleNamespace(id=media.id)
    media.uploaded_at = datetime(2026, 4, 1, 10, 0, tzinfo=timezone.utc)
    media.captured_at = datetime(2026, 3, 1, 10, 0, tzinfo=timezone.utc)
    stub_query.get_media_for_management.return_value = media
    stub_query.get_media_with_relations.return_value = media
    stub_query.build_media_detail.return_value = expected_detail
    service = MediaMetadataService(fake_db, stub_query, SimpleNamespace(_set_favorite_state=AsyncMock()))
    detail = await service.update_media_metadata(media.id, user, MediaUpdate(metadata=MediaMetadataUpdate(captured_at=None), version=media.version))
    assert detail is expected_detail
    assert media.captured_at == media.uploaded_at

@pytest.mark.asyncio
async def test_update_media_metadata_allows_clearing_manual_classification_overrides(fake_db, stub_query, media, user):
    expected_detail = SimpleNamespace(id=media.id)
    media.is_nsfw_override = True
    media.is_sensitive_override = False
    stub_query.get_media_for_management.return_value = media
    stub_query.get_media_with_relations.return_value = media
    stub_query.build_media_detail.return_value = expected_detail
    service = MediaMetadataService(fake_db, stub_query, SimpleNamespace(_set_favorite_state=AsyncMock()))
    detail = await service.update_media_metadata(media.id, user, MediaUpdate(is_nsfw_override=None, is_sensitive_override=None, version=media.version))
    assert detail is expected_detail
    assert media.is_nsfw_override is None
    assert media.is_sensitive_override is None

@pytest.mark.asyncio
async def test_bulk_update_entities_replaces_only_requested_types(fake_db, stub_query, user):
    media_one = SimpleNamespace(id=uuid.uuid4())
    media_two = SimpleNamespace(id=uuid.uuid4())
    stub_query.get_media_by_ids.return_value = [media_one, media_two]
    service = MediaMetadataService(fake_db, stub_query, SimpleNamespace(_set_favorite_state=AsyncMock()))
    with patch('backend.app.services.media.metadata.MediaEntityRepository') as repo_cls:
        repo_cls.return_value.add_media_entities = AsyncMock()
        result = await service.bulk_update_entities(MediaEntityBatchUpdate(media_ids=[media_one.id, media_two.id, uuid.uuid4()], character_names=['  Saber  ', 'Saber', 'Rin'], series_names=None), user)
    assert result.processed == 2
    assert result.skipped == 1
    assert repo_cls.return_value.add_media_entities.await_count == 2
    fake_db.commit.assert_awaited_once()

@pytest.mark.asyncio
async def test_bulk_update_entities_dedupes_names_by_search_normalized_value(fake_db, stub_query, user):
    media = SimpleNamespace(id=uuid.uuid4())
    stub_query.get_media_by_ids.return_value = [media]
    service = MediaMetadataService(fake_db, stub_query, SimpleNamespace(_set_favorite_state=AsyncMock()))
    with patch('backend.app.services.media.metadata.MediaEntityRepository') as repo_cls:
        repo_cls.return_value.add_media_entities = AsyncMock()
        await service.bulk_update_entities(MediaEntityBatchUpdate(media_ids=[media.id], character_names=['Kazuki Kazami', 'Kazuki_Kazami', '  kazuki   kazami  '], series_names=['Grisaia no Kajitsu', 'grisaia_no_kajitsu']), user)
    assert repo_cls.return_value.add_media_entities.await_args_list[0].kwargs['names'] == ['Kazuki Kazami']
    assert repo_cls.return_value.add_media_entities.await_args_list[1].kwargs['names'] == ['Grisaia no Kajitsu']

@pytest.mark.asyncio
async def test_bulk_update_annotations_adds_and_removes_tags_with_remove_winning(fake_db, stub_query, user):
    media = SimpleNamespace(id=uuid.uuid4(), is_nsfw=True, is_sensitive=False)
    existing_safe = SimpleNamespace(tag=SimpleNamespace(name='safe', category=0), confidence=0.8)
    existing_old = SimpleNamespace(tag=SimpleNamespace(name='old_tag', category=3), confidence=0.6)
    stub_query.get_media_by_ids.return_value = [media]
    service = MediaMetadataService(fake_db, stub_query, SimpleNamespace(_set_favorite_state=AsyncMock()))
    with patch('backend.app.services.media.metadata.TagRepository') as repo_cls, patch('backend.app.services.media.metadata.MediaEntityRepository') as entity_repo_cls:
        repo_cls.return_value.get_media_tags_with_tag = AsyncMock(return_value=[existing_safe, existing_old])
        repo_cls.return_value.set_media_tag_links = AsyncMock()
        entity_repo_cls.return_value.mutate_media_entities = AsyncMock()
        result = await service.bulk_update_annotations(MediaAnnotationBatchUpdate(media_ids=[media.id], add_tags=['new tag', 'old tag'], remove_tags=['Old Tag']), user)
    assert result.processed == 1
    assert result.skipped == 0
    repo_cls.return_value.set_media_tag_links.assert_awaited_once_with(media, [('safe', 0, 0.8), ('new tag', 0, 1.0)], source='manual')
    assert media.is_nsfw is False
    assert media.is_sensitive is False
    entity_repo_cls.return_value.mutate_media_entities.assert_not_called()
    fake_db.commit.assert_awaited_once()

@pytest.mark.asyncio
async def test_bulk_update_annotations_mutates_characters_and_series_without_replacement(fake_db, stub_query, user):
    media = SimpleNamespace(id=uuid.uuid4())
    stub_query.get_media_by_ids.return_value = [media]
    service = MediaMetadataService(fake_db, stub_query, SimpleNamespace(_set_favorite_state=AsyncMock()))
    with patch('backend.app.services.media.metadata.TagRepository') as tag_repo_cls, patch('backend.app.services.media.metadata.MediaEntityRepository') as entity_repo_cls:
        tag_repo_cls.return_value.get_media_tags_with_tag = AsyncMock()
        tag_repo_cls.return_value.set_media_tag_links = AsyncMock()
        entity_repo_cls.return_value.mutate_media_entities = AsyncMock()
        result = await service.bulk_update_annotations(MediaAnnotationBatchUpdate(media_ids=[media.id], add_character_names=['  Saber  ', 'Saber'], remove_character_names=['Rin'], add_series_names=['Fate/stay night'], remove_series_names=['Tsukihime']), user)
    assert result.processed == 1
    assert entity_repo_cls.return_value.mutate_media_entities.await_count == 2
    assert entity_repo_cls.return_value.mutate_media_entities.await_args_list[0].kwargs == {'entity_type': MediaEntityType.character, 'add_names': ['Saber'], 'remove_names': ['Rin'], 'source': 'manual'}
    assert entity_repo_cls.return_value.mutate_media_entities.await_args_list[1].kwargs == {'entity_type': MediaEntityType.series, 'add_names': ['Fate/stay night'], 'remove_names': ['Tsukihime'], 'source': 'manual'}
    tag_repo_cls.return_value.set_media_tag_links.assert_not_called()
