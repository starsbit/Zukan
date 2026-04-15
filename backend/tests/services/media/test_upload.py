from __future__ import annotations

import io
import uuid
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import UploadFile

from backend.app.models.media import Media, MediaVisibility
from backend.app.models.processing import BatchStatus, ImportBatch, ImportBatchItem, ItemStatus, ProcessingStep
from backend.app.services.media.upload import (
    MediaPostProcessor,
    MediaUploadService,
    MediaUploadWorkflow,
    UploadBatchContext,
    calculate_batch_status,
)


def test_calculate_batch_status():
    assert calculate_batch_status(total=2, pending=1, processing=0, failed=0) == BatchStatus.running
    assert calculate_batch_status(total=2, pending=0, processing=0, failed=2) == BatchStatus.failed
    assert calculate_batch_status(total=2, pending=0, processing=0, failed=1) == BatchStatus.partial_failed
    assert calculate_batch_status(total=2, pending=0, processing=0, failed=0) == BatchStatus.done


@pytest.mark.asyncio
async def test_post_processor_uses_queue_when_available():
    processing = SimpleNamespace(run_ocr_for_media=AsyncMock())
    post = MediaPostProcessor(processing)
    queue = AsyncMock()

    with patch("backend.app.services.media.upload.get_tag_queue", return_value=queue):
        await post.dispatch([uuid.uuid4(), uuid.uuid4()])

    assert queue.put.await_count == 2
    processing.run_ocr_for_media.assert_not_awaited()


@pytest.mark.asyncio
async def test_post_processor_falls_back_to_ocr_when_no_queue():
    processing = SimpleNamespace(run_ocr_for_media=AsyncMock())
    post = MediaPostProcessor(processing)
    media_id = uuid.uuid4()

    with patch("backend.app.services.media.upload.get_tag_queue", return_value=None):
        await post.dispatch([media_id])

    processing.run_ocr_for_media.assert_awaited_once()



@pytest.mark.asyncio
async def test_handle_existing_media_duplicate_sets_skipped(fake_db, stub_query):
    workflow = MediaUploadWorkflow(
        db=fake_db,
        query=stub_query,
        tags_repo=SimpleNamespace(set_media_tag_links=AsyncMock()),
        post_processor=SimpleNamespace(dispatch=AsyncMock()),
    )
    batch_item = ImportBatchItem(batch_id=uuid.uuid4(), source_filename="f")
    existing = SimpleNamespace(id=uuid.uuid4(), deleted_at=None)
    ctx = UploadBatchContext()

    with patch("backend.app.services.media.upload.delete_media_files") as delete_files:
        await workflow._handle_existing_media(
            batch_item=batch_item,
            existing=existing,
            original_name="f",
            captured_at=datetime.now(timezone.utc),
            saved_path="/tmp/new.webp",
            ctx=ctx,
        )

    assert batch_item.status == ItemStatus.skipped
    assert ctx.duplicates == 1
    assert ctx.done_items == 1
    delete_files.assert_called_once_with("/tmp/new.webp")


@pytest.mark.asyncio
async def test_handle_new_media_with_manual_tags_marks_done(fake_db, stub_query, user):
    tags_repo = SimpleNamespace(set_media_tag_links=AsyncMock())
    workflow = MediaUploadWorkflow(
        db=fake_db,
        query=stub_query,
        tags_repo=tags_repo,
        post_processor=SimpleNamespace(dispatch=AsyncMock()),
    )
    batch_item = ImportBatchItem(batch_id=uuid.uuid4(), source_filename="f")
    saved = SimpleNamespace(
        path=Path("/tmp/new.webp"),
        file_size=10,
        sha256="b" * 64,
        mime_type="image/webp",
        media_type="image",
    )
    file_metadata = SimpleNamespace(width=100, height=100, duration_seconds=None, frame_count=None)
    ctx = UploadBatchContext()

    with patch("backend.app.services.media.upload.generate_poster_and_thumbnail", return_value=(None, None)):
        await workflow._handle_new_media(
            batch_item=batch_item,
            user=user,
            original_name="f",
            saved=saved,
            file_metadata=file_metadata,
            tags=["nsfw"],
            captured_at=datetime.now(timezone.utc),
            visibility=MediaVisibility.private,
            ctx=ctx,
        )

    assert batch_item.status == ItemStatus.done
    assert ctx.done_items == 1
    assert ctx.accepted == 1
    assert tags_repo.set_media_tag_links.await_count == 1
    created_media = next(item for item in fake_db.added if isinstance(item, Media))
    assert created_media is not None


