from __future__ import annotations
import io
import uuid
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
import pytest
from fastapi import UploadFile
from backend.app.models.processing import BatchStatus, BatchType, ImportBatch, ImportBatchItem, ItemStatus
from backend.app.services.media.upload import MediaUploadService, MediaUploadWorkflow, UploadBatchContext

@pytest.mark.asyncio
async def test_create_upload_batch_sets_running_fields(fake_db, stub_query, user):
    workflow = MediaUploadWorkflow(db=fake_db, query=stub_query, tags_repo=SimpleNamespace(set_media_tag_links=AsyncMock()), post_processor=SimpleNamespace(dispatch=AsyncMock()))
    batch = await workflow._create_upload_batch(user, total_items=3)
    assert batch.type == BatchType.upload
    assert batch.status == BatchStatus.running
    assert batch.total_items == 3

@pytest.mark.asyncio
async def test_run_coordinates_batch_lifecycle(fake_db, stub_query, user):
    post = SimpleNamespace(dispatch=AsyncMock())
    workflow = MediaUploadWorkflow(db=fake_db, query=stub_query, tags_repo=SimpleNamespace(set_media_tag_links=AsyncMock()), post_processor=post)
    upload_batch = ImportBatch(type=BatchType.upload, status=BatchStatus.running, total_items=1)
    upload_batch.id = uuid.uuid4()
    workflow._create_upload_batch = AsyncMock(return_value=upload_batch)

    async def fake_process(**kwargs):
        ctx = kwargs['ctx']
        ctx.accepted = 1
        ctx.pending_items = 1
        media_id = uuid.uuid4()
        ctx.queued_media_ids.append(media_id)
        ctx.processing_media_ids.append(media_id)
    workflow._process_single_upload = AsyncMock(side_effect=fake_process)
    files = [UploadFile(filename='a.webp', file=io.BytesIO(b'x'))]
    response = await workflow.run(user=user, files=files, album_id=None, tags=None, captured_at_override=None)
    assert response.accepted == 1
    assert response.batch_id == upload_batch.id
    post.dispatch.assert_awaited_once()
    fake_db.commit.assert_awaited()

