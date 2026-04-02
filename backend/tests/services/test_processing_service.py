from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

from backend.app.errors.error import AppError
from backend.app.models.media import Media, MediaType, ProcessingStatus, TaggingStatus
from backend.app.models.media import MediaVisibility
from backend.app.models.relations import MediaEntity, MediaEntityType
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


@pytest.mark.asyncio
async def test_list_batch_review_items_returns_only_missing_character_or_series(fake_db, user):
    service = ProcessingService(fake_db)
    batch_id = uuid.uuid4()
    media_one = Media(
        id=uuid.uuid4(),
        uploader_id=user.id,
        owner_id=user.id,
        filename="one.webp",
        original_filename="one.webp",
        filepath="/tmp/one.webp",
        media_type=MediaType.IMAGE,
        captured_at=datetime.now(timezone.utc),
        created_at=datetime.now(timezone.utc),
        visibility=MediaVisibility.private,
        version=1,
        is_nsfw=False,
        tagging_status=TaggingStatus.DONE,
        thumbnail_status=ProcessingStatus.DONE,
        poster_status=ProcessingStatus.NOT_APPLICABLE,
    )
    media_one.entities = [
        MediaEntity(id=uuid.uuid4(), media_id=media_one.id, entity_type=MediaEntityType.character, name="Saber", role="primary", source="tagger"),
    ]
    media_two = Media(
        id=uuid.uuid4(),
        uploader_id=user.id,
        owner_id=user.id,
        filename="two.webp",
        original_filename="two.webp",
        filepath="/tmp/two.webp",
        media_type=MediaType.IMAGE,
        captured_at=datetime.now(timezone.utc),
        created_at=datetime.now(timezone.utc),
        visibility=MediaVisibility.private,
        version=1,
        is_nsfw=False,
        tagging_status=TaggingStatus.DONE,
        thumbnail_status=ProcessingStatus.DONE,
        poster_status=ProcessingStatus.NOT_APPLICABLE,
    )
    media_two.entities = [
        MediaEntity(id=uuid.uuid4(), media_id=media_two.id, entity_type=MediaEntityType.character, name="Rin", role="primary", source="tagger"),
        MediaEntity(id=uuid.uuid4(), media_id=media_two.id, entity_type=MediaEntityType.series, name="Fate", role="primary", source="tagger"),
    ]
    review_item = ImportBatchItem(batch_id=batch_id, media_id=media_one.id, source_filename="one.webp", status=ItemStatus.done)
    review_item.id = uuid.uuid4()
    review_item.media = media_one
    complete_item = ImportBatchItem(batch_id=batch_id, media_id=media_two.id, source_filename="two.webp", status=ItemStatus.done)
    complete_item.id = uuid.uuid4()
    complete_item.media = media_two

    with patch.object(service, "get_batch_for_user", AsyncMock()), \
         patch("backend.app.services.processing.ImportBatchItemRepository") as items_repo_cls, \
         patch("backend.app.services.processing.UserFavoriteRepository") as favorite_repo_cls:
        items_repo_cls.return_value.list_review_candidates_for_batch = AsyncMock(return_value=[review_item, complete_item])
        favorite_repo_cls.return_value.get_favorited_ids = AsyncMock(return_value=set())
        favorite_repo_cls.return_value.get_favorite_counts = AsyncMock(return_value={})

        result = await service.list_batch_review_items(batch_id, user.id)

    assert result.total == 1
    assert result.items[0].media.id == media_one.id
    assert result.items[0].missing_character is False
    assert result.items[0].missing_series is True
