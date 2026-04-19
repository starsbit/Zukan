from __future__ import annotations

import pytest

from backend.app.models.processing import BatchStatus, BatchType, ImportBatch, ImportBatchItem, ItemStatus, ProcessingStep
from backend.app.repositories.processing import ImportBatchItemRepository, ImportBatchRepository


@pytest.mark.asyncio
async def test_import_batch_repository_queries(db_session, make_user):
    user = await make_user()
    other = await make_user()
    b1 = ImportBatch(user_id=user.id, type=BatchType.upload, status=BatchStatus.running, total_items=1, queued_items=1, processing_items=0, done_items=0, failed_items=0)
    b2 = ImportBatch(user_id=user.id, type=BatchType.retag, status=BatchStatus.done, total_items=1, queued_items=0, processing_items=0, done_items=1, failed_items=0)
    b3 = ImportBatch(user_id=other.id, type=BatchType.upload, status=BatchStatus.running, total_items=1, queued_items=1, processing_items=0, done_items=0, failed_items=0)
    db_session.add_all([b1, b2, b3])
    await db_session.flush()

    repo = ImportBatchRepository(db_session)
    assert await repo.get_by_id(b1.id) is not None
    assert await repo.get_by_id_for_user(b1.id, user.id) is not None
    assert await repo.get_by_id_for_user(b1.id, other.id) is None
    assert len(await repo.list_for_user(user.id, offset=0, limit=10)) == 2
    assert await repo.count_for_user(user.id) == 2
    assert len(await repo.list_by_status(user.id, BatchStatus.running)) == 1
    running = await repo.list_running()
    assert {b.id for b in running} == {b1.id, b3.id}


@pytest.mark.asyncio
async def test_import_batch_item_repository_queries(db_session, make_user, make_media):
    user = await make_user()
    media = await make_media(uploader_id=user.id)
    batch = ImportBatch(user_id=user.id, type=BatchType.upload, status=BatchStatus.running, total_items=2, queued_items=2, processing_items=0, done_items=0, failed_items=0)
    db_session.add(batch)
    await db_session.flush()

    i1 = ImportBatchItem(batch_id=batch.id, media_id=media.id, source_filename="a.jpg", status=ItemStatus.pending, step=ProcessingStep.ingest, progress_percent=0)
    i2 = ImportBatchItem(batch_id=batch.id, source_filename="b.jpg", status=ItemStatus.done, step=ProcessingStep.tag, progress_percent=100)
    db_session.add_all([i1, i2])
    await db_session.flush()

    repo = ImportBatchItemRepository(db_session)
    assert await repo.get_by_id(i1.id) is not None
    assert len(await repo.list_for_batch(batch.id, offset=0, limit=10)) == 2
    assert await repo.count_for_batch(batch.id) == 2
    assert len(await repo.get_for_media(media.id)) == 1
    assert [i.id for i in await repo.get_pending_for_batch(batch.id)] == [i1.id]


@pytest.mark.asyncio
async def test_list_all_review_candidates_for_user_includes_multiple_batches(db_session, make_user, make_media):
    user = await make_user()
    other = await make_user()
    media_one = await make_media(uploader_id=user.id)
    media_two = await make_media(uploader_id=user.id)
    foreign_media = await make_media(uploader_id=other.id)

    batch_one = ImportBatch(user_id=user.id, type=BatchType.upload, status=BatchStatus.done, total_items=1, queued_items=0, processing_items=0, done_items=1, failed_items=0)
    batch_two = ImportBatch(user_id=user.id, type=BatchType.upload, status=BatchStatus.done, total_items=2, queued_items=0, processing_items=0, done_items=2, failed_items=0)
    foreign_batch = ImportBatch(user_id=other.id, type=BatchType.upload, status=BatchStatus.done, total_items=1, queued_items=0, processing_items=0, done_items=1, failed_items=0)
    db_session.add_all([batch_one, batch_two, foreign_batch])
    await db_session.flush()

    item_one = ImportBatchItem(batch_id=batch_one.id, media_id=media_one.id, source_filename="one.jpg", status=ItemStatus.done, step=ProcessingStep.tag, progress_percent=100)
    item_two = ImportBatchItem(batch_id=batch_two.id, media_id=media_two.id, source_filename="two.jpg", status=ItemStatus.done, step=ProcessingStep.tag, progress_percent=100)
    item_without_media = ImportBatchItem(batch_id=batch_two.id, source_filename="skip.jpg", status=ItemStatus.done, step=ProcessingStep.tag, progress_percent=100)
    foreign_item = ImportBatchItem(batch_id=foreign_batch.id, media_id=foreign_media.id, source_filename="foreign.jpg", status=ItemStatus.done, step=ProcessingStep.tag, progress_percent=100)
    db_session.add_all([item_one, item_two, item_without_media, foreign_item])
    await db_session.flush()

    repo = ImportBatchItemRepository(db_session)
    results = await repo.list_all_review_candidates_for_user(user.id)

    assert {item.id for item in results} == {item_one.id, item_two.id}
