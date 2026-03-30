from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from backend.app.errors.error import AppError
from backend.app.services.media.processing import MediaProcessingService


@pytest.mark.asyncio
async def test_retag_media_rejects_if_already_pending(fake_db, stub_query, user):
    media_id = uuid.uuid4()
    stub_query.get_owned_or_admin_media.return_value = SimpleNamespace(
        id=media_id,
        tagging_status="pending",
        tagging_error="old",
    )

    service = MediaProcessingService(fake_db, stub_query)

    with pytest.raises(AppError) as exc:
        await service.retag_media(media_id, user)

    assert exc.value.status_code == 409
    fake_db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_retag_media_queues_job_when_available(fake_db, stub_query, user):
    media_id = uuid.uuid4()
    media = SimpleNamespace(id=media_id, tagging_status="done", tagging_error="old")
    stub_query.get_owned_or_admin_media.return_value = media
    queue = AsyncMock()

    service = MediaProcessingService(fake_db, stub_query)

    with patch("backend.app.services.media.processing.get_tag_queue", return_value=queue):
        queued = await service.retag_media(media_id, user)

    assert queued == 1
    assert media.tagging_status == "pending"
    assert media.tagging_error is None
    fake_db.commit.assert_awaited_once()
    queue.put.assert_awaited_once_with(media_id)


@pytest.mark.asyncio
async def test_bulk_retag_media_queues_only_manageable_ready_items(fake_db, stub_query, user):
    ready_id = uuid.uuid4()
    skipped_pending_id = uuid.uuid4()
    skipped_deleted_id = uuid.uuid4()
    skipped_foreign_id = uuid.uuid4()
    rows = [
        SimpleNamespace(id=ready_id, uploader_id=user.id, deleted_at=None, tagging_status="done", tagging_error="old"),
        SimpleNamespace(id=skipped_pending_id, uploader_id=user.id, deleted_at=None, tagging_status="pending", tagging_error="old"),
        SimpleNamespace(id=skipped_deleted_id, uploader_id=user.id, deleted_at=object(), tagging_status="done", tagging_error="old"),
        SimpleNamespace(id=skipped_foreign_id, uploader_id=uuid.uuid4(), deleted_at=None, tagging_status="done", tagging_error="old"),
    ]
    stub_query.get_media_by_ids.return_value = rows
    queue = AsyncMock()

    service = MediaProcessingService(fake_db, stub_query)

    with patch("backend.app.services.media.processing.get_tag_queue", return_value=queue):
        queued = await service.bulk_retag_media([row.id for row in rows], user)

    assert queued == 1
    assert rows[0].tagging_status == "pending"
    assert rows[0].tagging_error is None
    assert rows[1].tagging_status == "pending"
    assert rows[1].tagging_error == "old"
    fake_db.commit.assert_awaited_once()
    queue.put.assert_awaited_once_with(ready_id)


@pytest.mark.asyncio
async def test_mark_tagging_failure_handles_missing_media(fake_db, stub_query):
    stub_query.get_media_by_id.return_value = None
    service = MediaProcessingService(fake_db, stub_query)

    await service.mark_tagging_failure(uuid.uuid4(), RuntimeError("boom"))

    fake_db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_mark_tagging_failure_sets_status_and_error(fake_db, stub_query):
    media = SimpleNamespace(tagging_status="pending", tagging_error=None)
    stub_query.get_media_by_id.return_value = media
    service = MediaProcessingService(fake_db, stub_query)

    await service.mark_tagging_failure(uuid.uuid4(), RuntimeError("boom"))

    assert media.tagging_status == "failed"
    assert "RuntimeError" in media.tagging_error
    fake_db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_run_ocr_for_media_success(fake_db, stub_query):
    media = SimpleNamespace(id=uuid.uuid4(), deleted_at=None, filepath="/tmp/x.webp", media_type="image", ocr_text=None)
    stub_query.get_media_by_id.return_value = media
    ocr = SimpleNamespace(extract_text=AsyncMock(return_value="hello world"))

    service = MediaProcessingService(fake_db, stub_query)
    await service.run_ocr_for_media(media.id, ocr)

    assert media.ocr_text == "hello world"
    fake_db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_run_ocr_for_media_failure_is_swallowed(fake_db, stub_query):
    media = SimpleNamespace(id=uuid.uuid4(), deleted_at=None, filepath="/tmp/x.webp", media_type="image", ocr_text="old")
    stub_query.get_media_by_id.return_value = media
    ocr = SimpleNamespace(extract_text=AsyncMock(side_effect=RuntimeError("bad ocr")))

    service = MediaProcessingService(fake_db, stub_query)
    await service.run_ocr_for_media(media.id, ocr)

    assert media.ocr_text is None
    fake_db.commit.assert_awaited_once()