@pytest.mark.asyncio
async def test_handle_new_media_with_manual_entities_marks_done_and_creates_manual_entities(fake_db, stub_query, user):
    tags_repo = SimpleNamespace(set_media_tag_links=AsyncMock())
    workflow = MediaUploadWorkflow(
        db=fake_db,
        query=stub_query,
        tags_repo=tags_repo,
        post_processor=SimpleNamespace(dispatch=AsyncMock()),
    )
    batch_item = ImportBatchItem(batch_id=uuid.uuid4(), source_filename="f")
    saved = SimpleNamespace(
        path=Path("/tmp/new.webp"),
        file_size=10,
        sha256="c" * 64,
        mime_type="image/webp",
        media_type="image",
    )
    file_metadata = SimpleNamespace(width=100, height=100, duration_seconds=None, frame_count=None)
    ctx = UploadBatchContext()

    with patch("backend.app.services.media.upload.generate_poster_and_thumbnail", return_value=(None, None)):
        await workflow._handle_new_media(
            batch_item=batch_item,
            user=user,
            original_name="f",
            saved=saved,
            file_metadata=file_metadata,
            tags=None,
            character_names=["Saber", "Saber", "  Rin  "],
            series_names=["Fate/stay night"],
            captured_at=datetime.now(timezone.utc),
            visibility=MediaVisibility.private,
            ctx=ctx,
        )

    assert batch_item.status == ItemStatus.done
    assert ctx.done_items == 1
    assert ctx.accepted == 1
    assert tags_repo.set_media_tag_links.await_count == 0
    entity_names = {(getattr(item, "entity_type", None), getattr(item, "name", None)) for item in fake_db.added}
    assert ("character", "Saber") in entity_names
    assert ("character", "Rin") in entity_names
    assert ("series", "Fate/stay night") in entity_names


@pytest.mark.asyncio
async def test_upload_service_marks_item_done_and_refreshes_batch(fake_db, stub_query):
    item = ImportBatchItem(batch_id=uuid.uuid4(), source_filename="f", status=ItemStatus.pending)
    batch = ImportBatch(user_id=uuid.uuid4(), type="upload", status=BatchStatus.running)
    statuses = [ItemStatus.done, ItemStatus.failed]

    stub_query.get_upload_batch_item_for_media.return_value = item
    stub_query.get_import_batch.return_value = batch
    stub_query.get_import_batch_statuses.return_value = statuses

    service = MediaUploadService(fake_db, processing=SimpleNamespace(), query=stub_query)
    with patch.object(service, "_auto_compute_recommendation_groups_for_batch", AsyncMock()) as auto_compute:
        await service.mark_upload_batch_item_done(uuid.uuid4())

    assert item.status == ItemStatus.done
    assert item.step == ProcessingStep.tag
    assert batch.total_items == 2
    assert batch.done_items == 1
    assert batch.failed_items == 1
    assert batch.status == BatchStatus.partial_failed
    auto_compute.assert_awaited_once_with(batch)
    fake_db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_upload_service_build_upload_response_proxies_upload_files(fake_db, stub_query):
    service = MediaUploadService(fake_db, processing=SimpleNamespace(), query=stub_query)

    expected = SimpleNamespace(batch_id=uuid.uuid4())
    with patch.object(service, "upload_files", AsyncMock(return_value=expected)) as upload_files:
        response = await service.build_upload_response(SimpleNamespace(), [])

    assert response is expected
    upload_files.assert_awaited_once()


@pytest.mark.asyncio
async def test_upload_service_upload_files_with_annotations_passes_annotation_fields(fake_db, stub_query):
    service = MediaUploadService(fake_db, processing=SimpleNamespace(), query=stub_query)
    expected = SimpleNamespace(batch_id=uuid.uuid4())

    with patch.object(MediaUploadWorkflow, "run", AsyncMock(return_value=expected)) as run:
        response = await service.upload_files_with_annotations(
            SimpleNamespace(id=uuid.uuid4()),
            [],
            tags=["safe"],
            character_names=["Saber"],
            series_names=["Fate/stay night"],
        )

    assert response is expected
    run.assert_awaited_once()
    kwargs = run.await_args.kwargs
    assert kwargs["tags"] == ["safe"]
    assert kwargs["character_names"] == ["Saber"]
    assert kwargs["series_names"] == ["Fate/stay night"]
