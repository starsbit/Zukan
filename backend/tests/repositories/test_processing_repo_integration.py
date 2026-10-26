from __future__ import annotations
import pytest
from backend.app.models.media import TaggingStatus
from backend.app.models.processing import BatchStatus, BatchType, ImportBatch, ImportBatchItem, ItemStatus, ProcessingStep
from backend.app.models.relations import MediaEntity, MediaEntityType
from backend.app.repositories.processing import ImportBatchItemRepository, ImportBatchRepository

@pytest.mark.asyncio
async def test_import_batch_item_repository_queries(db_session, make_user, make_media):
    user = await make_user()
    media = await make_media()
    batch = ImportBatch(type=BatchType.upload, status=BatchStatus.running, total_items=2, queued_items=2, processing_items=0, done_items=0, failed_items=0)
    db_session.add(batch)
    await db_session.flush()
    i1 = ImportBatchItem(batch_id=batch.id, media_id=media.id, source_filename='a.jpg', status=ItemStatus.pending, step=ProcessingStep.ingest, progress_percent=0)
    i2 = ImportBatchItem(batch_id=batch.id, source_filename='b.jpg', status=ItemStatus.done, step=ProcessingStep.tag, progress_percent=100)
    db_session.add_all([i1, i2])
    await db_session.flush()
    repo = ImportBatchItemRepository(db_session)
    assert await repo.get_by_id(i1.id) is not None
    assert len(await repo.list_for_batch(batch.id, offset=0, limit=10)) == 2
    assert await repo.count_for_batch(batch.id) == 2
    assert len(await repo.get_for_media(media.id)) == 1
    assert [i.id for i in await repo.get_pending_for_batch(batch.id)] == [i1.id]