@pytest.mark.asyncio
async def test_run_applies_per_file_captured_at_values(fake_db, stub_query, user):
    workflow = MediaUploadWorkflow(db=fake_db, query=stub_query, tags_repo=SimpleNamespace(set_media_tag_links=AsyncMock()), post_processor=SimpleNamespace(dispatch=AsyncMock()))
    workflow._create_upload_batch = AsyncMock(return_value=ImportBatch(type=BatchType.upload, status=BatchStatus.running, total_items=2))
    observed_overrides: list[datetime | None] = []

    async def fake_process(**kwargs):
        observed_overrides.append(kwargs['captured_at_override'])
    workflow._process_single_upload = AsyncMock(side_effect=fake_process)
    workflow._finalize_upload_batch = lambda upload_batch, ctx: None
    workflow._build_response = lambda upload_batch, ctx: SimpleNamespace(accepted=0, batch_id=uuid.uuid4())
    files = [UploadFile(filename='a.webp', file=io.BytesIO(b'x')), UploadFile(filename='b.webp', file=io.BytesIO(b'y'))]
    per_file_1 = datetime(2023, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
    per_file_2 = datetime(2022, 6, 7, 8, 9, 10, tzinfo=timezone.utc)
    await workflow.run(user=user, files=files, album_id=None, tags=None, captured_at_override=None, captured_at_values=[per_file_1, per_file_2])
    assert observed_overrides == [per_file_1, per_file_2]

@pytest.mark.asyncio
async def test_run_applies_per_file_external_refs(fake_db, stub_query, user):
    workflow = MediaUploadWorkflow(db=fake_db, query=stub_query, tags_repo=SimpleNamespace(set_media_tag_links=AsyncMock()), post_processor=SimpleNamespace(dispatch=AsyncMock()))
    workflow._create_upload_batch = AsyncMock(return_value=ImportBatch(type=BatchType.upload, status=BatchStatus.running, total_items=2))
    observed_refs: list[list[str] | None] = []

    async def fake_process(**kwargs):
        refs = kwargs['external_refs']
        observed_refs.append(None if refs is None else [ref.provider for ref in refs])
    workflow._process_single_upload = AsyncMock(side_effect=fake_process)
    workflow._finalize_upload_batch = lambda upload_batch, ctx: None
    workflow._build_response = lambda upload_batch, ctx: SimpleNamespace(accepted=0, batch_id=uuid.uuid4())
    files = [UploadFile(filename='a.webp', file=io.BytesIO(b'x')), UploadFile(filename='b.webp', file=io.BytesIO(b'y'))]
    await workflow.run(user=user, files=files, album_id=None, tags=None, captured_at_override=None, external_refs_values=[[SimpleNamespace(provider='twitter')], [SimpleNamespace(provider='pixiv')]])
    assert observed_refs == [['twitter'], ['pixiv']]

@pytest.mark.asyncio
async def test_attach_album_if_needed_invokes_album_service(fake_db, stub_query, user):
    workflow = MediaUploadWorkflow(
        db=fake_db,
        query=stub_query,
        tags_repo=SimpleNamespace(set_media_tag_links=AsyncMock()),
        post_processor=SimpleNamespace(dispatch=AsyncMock()),
    )
    media_ids = [uuid.uuid4()]

    with patch("backend.app.services.albums.AlbumService") as album_cls:
        album = album_cls.return_value
        album.add_media_to_album = AsyncMock()

        await workflow._attach_album_if_needed(uuid.uuid4(), media_ids, user)

        album.add_media_to_album.assert_awaited_once()

@pytest.mark.asyncio
async def test_mark_upload_batch_item_failed_and_missing_item(fake_db, stub_query):
    service = MediaUploadService(fake_db, processing=SimpleNamespace(), query=stub_query)
    stub_query.get_upload_batch_item_for_media.return_value = None
    await service.mark_upload_batch_item_failed(uuid.uuid4(), 'bad')
    fake_db.commit.assert_not_awaited()
    item = ImportBatchItem(batch_id=uuid.uuid4(), source_filename='f', status=ItemStatus.pending)
    batch = ImportBatch(type=BatchType.upload, status=BatchStatus.running)
    stub_query.get_upload_batch_item_for_media.return_value = item
    stub_query.get_import_batch.return_value = batch
    stub_query.get_import_batch_statuses.return_value = [ItemStatus.failed]
    await service.mark_upload_batch_item_failed(uuid.uuid4(), 'boom')
    assert item.status == ItemStatus.failed
    assert item.error == 'boom'
    assert batch.status == BatchStatus.failed
    long_error = 'x' * 2048
    stub_query.get_upload_batch_item_for_media.return_value = item
    await service.mark_upload_batch_item_failed(uuid.uuid4(), long_error)
    assert item.error == 'x' * 1024

@pytest.mark.asyncio
async def test_refresh_import_batch_status_running_and_done_states(fake_db, stub_query):
    service = MediaUploadService(fake_db, processing=SimpleNamespace(), query=stub_query)
    batch_id = uuid.uuid4()
    with patch.object(service, '_auto_compute_recommendation_groups_for_batch', AsyncMock()) as auto_compute:
        running_batch = ImportBatch(type=BatchType.upload, status=BatchStatus.running)
        stub_query.get_import_batch.return_value = running_batch
        stub_query.get_import_batch_statuses.return_value = [ItemStatus.pending, ItemStatus.processing]
        await service._refresh_import_batch_status(batch_id)
        assert running_batch.status == BatchStatus.running
        assert running_batch.finished_at is None
        auto_compute.assert_not_awaited()
        done_batch = ImportBatch(type=BatchType.upload, status=BatchStatus.running)
        stub_query.get_import_batch.return_value = done_batch
        stub_query.get_import_batch_statuses.return_value = [ItemStatus.done, ItemStatus.skipped]
        await service._refresh_import_batch_status(batch_id)
        assert done_batch.status == BatchStatus.done
        assert done_batch.finished_at is not None
        auto_compute.assert_not_awaited()
