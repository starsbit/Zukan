from __future__ import annotations
import io
import uuid
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
import pytest
from fastapi import UploadFile
from backend.app.models.media import Media
from backend.app.models.relations import MediaExternalRef
from backend.app.models.processing import BatchStatus, ImportBatch, ImportBatchItem, ItemStatus, ProcessingStep
from backend.app.schemas import ExternalRefCreate
from backend.app.services.media.upload import MediaPostProcessor, MediaUploadService, MediaUploadWorkflow, UploadBatchContext, calculate_batch_status

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
        with patch.object(workflow, "_replace_external_refs", AsyncMock()) as replace_external_refs:
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
    replace_external_refs.assert_not_awaited()

@pytest.mark.asyncio
async def test_handle_existing_media_restored_replaces_external_refs_when_supplied(fake_db, stub_query):
    workflow = MediaUploadWorkflow(
        db=fake_db,
        query=stub_query,
        tags_repo=SimpleNamespace(set_media_tag_links=AsyncMock()),
        post_processor=SimpleNamespace(dispatch=AsyncMock()),
    )
    batch_item = ImportBatchItem(batch_id=uuid.uuid4(), source_filename="f")
    existing = SimpleNamespace(
        id=uuid.uuid4(),
        deleted_at=datetime.now(timezone.utc),
        original_filename="old.webp",
        tagging_status="pending",
        tagging_error="bad",
        captured_at=datetime.now(timezone.utc),
    )
    ctx = UploadBatchContext()
    old_ref = SimpleNamespace(id=uuid.uuid4())

    with patch("backend.app.services.media.upload.delete_media_files") as delete_files, patch(
        "backend.app.repositories.relations.MediaExternalRefRepository"
    ) as ref_repo_cls:
        ref_repo_cls.return_value.get_by_media = AsyncMock(return_value=[old_ref])
        await workflow._handle_existing_media(
            batch_item=batch_item,
            existing=existing,
            original_name="f",
            captured_at=datetime.now(timezone.utc),
            saved_path="/tmp/new.webp",
            external_refs=[ExternalRefCreate(provider="twitter", url="https://x.com/example/status/1")],
            ctx=ctx,
        )

    delete_files.assert_called_once_with("/tmp/new.webp")
    assert old_ref in fake_db.deleted
    external_refs = [item for item in fake_db.added if isinstance(item, MediaExternalRef)]
    assert len(external_refs) == 1
    assert external_refs[0].provider == "twitter"
    assert existing.deleted_at is None

@pytest.mark.asyncio
async def test_handle_existing_media_restored_preserves_external_refs_when_omitted(fake_db, stub_query):
    workflow = MediaUploadWorkflow(
        db=fake_db,
        query=stub_query,
        tags_repo=SimpleNamespace(set_media_tag_links=AsyncMock()),
        post_processor=SimpleNamespace(dispatch=AsyncMock()),
    )
    batch_item = ImportBatchItem(batch_id=uuid.uuid4(), source_filename="f")
    existing = SimpleNamespace(
        id=uuid.uuid4(),
        deleted_at=datetime.now(timezone.utc),
        original_filename="old.webp",
        tagging_status="pending",
        tagging_error="bad",
        captured_at=datetime.now(timezone.utc),
    )
    ctx = UploadBatchContext()

    with patch("backend.app.services.media.upload.delete_media_files"), patch.object(
        workflow, "_replace_external_refs", AsyncMock()
    ) as replace_external_refs:
        await workflow._handle_existing_media(
            batch_item=batch_item,
            existing=existing,
            original_name="f",
            captured_at=datetime.now(timezone.utc),
            saved_path="/tmp/new.webp",
            external_refs=None,
            ctx=ctx,
        )

    replace_external_refs.assert_not_awaited()

@pytest.mark.asyncio
async def test_upload_service_marks_item_done_and_refreshes_batch(fake_db, stub_query):
    item = ImportBatchItem(batch_id=uuid.uuid4(), source_filename='f', status=ItemStatus.pending)
    batch = ImportBatch(type='upload', status=BatchStatus.running)
    statuses = [ItemStatus.done, ItemStatus.failed]
    stub_query.get_upload_batch_item_for_media.return_value = item
    stub_query.get_import_batch.return_value = batch
    stub_query.get_import_batch_statuses.return_value = statuses
    service = MediaUploadService(fake_db, processing=SimpleNamespace(), query=stub_query)
    with patch.object(service, '_auto_compute_recommendation_groups_for_batch', AsyncMock()) as auto_compute:
        await service.mark_upload_batch_item_done(uuid.uuid4())
    assert item.status == ItemStatus.done
    assert item.step == ProcessingStep.tag
    assert batch.total_items == 2
    assert batch.done_items == 1
    assert batch.failed_items == 1
    assert batch.status == BatchStatus.partial_failed
    auto_compute.assert_not_awaited()
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

@pytest.mark.asyncio
async def test_upload_service_upload_files_passes_external_refs(fake_db, stub_query):
    service = MediaUploadService(fake_db, processing=SimpleNamespace(), query=stub_query)
    expected = SimpleNamespace(batch_id=uuid.uuid4())

    with patch.object(MediaUploadWorkflow, "run", AsyncMock(return_value=expected)) as run:
        response = await service.upload_files(
            SimpleNamespace(id=uuid.uuid4()),
            [],
            external_refs_values=[[ExternalRefCreate(provider="twitter", url="https://x.com/example/status/1")]],
        )

    assert response is expected
    run.assert_awaited_once()
    assert run.await_args.kwargs["external_refs_values"][0][0].provider == "twitter"

@pytest.mark.asyncio
async def test_upload_service_upload_files_with_annotations_passes_external_refs(fake_db, stub_query):
    service = MediaUploadService(fake_db, processing=SimpleNamespace(), query=stub_query)
    expected = SimpleNamespace(batch_id=uuid.uuid4())

    with patch.object(MediaUploadWorkflow, "run", AsyncMock(return_value=expected)) as run:
        response = await service.upload_files_with_annotations(
            SimpleNamespace(id=uuid.uuid4()),
            [],
            external_refs_values=[[ExternalRefCreate(provider="twitter", url="https://x.com/example/status/1")]],
        )

    assert response is expected
    run.assert_awaited_once()
    assert run.await_args.kwargs["external_refs_values"][0][0].provider == "twitter"

@pytest.mark.asyncio
async def test_upload_service_ingest_url_passes_external_refs(fake_db, stub_query):
    service = MediaUploadService(fake_db, processing=SimpleNamespace(), query=stub_query)
    expected = SimpleNamespace(batch_id=uuid.uuid4())

    with patch.object(MediaUploadWorkflow, "run_from_url", AsyncMock(return_value=expected)) as run:
        response = await service.ingest_url(
            SimpleNamespace(id=uuid.uuid4()),
            "https://example.test/image.webp",
            external_refs=[ExternalRefCreate(provider="twitter", url="https://x.com/example/status/1")],
        )

    assert response is expected
    run.assert_awaited_once()
    assert run.await_args.kwargs["external_refs"][0].provider == "twitter"
