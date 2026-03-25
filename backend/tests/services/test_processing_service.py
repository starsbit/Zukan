from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

from backend.app.errors.error import AppError
from backend.app.models.processing import BatchStatus, BatchType, ImportBatch, ImportBatchItem, ItemStatus
from backend.app.services.processing import ProcessingService
from backend.tests.services.conftest import ScalarResult


@pytest.mark.asyncio
async def test_list_batches_pagination(fake_db, user):
    service = ProcessingService(fake_db)
    b1 = ImportBatch(user_id=user.id, type=BatchType.upload, status=BatchStatus.running, total_items=0, queued_items=0, processing_items=0, done_items=0, failed_items=0)
    b2 = ImportBatch(user_id=user.id, type=BatchType.upload, status=BatchStatus.running, total_items=0, queued_items=0, processing_items=0, done_items=0, failed_items=0)
    b3 = ImportBatch(user_id=user.id, type=BatchType.upload, status=BatchStatus.running, total_items=0, queued_items=0, processing_items=0, done_items=0, failed_items=0)
    now = datetime.now(timezone.utc)
    for b in (b1, b2, b3):
        b.id = uuid.uuid4()
        b.created_at = now

    fake_db.execute = AsyncMock(return_value=ScalarResult(rows=[b1, b2, b3]))

    with patch("backend.app.services.processing.ImportBatchRepository") as repo_cls:
        repo_cls.return_value.count_for_user = AsyncMock(return_value=3)
        page = await service.list_batches(user.id, page_size=2)

    assert page.total == 3
    assert page.has_more is True
    assert len(page.items) == 2


@pytest.mark.asyncio
async def test_get_batch_for_user_raises_not_found(fake_db, user):
    service = ProcessingService(fake_db)

    with patch("backend.app.services.processing.ImportBatchRepository") as repo_cls:
        repo_cls.return_value.get_by_id_for_user = AsyncMock(return_value=None)
        with pytest.raises(AppError) as exc:
            await service.get_batch_for_user(uuid.uuid4(), user.id)

    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_list_batch_items_returns_cursor_page(fake_db, user):
    service = ProcessingService(fake_db)
    batch_id = uuid.uuid4()
    i1 = ImportBatchItem(batch_id=batch_id, source_filename="a", status=ItemStatus.pending)
    i2 = ImportBatchItem(batch_id=batch_id, source_filename="b", status=ItemStatus.done)
    i3 = ImportBatchItem(batch_id=batch_id, source_filename="c", status=ItemStatus.failed)
    now = datetime.now(timezone.utc)
    for i in (i1, i2, i3):
        i.id = uuid.uuid4()
        i.updated_at = now

    fake_db.execute = AsyncMock(return_value=ScalarResult(rows=[i1, i2, i3]))

    with patch.object(service, "get_batch_for_user", AsyncMock()), patch(
        "backend.app.services.processing.ImportBatchItemRepository"
    ) as items_repo_cls:
        items_repo_cls.return_value.count_for_batch = AsyncMock(return_value=3)
        page = await service.list_batch_items(batch_id, user.id, page_size=2)

    assert page.total == 3
    assert page.has_more is True
    assert len(page.items) == 2
