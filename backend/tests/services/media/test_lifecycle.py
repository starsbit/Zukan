from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from backend.app.schemas import MediaIdsRequest
from backend.app.services.media.lifecycle import MediaLifecycleService


@pytest.mark.asyncio
async def test_purge_expired_trash_commits_only_when_items_exist(fake_db, stub_query):
    service = MediaLifecycleService(fake_db, stub_query)
    service.purge_media_record = AsyncMock()
    stub_query.get_expired_trash.return_value = [SimpleNamespace(), SimpleNamespace()]

    purged = await service.purge_expired_trash(datetime.now(timezone.utc))

    assert purged == 2
    assert service.purge_media_record.await_count == 2
    fake_db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_purge_expired_trash_no_rows_no_commit(fake_db, stub_query):
    service = MediaLifecycleService(fake_db, stub_query)
    stub_query.get_expired_trash.return_value = []

    purged = await service.purge_expired_trash()

    assert purged == 0
    fake_db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_soft_delete_and_restore_media_updates_deleted_at(fake_db, stub_query, media, user):
    service = MediaLifecycleService(fake_db, stub_query)
    stub_query.get_owned_or_admin_media.return_value = media

    await service.soft_delete_media(media.id, user)
    assert media.deleted_at is not None

    await service.restore_media(media.id, user)
    assert media.deleted_at is None
    assert fake_db.commit.await_count == 2


@pytest.mark.asyncio
async def test_batch_update_deleted_state_tracks_processed_and_skipped(fake_db, stub_query, user, media):
    other = SimpleNamespace(id=3, uploader_id=user.id, deleted_at=datetime.now(timezone.utc))
    foreign = SimpleNamespace(id=1, uploader_id="not-owner", deleted_at=None)
    missing_id = 2
    stub_query.get_media_by_ids.return_value = [media, other, foreign]

    service = MediaLifecycleService(fake_db, stub_query)
    processed, skipped = await service._batch_update_deleted_state([media.id, other.id, foreign.id, missing_id], True, user)

    assert processed == 1
    assert skipped == 3
    fake_db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_bulk_purge_media_skips_forbidden_or_missing(fake_db, stub_query, user):
    own_media = SimpleNamespace(id=1, uploader_id=user.id)
    forbidden = SimpleNamespace(id=2, uploader_id="someone-else")
    stub_query.get_media_by_ids.return_value = [own_media, forbidden]

    service = MediaLifecycleService(fake_db, stub_query)
    service.purge_media_record = AsyncMock()
    result = await service.bulk_purge_media([1, 2, 3], user)

    assert result.processed == 1
    assert result.skipped == 2
    service.purge_media_record.assert_awaited_once_with(own_media)


@pytest.mark.asyncio
async def test_purge_media_record_deletes_db_row_and_files(fake_db, stub_query, media):
    service = MediaLifecycleService(fake_db, stub_query)

    with patch("backend.app.services.media.lifecycle.MediaRepository") as repo_cls, patch(
        "backend.app.utils.storage.delete_media_files"
    ) as delete_files:
        repo = repo_cls.return_value
        repo.delete = AsyncMock()

        await service.purge_media_record(media)

        repo.delete.assert_awaited_once_with(media)
        delete_files.assert_called_once_with(media.filepath, media.poster_path, media.thumbnail_path)


@pytest.mark.asyncio
async def test_batch_purge_media_uses_payload_ids(fake_db, stub_query, user):
    media_id = uuid.uuid4()
    own_media = SimpleNamespace(id=media_id, uploader_id=user.id)
    stub_query.get_media_by_ids.return_value = [own_media]
    payload = MediaIdsRequest(media_ids=[media_id])

    service = MediaLifecycleService(fake_db, stub_query)
    service.purge_media_record = AsyncMock()

    result = await service.batch_purge_media(payload, user)

    assert result.processed == 1
    assert result.skipped == 0
    service.purge_media_record.assert_awaited_once_with(own_media)
