from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from backend.app.errors.error import AppError
from backend.app.models.media import MediaVisibility
from backend.app.models.relations import MediaEntityType
from backend.app.schemas import EntityCreate, ExternalRefCreate, MediaMetadataUpdate, MediaUpdate
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
    payload = MediaUpdate(version=media.version, visibility=MediaVisibility.shared)
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
