from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from backend.app.errors.error import AppError
from backend.app.models.media import MediaVisibility
from backend.app.models.relations import MediaEntityType
from backend.app.models.relations import MediaEntity
from backend.app.schemas import EntityCreate, ExternalRefCreate, MediaEntityBatchUpdate, MediaMetadataUpdate, MediaUpdate
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
async def test_update_media_metadata_updates_fields_and_relations(fake_db, stub_query, media, user):
    old_entity = SimpleNamespace(id=1)
    old_ref = SimpleNamespace(id=2)
    expected_detail = SimpleNamespace(id=media.id)
    captured = datetime.now(timezone.utc)

    stub_query.get_owned_or_admin_media.return_value = media
    stub_query.get_media_entities.return_value = [old_entity]
    stub_query.get_media_external_refs.return_value = [old_ref]
    stub_query.get_media_with_relations.return_value = media
    stub_query.build_media_detail.return_value = expected_detail

    interactions = SimpleNamespace(_set_favorite_state=AsyncMock())
    payload = MediaUpdate(
        tags=["safe", "nsfw"],
        entities=[EntityCreate(entity_type=MediaEntityType.character, name="Saber", role="primary")],
        metadata=MediaMetadataUpdate(captured_at=captured),
        deleted=True,
        ocr_text_override="  corrected text  ",
        external_refs=[ExternalRefCreate(provider="pixiv", external_id="123", url="https://x")],
        visibility=MediaVisibility.public,
        favorited=True,
        version=media.version,
    )

    service = MediaMetadataService(fake_db, stub_query, interactions)

    with patch("backend.app.services.media.metadata.TagRepository") as repo_cls:
        repo = repo_cls.return_value
        repo.set_media_tag_links = AsyncMock()

        detail = await service.update_media_metadata(media.id, user, payload)

    assert detail is expected_detail
    assert media.captured_at == captured
    assert media.deleted_at is not None
    assert media.ocr_text_override == "  corrected text  "
    assert media.is_nsfw is True
    assert media.is_sensitive is False
    assert media.visibility == MediaVisibility.public
    assert old_entity in fake_db.deleted
    assert old_ref in fake_db.deleted
    assert interactions._set_favorite_state.await_count == 1
    fake_db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_update_metadata_with_public_fields_uses_active_media_access(fake_db, stub_query, media, user):
    payload = MediaUpdate(version=media.version)
    stub_query.get_active_media.return_value = media
    stub_query.get_media_with_relations.return_value = media
    stub_query.build_media_detail.return_value = SimpleNamespace(id=media.id)

    service = MediaMetadataService(fake_db, stub_query, SimpleNamespace(_set_favorite_state=AsyncMock()))
    await service.update_media_metadata(media.id, user, payload)

    stub_query.get_active_media.assert_awaited_once_with(media.id)
    stub_query.get_owned_or_admin_media.assert_not_called()


@pytest.mark.asyncio
async def test_update_metadata_visibility_requires_owner_access(fake_db, stub_query, media, user):
    payload = MediaUpdate(version=media.version, visibility=MediaVisibility.public)
    stub_query.get_owned_or_admin_media.return_value = media
    stub_query.get_media_with_relations.return_value = media
    stub_query.build_media_detail.return_value = SimpleNamespace(id=media.id)

    service = MediaMetadataService(fake_db, stub_query, SimpleNamespace(_set_favorite_state=AsyncMock()))
    await service.update_media_metadata(media.id, user, payload)

    stub_query.get_owned_or_admin_media.assert_awaited_once_with(media.id, user, trashed=None)
    stub_query.get_active_media.assert_not_called()


@pytest.mark.asyncio
async def test_bulk_update_visibility_updates_only_manageable_media(fake_db, stub_query, user):
    own_private = SimpleNamespace(id=1, uploader_id=user.id, visibility=MediaVisibility.private)
    own_public = SimpleNamespace(id=2, uploader_id=user.id, visibility=MediaVisibility.public)
    foreign_private = SimpleNamespace(id=3, uploader_id='someone-else', visibility=MediaVisibility.private)
    stub_query.get_media_by_ids.return_value = [own_private, own_public, foreign_private]

    service = MediaMetadataService(fake_db, stub_query, SimpleNamespace(_set_favorite_state=AsyncMock()))

    result = await service.bulk_update_visibility([1, 2, 3, 4], user, MediaVisibility.public)

    assert result.processed == 1
    assert result.skipped == 3
    assert own_private.visibility == MediaVisibility.public
    assert own_public.visibility == MediaVisibility.public
    assert foreign_private.visibility == MediaVisibility.private
    fake_db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_bulk_update_metadata_review_dismissed_updates_only_manageable_media(fake_db, stub_query, user):
    own_active = SimpleNamespace(id=1, uploader_id=user.id, metadata_review_dismissed=False)
    own_dismissed = SimpleNamespace(id=2, uploader_id=user.id, metadata_review_dismissed=True)
    foreign_active = SimpleNamespace(id=3, uploader_id='someone-else', metadata_review_dismissed=False)
    stub_query.get_media_by_ids.return_value = [own_active, own_dismissed, foreign_active]

    service = MediaMetadataService(fake_db, stub_query, SimpleNamespace(_set_favorite_state=AsyncMock()))

    result = await service.bulk_update_metadata_review_dismissed([1, 2, 3, 4], user, True)

    assert result.processed == 1
    assert result.skipped == 3
    assert own_active.metadata_review_dismissed is True
    assert own_dismissed.metadata_review_dismissed is True
    assert foreign_active.metadata_review_dismissed is False
    fake_db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_bulk_update_entities_replaces_only_requested_types(fake_db, stub_query, user):
    media_one = SimpleNamespace(id=uuid.uuid4(), uploader_id=user.id)
    media_two = SimpleNamespace(id=uuid.uuid4(), uploader_id=uuid.uuid4())
    old_character = MediaEntity(media_id=media_one.id, entity_type=MediaEntityType.character, name="Old Saber", role="primary", source="tagger")
    preserved_series = MediaEntity(media_id=media_one.id, entity_type=MediaEntityType.series, name="Fate/stay night", role="primary", source="tagger")
    foreign_character = MediaEntity(media_id=media_two.id, entity_type=MediaEntityType.character, name="Blocked", role="primary", source="tagger")
    stub_query.get_media_by_ids.return_value = [media_one, media_two]
    stub_query.get_media_entities = AsyncMock(side_effect=[
        [old_character, preserved_series],
        [foreign_character],
    ])

    service = MediaMetadataService(fake_db, stub_query, SimpleNamespace(_set_favorite_state=AsyncMock()))

    result = await service.bulk_update_entities(
        MediaEntityBatchUpdate(
            media_ids=[media_one.id, media_two.id, uuid.uuid4()],
            character_names=["  Saber  ", "Saber", "Rin"],
            series_names=None,
        ),
        user,
    )

    added_entities = [item for item in fake_db.added if isinstance(item, MediaEntity)]
    assert result.processed == 1
    assert result.skipped == 2
    assert old_character in fake_db.deleted
    assert preserved_series not in fake_db.deleted
    assert [entity.name for entity in added_entities] == ["Saber", "Rin"]
    assert all(entity.entity_type == MediaEntityType.character for entity in added_entities)
    fake_db.commit.assert_awaited_once()
