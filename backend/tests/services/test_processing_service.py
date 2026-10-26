from __future__ import annotations
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
import pytest
from backend.app.errors.error import AppError
from backend.app.models.auth import User
from backend.app.models.media import Media, MediaType, ProcessingStatus, TaggingStatus
from backend.app.models.relations import MediaEntity, MediaEntityType
from backend.app.models.tags import MediaTag, Tag
from backend.app.models.processing import BatchStatus, BatchType, ImportBatch, ImportBatchItem, ItemStatus
from backend.app.schemas import ImportBatchMergedReviewResponse, ImportBatchRecommendationGroupRead, ImportBatchRecommendationSuggestionRead, ImportBatchReviewListResponse
from backend.app.services.processing import ProcessingService
from backend.tests.services.conftest import RowResult, ScalarResult

@pytest.mark.asyncio
async def test_list_batches_pagination(fake_db, user):
    service = ProcessingService(fake_db)
    b1 = ImportBatch(type=BatchType.upload, status=BatchStatus.running, total_items=0, queued_items=0, processing_items=0, done_items=0, failed_items=0)
    b2 = ImportBatch(type=BatchType.upload, status=BatchStatus.running, total_items=0, queued_items=0, processing_items=0, done_items=0, failed_items=0)
    b3 = ImportBatch(type=BatchType.upload, status=BatchStatus.running, total_items=0, queued_items=0, processing_items=0, done_items=0, failed_items=0)
    now = datetime.now(timezone.utc)
    for b in (b1, b2, b3):
        b.id = uuid.uuid4()
        b.created_at = now
    fake_db.execute = AsyncMock(return_value=ScalarResult(rows=[b1, b2, b3]))
    with patch('backend.app.services.processing.ImportBatchRepository') as repo_cls:
        repo_cls.return_value.count_for_user = AsyncMock(return_value=3)
        page = await service.list_batches(page_size=2)
    assert page.total == 3
    assert page.has_more is True
    assert len(page.items) == 2

@pytest.mark.asyncio
async def test_get_batch_for_user_raises_not_found(fake_db, user):
    service = ProcessingService(fake_db)
    with patch('backend.app.services.processing.ImportBatchRepository') as repo_cls:
        repo_cls.return_value.get_by_id_for_user = AsyncMock(return_value=None)
        with pytest.raises(AppError) as exc:
            await service.get_batch_for_user(uuid.uuid4())
    assert exc.value.status_code == 404

@pytest.mark.asyncio
async def test_list_batch_items_returns_cursor_page(fake_db, user):
    service = ProcessingService(fake_db)
    batch_id = uuid.uuid4()
    i1 = ImportBatchItem(batch_id=batch_id, source_filename='a', status=ItemStatus.pending)
    i2 = ImportBatchItem(batch_id=batch_id, source_filename='b', status=ItemStatus.done)
    i3 = ImportBatchItem(batch_id=batch_id, source_filename='c', status=ItemStatus.failed)
    now = datetime.now(timezone.utc)
    for i in (i1, i2, i3):
        i.id = uuid.uuid4()
        i.updated_at = now
    fake_db.execute = AsyncMock(return_value=ScalarResult(rows=[i1, i2, i3]))
    with patch.object(service, 'get_batch_for_user', AsyncMock()), patch('backend.app.services.processing.ImportBatchItemRepository') as items_repo_cls:
        items_repo_cls.return_value.count_for_batch = AsyncMock(return_value=3)
        page = await service.list_batch_items(batch_id, page_size=2)
    assert page.total == 3
    assert page.has_more is True
    assert len(page.items) == 2

@pytest.mark.asyncio
async def test_merge_review_batches_reuses_persisted_merged_batch_when_contents_match(fake_db, user):
    service = ProcessingService(fake_db)
    merged_batch = ImportBatch(id=uuid.uuid4(), type=BatchType.review_merge, status=BatchStatus.done, total_items=2, queued_items=0, processing_items=0, done_items=2, failed_items=0)
    expected_review = ImportBatchMergedReviewResponse(merged_batch_id=merged_batch.id, total=2, items=[], recommendation_groups=[])
    with patch('backend.app.services.processing.ImportBatchRepository') as repo_cls, patch.object(service, '_merged_review_batch_needs_refresh', AsyncMock(return_value=False)) as needs_refresh, patch.object(service, '_refresh_merged_review_batch', AsyncMock()) as refresh_merged, patch.object(service, 'list_batch_review_items', AsyncMock(return_value=ImportBatchReviewListResponse(total=2, items=[], recommendation_groups=[]))) as list_review:
        repo_cls.return_value.get_latest_for_user_by_type = AsyncMock(return_value=merged_batch)
        result = await service.merge_review_batches(include_recommendations=True)
    needs_refresh.assert_awaited_once_with(merged_batch)
    refresh_merged.assert_not_awaited()
    list_review.assert_awaited_once_with(merged_batch.id, include_recommendations=True, force_refresh=False)
    assert result == expected_review

@pytest.mark.asyncio
async def test_merge_review_batches_refreshes_persisted_merged_batch_when_contents_change(fake_db, user):
    service = ProcessingService(fake_db)
    merged_batch = ImportBatch(id=uuid.uuid4(), type=BatchType.review_merge, status=BatchStatus.done, total_items=2, queued_items=0, processing_items=0, done_items=2, failed_items=0)
    with patch('backend.app.services.processing.ImportBatchRepository') as repo_cls, patch.object(service, '_merged_review_batch_needs_refresh', AsyncMock(return_value=True)) as needs_refresh, patch.object(service, '_refresh_merged_review_batch', AsyncMock()) as refresh_merged, patch.object(service, 'list_batch_review_items', AsyncMock(return_value=ImportBatchReviewListResponse(total=3, items=[], recommendation_groups=[]))) as list_review:
        repo_cls.return_value.get_latest_for_user_by_type = AsyncMock(return_value=merged_batch)
        await service.merge_review_batches(include_recommendations=True)
    needs_refresh.assert_awaited_once_with(merged_batch)
    refresh_merged.assert_awaited_once_with(merged_batch)
    list_review.assert_awaited_once_with(merged_batch.id, include_recommendations=True, force_refresh=True)
