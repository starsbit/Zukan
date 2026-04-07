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
from backend.app.models.media import MediaVisibility
from backend.app.services.media.upload import MediaUploadService, MediaUploadWorkflow, UploadBatchContext


@pytest.mark.asyncio
async def test_create_upload_batch_sets_running_fields(fake_db, stub_query, user):
    workflow = MediaUploadWorkflow(
        db=fake_db,
        query=stub_query,
        tags_repo=SimpleNamespace(set_media_tag_links=AsyncMock()),
        post_processor=SimpleNamespace(dispatch=AsyncMock()),
    )

    batch = await workflow._create_upload_batch(user, total_items=3)

    assert batch.user_id == user.id
    assert batch.type == BatchType.upload
    assert batch.status == BatchStatus.running
    assert batch.total_items == 3


@pytest.mark.asyncio
async def test_process_single_upload_routes_failed_and_existing_paths(fake_db, stub_query, user):
    workflow = MediaUploadWorkflow(
        db=fake_db,
        query=stub_query,
        tags_repo=SimpleNamespace(set_media_tag_links=AsyncMock()),
        post_processor=SimpleNamespace(dispatch=AsyncMock()),
    )
    batch = ImportBatch(user_id=user.id, type=BatchType.upload, status=BatchStatus.running, total_items=1)
    batch.id = uuid.uuid4()
    upload = UploadFile(filename="a.webp", file=io.BytesIO(b"x"))

    with patch("backend.app.services.media.upload.save_upload", AsyncMock(return_value=None)), patch.object(
        workflow, "_handle_failed_upload", AsyncMock()
    ) as failed:
        await workflow._process_single_upload(
            upload_batch=batch,
            upload=upload,
            user=user,
            tags=None,
            captured_at_override=None,
            visibility=MediaVisibility.private,
            ctx=UploadBatchContext(),
        )
    assert failed.await_count == 1

    saved = SimpleNamespace(path=Path("/tmp/a.webp"), media_type="image", sha256="x", file_size=1, mime_type="image/webp")
    with patch("backend.app.services.media.upload.save_upload", AsyncMock(return_value=saved)), patch(
        "backend.app.services.media.upload.extract_media_metadata",
        return_value=SimpleNamespace(captured_at=datetime.now(timezone.utc)),
    ), patch.object(workflow, "_handle_existing_media", AsyncMock()) as existing:
        stub_query.get_media_by_sha256.return_value = SimpleNamespace(id=uuid.uuid4())
        await workflow._process_single_upload(
            upload_batch=batch,
            upload=upload,
            user=user,
            tags=None,
            captured_at_override=None,
            visibility=MediaVisibility.private,
            ctx=UploadBatchContext(),
        )
    assert existing.await_count == 1
    assert stub_query.get_media_by_sha256.await_args.args == ("x", user.id)


@pytest.mark.asyncio
async def test_process_single_upload_routes_new_media_path(fake_db, stub_query, user):
    workflow = MediaUploadWorkflow(
        db=fake_db,
        query=stub_query,
        tags_repo=SimpleNamespace(set_media_tag_links=AsyncMock()),
        post_processor=SimpleNamespace(dispatch=AsyncMock()),
    )
    batch = ImportBatch(user_id=user.id, type=BatchType.upload, status=BatchStatus.running, total_items=1)
    batch.id = uuid.uuid4()
    upload = UploadFile(filename="a.webp", file=io.BytesIO(b"x"))
    saved = SimpleNamespace(path=Path("/tmp/a.webp"), media_type="image", sha256="x", file_size=1, mime_type="image/webp")

    with patch("backend.app.services.media.upload.save_upload", AsyncMock(return_value=saved)), patch(
        "backend.app.services.media.upload.extract_media_metadata",
        return_value=SimpleNamespace(captured_at=datetime.now(timezone.utc)),
    ), patch.object(workflow, "_handle_new_media", AsyncMock()) as new_media:
        stub_query.get_media_by_sha256.return_value = None
        await workflow._process_single_upload(
            upload_batch=batch,
            upload=upload,
            user=user,
            tags=["safe"],
            captured_at_override=None,
            visibility=MediaVisibility.private,
            ctx=UploadBatchContext(),
        )

    assert new_media.await_count == 1


@pytest.mark.asyncio
async def test_process_single_upload_prefers_os_timestamp_override_for_new_media(fake_db, stub_query, user):
    workflow = MediaUploadWorkflow(
        db=fake_db,
        query=stub_query,
        tags_repo=SimpleNamespace(set_media_tag_links=AsyncMock()),
        post_processor=SimpleNamespace(dispatch=AsyncMock()),
    )
    batch = ImportBatch(user_id=user.id, type=BatchType.upload, status=BatchStatus.running, total_items=1)
    batch.id = uuid.uuid4()
    upload = UploadFile(filename="a.webp", file=io.BytesIO(b"x"))
    saved = SimpleNamespace(path=Path("/tmp/a.webp"), media_type="image", sha256="x", file_size=1, mime_type="image/webp")
    override = datetime(2020, 1, 2, 3, 4, 5, tzinfo=timezone.utc)

    with patch("backend.app.services.media.upload.save_upload", AsyncMock(return_value=saved)), patch(
        "backend.app.services.media.upload.extract_media_metadata",
        return_value=SimpleNamespace(captured_at=datetime(2024, 1, 1, tzinfo=timezone.utc)),
    ), patch.object(workflow, "_handle_new_media", AsyncMock()) as new_media:
        stub_query.get_media_by_sha256.return_value = None
        await workflow._process_single_upload(
            upload_batch=batch,
            upload=upload,
            user=user,
            tags=["safe"],
            captured_at_override=override,
            visibility=MediaVisibility.private,
            ctx=UploadBatchContext(),
        )

    assert new_media.await_args.kwargs["captured_at"] == override


@pytest.mark.asyncio
async def test_run_coordinates_batch_lifecycle(fake_db, stub_query, user):
    post = SimpleNamespace(dispatch=AsyncMock())
    workflow = MediaUploadWorkflow(
        db=fake_db,
        query=stub_query,
        tags_repo=SimpleNamespace(set_media_tag_links=AsyncMock()),
        post_processor=post,
    )

    upload_batch = ImportBatch(user_id=user.id, type=BatchType.upload, status=BatchStatus.running, total_items=1)
    upload_batch.id = uuid.uuid4()
    workflow._create_upload_batch = AsyncMock(return_value=upload_batch)

    async def fake_process(**kwargs):
        ctx = kwargs["ctx"]
        ctx.accepted = 1
        ctx.pending_items = 1
        media_id = uuid.uuid4()
        ctx.queued_media_ids.append(media_id)
        ctx.processing_media_ids.append(media_id)

    workflow._process_single_upload = AsyncMock(side_effect=fake_process)

    files = [UploadFile(filename="a.webp", file=io.BytesIO(b"x"))]
    response = await workflow.run(user=user, files=files, album_id=None, tags=None, captured_at_override=None)

    assert response.accepted == 1
    assert response.batch_id == upload_batch.id
    post.dispatch.assert_awaited_once()
    fake_db.commit.assert_awaited()


@pytest.mark.asyncio
async def test_run_applies_per_file_captured_at_values(fake_db, stub_query, user):
    workflow = MediaUploadWorkflow(
        db=fake_db,
        query=stub_query,
        tags_repo=SimpleNamespace(set_media_tag_links=AsyncMock()),
        post_processor=SimpleNamespace(dispatch=AsyncMock()),
    )
    workflow._create_upload_batch = AsyncMock(
        return_value=ImportBatch(user_id=user.id, type=BatchType.upload, status=BatchStatus.running, total_items=2)
    )

    observed_overrides: list[datetime | None] = []

    async def fake_process(**kwargs):
        observed_overrides.append(kwargs["captured_at_override"])

    workflow._process_single_upload = AsyncMock(side_effect=fake_process)
    workflow._finalize_upload_batch = lambda upload_batch, ctx: None
    workflow._build_response = lambda upload_batch, ctx: SimpleNamespace(accepted=0, batch_id=uuid.uuid4())

    files = [
        UploadFile(filename="a.webp", file=io.BytesIO(b"x")),
        UploadFile(filename="b.webp", file=io.BytesIO(b"y")),
    ]
    per_file_1 = datetime(2023, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
    per_file_2 = datetime(2022, 6, 7, 8, 9, 10, tzinfo=timezone.utc)

    await workflow.run(
        user=user,
        files=files,
        album_id=None,
        tags=None,
        captured_at_override=None,
        captured_at_values=[per_file_1, per_file_2],
    )

    assert observed_overrides == [per_file_1, per_file_2]


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
    await service.mark_upload_batch_item_failed(uuid.uuid4(), "bad")
    fake_db.commit.assert_not_awaited()

    item = ImportBatchItem(batch_id=uuid.uuid4(), source_filename="f", status=ItemStatus.pending)
    batch = ImportBatch(user_id=uuid.uuid4(), type=BatchType.upload, status=BatchStatus.running)
    stub_query.get_upload_batch_item_for_media.return_value = item
    stub_query.get_import_batch.return_value = batch
    stub_query.get_import_batch_statuses.return_value = [ItemStatus.failed]

    await service.mark_upload_batch_item_failed(uuid.uuid4(), "boom")

    assert item.status == ItemStatus.failed
    assert item.error == "boom"
    assert batch.status == BatchStatus.failed


@pytest.mark.asyncio
async def test_refresh_import_batch_status_running_and_done_states(fake_db, stub_query):
    service = MediaUploadService(fake_db, processing=SimpleNamespace(), query=stub_query)
    batch_id = uuid.uuid4()

    with patch.object(service, "_auto_compute_recommendation_groups_for_batch", AsyncMock()) as auto_compute:
        running_batch = ImportBatch(user_id=uuid.uuid4(), type=BatchType.upload, status=BatchStatus.running)
        stub_query.get_import_batch.return_value = running_batch
        stub_query.get_import_batch_statuses.return_value = [ItemStatus.pending, ItemStatus.processing]
        await service._refresh_import_batch_status(batch_id)
        assert running_batch.status == BatchStatus.running
        assert running_batch.finished_at is None
        auto_compute.assert_not_awaited()

        done_batch = ImportBatch(user_id=uuid.uuid4(), type=BatchType.upload, status=BatchStatus.running)
        stub_query.get_import_batch.return_value = done_batch
        stub_query.get_import_batch_statuses.return_value = [ItemStatus.done, ItemStatus.skipped]
        await service._refresh_import_batch_status(batch_id)
        assert done_batch.status == BatchStatus.done
        assert done_batch.finished_at is not None
        auto_compute.assert_awaited_once_with(done_batch)
