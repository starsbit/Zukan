from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from backend.app.errors.error import AppError
from backend.app.models.auth import User
from backend.app.models.media import Media, MediaType, ProcessingStatus, TaggingStatus
from backend.app.models.media import MediaVisibility
from backend.app.models.relations import MediaEntity, MediaEntityType
from backend.app.models.tags import MediaTag, Tag
from backend.app.models.processing import BatchStatus, BatchType, ImportBatch, ImportBatchItem, ItemStatus
from backend.app.schemas import (
    ImportBatchMergedReviewResponse,
    ImportBatchRecommendationGroupRead,
    ImportBatchRecommendationSuggestionRead,
    ImportBatchReviewListResponse,
)
from backend.app.services.processing import ProcessingService
from backend.tests.services.conftest import RowResult, ScalarResult


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
        uploaded_at=datetime.now(timezone.utc),
        visibility=MediaVisibility.private,
        version=1,
        is_nsfw=False,
        tagging_status=TaggingStatus.DONE,
        thumbnail_status=ProcessingStatus.DONE,
        poster_status=ProcessingStatus.NOT_APPLICABLE,
        metadata_review_dismissed=False,
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
        uploaded_at=datetime.now(timezone.utc),
        visibility=MediaVisibility.private,
        version=1,
        is_nsfw=False,
        tagging_status=TaggingStatus.DONE,
        thumbnail_status=ProcessingStatus.DONE,
        poster_status=ProcessingStatus.NOT_APPLICABLE,
        metadata_review_dismissed=False,
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
    assert result.recommendation_groups == []


@pytest.mark.asyncio
async def test_list_batch_review_items_skips_recommendations_when_not_requested(fake_db, user):
    service = ProcessingService(fake_db)
    batch_id = uuid.uuid4()
    media = Media(
        id=uuid.uuid4(),
        uploader_id=user.id,
        owner_id=user.id,
        filename="one.webp",
        original_filename="one.webp",
        filepath="/tmp/one.webp",
        media_type=MediaType.IMAGE,
        captured_at=datetime.now(timezone.utc),
        uploaded_at=datetime.now(timezone.utc),
        visibility=MediaVisibility.private,
        version=1,
        is_nsfw=False,
        tagging_status=TaggingStatus.DONE,
        thumbnail_status=ProcessingStatus.DONE,
        poster_status=ProcessingStatus.NOT_APPLICABLE,
        metadata_review_dismissed=False,
    )
    media.entities = []
    review_item = ImportBatchItem(batch_id=batch_id, media_id=media.id, source_filename="one.webp", status=ItemStatus.done)
    review_item.id = uuid.uuid4()
    review_item.media = media

    with patch.object(service, "get_batch_for_user", AsyncMock()), \
         patch.object(service, "_build_recommendation_groups", AsyncMock(return_value=[])) as build_groups, \
         patch("backend.app.services.processing.ImportBatchItemRepository") as items_repo_cls, \
         patch("backend.app.services.processing.UserFavoriteRepository") as favorite_repo_cls:
        items_repo_cls.return_value.list_review_candidates_for_batch = AsyncMock(return_value=[review_item])
        favorite_repo_cls.return_value.get_favorited_ids = AsyncMock(return_value=set())
        favorite_repo_cls.return_value.get_favorite_counts = AsyncMock(return_value={})

        result = await service.list_batch_review_items(batch_id, user.id)

    build_groups.assert_not_awaited()
    assert result.recommendation_groups == []


@pytest.mark.asyncio
async def test_list_batch_review_items_builds_recommendations_when_requested(fake_db, user):
    service = ProcessingService(fake_db)
    batch_id = uuid.uuid4()
    media = Media(
        id=uuid.uuid4(),
        uploader_id=user.id,
        owner_id=user.id,
        filename="one.webp",
        original_filename="one.webp",
        filepath="/tmp/one.webp",
        media_type=MediaType.IMAGE,
        captured_at=datetime.now(timezone.utc),
        uploaded_at=datetime.now(timezone.utc),
        visibility=MediaVisibility.private,
        version=1,
        is_nsfw=False,
        tagging_status=TaggingStatus.DONE,
        thumbnail_status=ProcessingStatus.DONE,
        poster_status=ProcessingStatus.NOT_APPLICABLE,
        metadata_review_dismissed=False,
    )
    media.entities = []
    review_item = ImportBatchItem(batch_id=batch_id, media_id=media.id, source_filename="one.webp", status=ItemStatus.done)
    review_item.id = uuid.uuid4()
    review_item.media = media
    expected_groups = [ImportBatchRecommendationGroupRead(
        id="batch-group-1",
        media_ids=[media.id],
        item_count=1,
        missing_character_count=1,
        missing_series_count=1,
        suggested_characters=[],
        suggested_series=[],
        shared_signals=[],
        confidence=0.9,
    )]

    with patch.object(service, "get_batch_for_user", AsyncMock()), \
         patch.object(service, "_build_recommendation_groups", AsyncMock(return_value=expected_groups)) as build_groups, \
         patch("backend.app.services.processing.ImportBatchItemRepository") as items_repo_cls, \
         patch("backend.app.services.processing.UserFavoriteRepository") as favorite_repo_cls:
        items_repo_cls.return_value.list_review_candidates_for_batch = AsyncMock(return_value=[review_item])
        favorite_repo_cls.return_value.get_favorited_ids = AsyncMock(return_value=set())
        favorite_repo_cls.return_value.get_favorite_counts = AsyncMock(return_value={})

        result = await service.list_batch_review_items(batch_id, user.id, include_recommendations=True)

    build_groups.assert_awaited_once()
    assert len(result.recommendation_groups) == 1
    assert result.recommendation_groups[0].id == "batch-group-1"


@pytest.mark.asyncio
async def test_list_batch_review_items_populates_library_suggestions_when_enabled(fake_db, user):
    service = ProcessingService(fake_db)
    batch_id = uuid.uuid4()
    media = Media(
        id=uuid.uuid4(),
        uploader_id=user.id,
        owner_id=user.id,
        filename="one.webp",
        original_filename="one.webp",
        filepath="/tmp/one.webp",
        media_type=MediaType.IMAGE,
        captured_at=datetime.now(timezone.utc),
        uploaded_at=datetime.now(timezone.utc),
        visibility=MediaVisibility.private,
        version=1,
        is_nsfw=False,
        tagging_status=TaggingStatus.DONE,
        thumbnail_status=ProcessingStatus.DONE,
        poster_status=ProcessingStatus.NOT_APPLICABLE,
        metadata_review_dismissed=False,
    )
    media.entities = []
    review_item = ImportBatchItem(batch_id=batch_id, media_id=media.id, source_filename="one.webp", status=ItemStatus.done)
    review_item.id = uuid.uuid4()
    review_item.media = media
    service._library_enrichment.enrich_media = AsyncMock(return_value=SimpleNamespace(
        suggestions={
            MediaEntityType.character: [ImportBatchRecommendationSuggestionRead(name="Saber", confidence=0.95)],
            MediaEntityType.series: [ImportBatchRecommendationSuggestionRead(name="Fate/stay night", confidence=0.91)],
        },
    ))
    fake_db.get = AsyncMock(return_value=User(
        id=user.id,
        username=user.username,
        email=user.email,
        hashed_password=user.hashed_password,
        is_admin=user.is_admin,
        show_nsfw=user.show_nsfw,
        show_sensitive=user.show_sensitive,
        tag_confidence_threshold=user.tag_confidence_threshold,
        library_classification_enabled=True,
        version=user.version,
        storage_quota_mb=user.storage_quota_mb,
        created_at=user.created_at,
    ))

    with patch.object(service, "get_batch_for_user", AsyncMock()), \
         patch.object(service, "_build_recommendation_groups", AsyncMock(return_value=[])), \
         patch("backend.app.services.processing.ImportBatchItemRepository") as items_repo_cls, \
         patch("backend.app.services.processing.UserFavoriteRepository") as favorite_repo_cls:
        items_repo_cls.return_value.list_review_candidates_for_batch = AsyncMock(return_value=[review_item])
        favorite_repo_cls.return_value.get_favorited_ids = AsyncMock(return_value=set())
        favorite_repo_cls.return_value.get_favorite_counts = AsyncMock(return_value={})

        result = await service.list_batch_review_items(batch_id, user.id, include_recommendations=True)

    assert [suggestion.name for suggestion in result.items[0].suggested_characters] == ["Saber"]
    assert [suggestion.name for suggestion in result.items[0].suggested_series] == ["Fate/stay night"]
    service._library_enrichment.enrich_media.assert_awaited_once_with(
        media.id,
        user_id=user.id,
        apply=False,
        target_media=media,
    )


@pytest.mark.asyncio
async def test_list_batch_review_items_skips_library_suggestions_when_flag_disabled(fake_db, user):
    service = ProcessingService(fake_db)
    batch_id = uuid.uuid4()
    media = Media(
        id=uuid.uuid4(),
        uploader_id=user.id,
        owner_id=user.id,
        filename="one.webp",
        original_filename="one.webp",
        filepath="/tmp/one.webp",
        media_type=MediaType.IMAGE,
        captured_at=datetime.now(timezone.utc),
        uploaded_at=datetime.now(timezone.utc),
        visibility=MediaVisibility.private,
        version=1,
        is_nsfw=False,
        tagging_status=TaggingStatus.DONE,
        thumbnail_status=ProcessingStatus.DONE,
        poster_status=ProcessingStatus.NOT_APPLICABLE,
        metadata_review_dismissed=False,
    )
    media.entities = []
    review_item = ImportBatchItem(batch_id=batch_id, media_id=media.id, source_filename="one.webp", status=ItemStatus.done)
    review_item.id = uuid.uuid4()
    review_item.media = media
    service._library_enrichment.enrich_media = AsyncMock()
    fake_db.get = AsyncMock(return_value=User(
        id=user.id,
        username=user.username,
        email=user.email,
        hashed_password=user.hashed_password,
        is_admin=user.is_admin,
        show_nsfw=user.show_nsfw,
        show_sensitive=user.show_sensitive,
        tag_confidence_threshold=user.tag_confidence_threshold,
        library_classification_enabled=False,
        version=user.version,
        storage_quota_mb=user.storage_quota_mb,
        created_at=user.created_at,
    ))

    with patch.object(service, "get_batch_for_user", AsyncMock()), \
         patch.object(service, "_build_recommendation_groups", AsyncMock(return_value=[])), \
         patch("backend.app.services.processing.ImportBatchItemRepository") as items_repo_cls, \
         patch("backend.app.services.processing.UserFavoriteRepository") as favorite_repo_cls:
        items_repo_cls.return_value.list_review_candidates_for_batch = AsyncMock(return_value=[review_item])
        favorite_repo_cls.return_value.get_favorited_ids = AsyncMock(return_value=set())
        favorite_repo_cls.return_value.get_favorite_counts = AsyncMock(return_value={})

        result = await service.list_batch_review_items(batch_id, user.id, include_recommendations=True)

    assert result.items[0].suggested_characters == []
    assert result.items[0].suggested_series == []
    service._library_enrichment.enrich_media.assert_not_awaited()


@pytest.mark.asyncio
async def test_list_all_review_items_returns_unresolved_across_batches(fake_db, user):
    service = ProcessingService(fake_db)
    now = datetime.now(timezone.utc)

    def make_media(name: str, *, entities: list[MediaEntity]):
        media = Media(
            id=uuid.uuid4(),
            uploader_id=user.id,
            owner_id=user.id,
            filename=name,
            original_filename=name,
            filepath=f"/tmp/{name}",
            media_type=MediaType.IMAGE,
            captured_at=now,
            uploaded_at=now,
            visibility=MediaVisibility.private,
            version=1,
            is_nsfw=False,
            tagging_status=TaggingStatus.DONE,
            thumbnail_status=ProcessingStatus.DONE,
            poster_status=ProcessingStatus.NOT_APPLICABLE,
            metadata_review_dismissed=False,
        )
        media.entities = entities
        media.media_tags = []
        return media

    batch_one = uuid.uuid4()
    batch_two = uuid.uuid4()

    media_one = make_media(
        "one.webp",
        entities=[
            MediaEntity(
                id=uuid.uuid4(),
                media_id=uuid.uuid4(),
                entity_type=MediaEntityType.character,
                name="Saber",
                role="primary",
                source="tagger",
            ),
        ],
    )
    media_one.entities[0].media_id = media_one.id

    media_two = make_media("two.webp", entities=[])
    media_three = make_media(
        "three.webp",
        entities=[
            MediaEntity(
                id=uuid.uuid4(),
                media_id=uuid.uuid4(),
                entity_type=MediaEntityType.character,
                name="Rin",
                role="primary",
                source="tagger",
            ),
            MediaEntity(
                id=uuid.uuid4(),
                media_id=uuid.uuid4(),
                entity_type=MediaEntityType.series,
                name="Fate",
                role="primary",
                source="tagger",
            ),
        ],
    )
    for entity in media_three.entities:
        entity.media_id = media_three.id

    item_one = ImportBatchItem(batch_id=batch_one, media_id=media_one.id, source_filename="one.webp", status=ItemStatus.done)
    item_one.id = uuid.uuid4()
    item_one.media = media_one
    item_two = ImportBatchItem(batch_id=batch_two, media_id=media_two.id, source_filename="two.webp", status=ItemStatus.done)
    item_two.id = uuid.uuid4()
    item_two.media = media_two
    item_three = ImportBatchItem(batch_id=batch_two, media_id=media_three.id, source_filename="three.webp", status=ItemStatus.done)
    item_three.id = uuid.uuid4()
    item_three.media = media_three

    with patch("backend.app.services.processing.ImportBatchItemRepository") as items_repo_cls, \
         patch("backend.app.services.processing.UserFavoriteRepository") as favorite_repo_cls:
        items_repo_cls.return_value.list_all_review_candidates_for_user = AsyncMock(return_value=[item_one, item_two, item_three])
        favorite_repo_cls.return_value.get_favorited_ids = AsyncMock(return_value=set())
        favorite_repo_cls.return_value.get_favorite_counts = AsyncMock(return_value={})

        result = await service.list_all_review_items(user.id)

    assert result.total == 2
    assert {item.batch_item_id for item in result.items} == {item_one.id, item_two.id}
    assert {item.media.id for item in result.items} == {media_one.id, media_two.id}
    assert result.recommendation_groups == []


@pytest.mark.asyncio
async def test_list_batch_review_items_skips_dismissed_review_media(fake_db, user):
    service = ProcessingService(fake_db)
    batch_id = uuid.uuid4()
    media = Media(
        id=uuid.uuid4(),
        uploader_id=user.id,
        owner_id=user.id,
        filename="one.webp",
        original_filename="one.webp",
        filepath="/tmp/one.webp",
        media_type=MediaType.IMAGE,
        captured_at=datetime.now(timezone.utc),
        uploaded_at=datetime.now(timezone.utc),
        visibility=MediaVisibility.private,
        version=1,
        is_nsfw=False,
        tagging_status=TaggingStatus.DONE,
        thumbnail_status=ProcessingStatus.DONE,
        poster_status=ProcessingStatus.NOT_APPLICABLE,
        metadata_review_dismissed=True,
    )
    media.entities = []
    media.media_tags = []
    review_item = ImportBatchItem(batch_id=batch_id, media_id=media.id, source_filename="one.webp", status=ItemStatus.done)
    review_item.id = uuid.uuid4()
    review_item.media = media

    with patch.object(service, "get_batch_for_user", AsyncMock()), \
         patch("backend.app.services.processing.ImportBatchItemRepository") as items_repo_cls, \
         patch("backend.app.services.processing.UserFavoriteRepository") as favorite_repo_cls:
        items_repo_cls.return_value.list_review_candidates_for_batch = AsyncMock(return_value=[review_item])
        favorite_repo_cls.return_value.get_favorited_ids = AsyncMock(return_value=set())
        favorite_repo_cls.return_value.get_favorite_counts = AsyncMock(return_value={})

        result = await service.list_batch_review_items(batch_id, user.id, include_recommendations=True)

    assert result.total == 0
    assert result.items == []


@pytest.mark.asyncio
async def test_list_batch_review_items_groups_related_media_and_suggests_names(fake_db, user):
    service = ProcessingService(fake_db)
    batch_id = uuid.uuid4()
    now = datetime.now(timezone.utc)

    def make_media(name: str, *, phash: str | None = None, ocr_text: str | None = None):
        media = Media(
            id=uuid.uuid4(),
            uploader_id=user.id,
            owner_id=user.id,
            filename=name,
            original_filename=name,
            filepath=f"/tmp/{name}",
            media_type=MediaType.IMAGE,
            captured_at=now,
            uploaded_at=now,
            visibility=MediaVisibility.private,
            version=1,
            is_nsfw=False,
            tagging_status=TaggingStatus.DONE,
            thumbnail_status=ProcessingStatus.DONE,
            poster_status=ProcessingStatus.NOT_APPLICABLE,
            phash=phash,
            ocr_text=ocr_text,
        )
        media.entities = []
        media.media_tags = []
        return media

    media_one = make_media("one.webp", phash="sharedhash", ocr_text="Saber route")
    media_two = make_media("two.webp", phash="sharedhash", ocr_text="Saber route")
    media_three = make_media("three.webp", ocr_text="completely different")

    media_one.entities = [
        MediaEntity(id=uuid.uuid4(), media_id=media_one.id, entity_type=MediaEntityType.character, name="Saber", role="primary", source="tagger", confidence=0.97),
    ]
    media_two.entities = []
    media_three.entities = []

    shared_tag = Tag(id=1, name="blue dress", category=0, media_count=2)
    copyright_tag = Tag(id=2, name="Fate/stay night", category=3, media_count=2)
    weak_tag = Tag(id=3, name="outdoor", category=0, media_count=1)

    media_one.media_tags = [
        MediaTag(media_id=media_one.id, tag_id=1, confidence=0.91, tag=shared_tag),
        MediaTag(media_id=media_one.id, tag_id=2, confidence=0.88, tag=copyright_tag),
    ]
    media_two.media_tags = [
        MediaTag(media_id=media_two.id, tag_id=1, confidence=0.9, tag=shared_tag),
        MediaTag(media_id=media_two.id, tag_id=2, confidence=0.87, tag=copyright_tag),
    ]
    media_three.media_tags = [
        MediaTag(media_id=media_three.id, tag_id=3, confidence=0.93, tag=weak_tag),
    ]

    item_one = ImportBatchItem(batch_id=batch_id, media_id=media_one.id, source_filename="one.webp", status=ItemStatus.done)
    item_one.id = uuid.uuid4()
    item_one.media = media_one
    item_two = ImportBatchItem(batch_id=batch_id, media_id=media_two.id, source_filename="two.webp", status=ItemStatus.done)
    item_two.id = uuid.uuid4()
    item_two.media = media_two
    item_three = ImportBatchItem(batch_id=batch_id, media_id=media_three.id, source_filename="three.webp", status=ItemStatus.done)
    item_three.id = uuid.uuid4()
    item_three.media = media_three

    fake_db.execute = AsyncMock(
        side_effect=[
            RowResult(rows=[]),
            RowResult(rows=[]),
            RowResult(rows=[]),
            None,
        ]
    )

    with patch.object(service, "get_batch_for_user", AsyncMock()), \
         patch("backend.app.services.processing.ImportBatchItemRepository") as items_repo_cls, \
         patch("backend.app.services.processing.UserFavoriteRepository") as favorite_repo_cls:
        items_repo_cls.return_value.list_review_candidates_for_batch = AsyncMock(return_value=[item_one, item_two, item_three])
        favorite_repo_cls.return_value.get_favorited_ids = AsyncMock(return_value=set())
        favorite_repo_cls.return_value.get_favorite_counts = AsyncMock(return_value={})

        result = await service.list_batch_review_items(batch_id, user.id, include_recommendations=True)

    assert result.total == 3
    assert len(result.recommendation_groups) == 1
    group = result.recommendation_groups[0]
    assert set(group.media_ids) == {media_one.id, media_two.id}
    assert group.suggested_characters[0].name == "Saber"
    assert group.suggested_series[0].name == "Fate/stay night"
    assert {signal.kind for signal in group.shared_signals} >= {"tag", "visual", "ocr"}
    assert len(result.items) == 3


@pytest.mark.asyncio
async def test_list_batch_review_items_infers_series_from_character_history(fake_db, user):
    service = ProcessingService(fake_db)
    batch_id = uuid.uuid4()
    now = datetime.now(timezone.utc)

    def make_media(name: str):
        media = Media(
            id=uuid.uuid4(),
            uploader_id=user.id,
            owner_id=user.id,
            filename=name,
            original_filename=name,
            filepath=f"/tmp/{name}",
            media_type=MediaType.IMAGE,
            captured_at=now,
            uploaded_at=now,
            visibility=MediaVisibility.private,
            version=1,
            is_nsfw=False,
            tagging_status=TaggingStatus.DONE,
            thumbnail_status=ProcessingStatus.DONE,
            poster_status=ProcessingStatus.NOT_APPLICABLE,
        )
        media.media_tags = []
        media.entities = []
        return media

    media_one = make_media("one.webp")
    media_two = make_media("two.webp")
    shared_character_tag = Tag(id=1, name="makise_kurisu", category=4, media_count=2)
    shared_visual_tag = Tag(id=2, name="labcoat", category=0, media_count=2)

    media_one.media_tags = [
        MediaTag(media_id=media_one.id, tag_id=1, confidence=0.96, tag=shared_character_tag),
        MediaTag(media_id=media_one.id, tag_id=2, confidence=0.9, tag=shared_visual_tag),
    ]
    media_two.media_tags = [
        MediaTag(media_id=media_two.id, tag_id=1, confidence=0.95, tag=shared_character_tag),
        MediaTag(media_id=media_two.id, tag_id=2, confidence=0.89, tag=shared_visual_tag),
    ]

    item_one = ImportBatchItem(batch_id=batch_id, media_id=media_one.id, source_filename="one.webp", status=ItemStatus.done)
    item_one.id = uuid.uuid4()
    item_one.media = media_one
    item_two = ImportBatchItem(batch_id=batch_id, media_id=media_two.id, source_filename="two.webp", status=ItemStatus.done)
    item_two.id = uuid.uuid4()
    item_two.media = media_two

    fake_db.execute = AsyncMock(
        side_effect=[
            RowResult(rows=[]),
            RowResult(rows=[]),
            RowResult(rows=[SimpleNamespace(name="Steins;Gate", media_count=4)]),
            None,
        ]
    )

    with patch.object(service, "get_batch_for_user", AsyncMock()), \
         patch("backend.app.services.processing.ImportBatchItemRepository") as items_repo_cls, \
         patch("backend.app.services.processing.UserFavoriteRepository") as favorite_repo_cls:
        items_repo_cls.return_value.list_review_candidates_for_batch = AsyncMock(return_value=[item_one, item_two])
        favorite_repo_cls.return_value.get_favorited_ids = AsyncMock(return_value=set())
        favorite_repo_cls.return_value.get_favorite_counts = AsyncMock(return_value={})

        result = await service.list_batch_review_items(batch_id, user.id, include_recommendations=True)

    assert len(result.recommendation_groups) == 1
    assert result.recommendation_groups[0].suggested_series[0].name == "Steins;Gate"


@pytest.mark.asyncio
async def test_list_batch_review_items_uses_historical_tagged_library_for_entity_suggestions(fake_db, user):
    service = ProcessingService(fake_db)
    batch_id = uuid.uuid4()
    now = datetime.now(timezone.utc)

    def make_media(name: str):
        media = Media(
            id=uuid.uuid4(),
            uploader_id=user.id,
            owner_id=user.id,
            filename=name,
            original_filename=name,
            filepath=f"/tmp/{name}",
            media_type=MediaType.IMAGE,
            captured_at=now,
            uploaded_at=now,
            visibility=MediaVisibility.private,
            version=1,
            is_nsfw=False,
            tagging_status=TaggingStatus.DONE,
            thumbnail_status=ProcessingStatus.DONE,
            poster_status=ProcessingStatus.NOT_APPLICABLE,
        )
        media.media_tags = []
        media.entities = []
        return media

    media_one = make_media("one.webp")
    media_two = make_media("two.webp")
    shared_outfit_tag = Tag(id=10, name="school uniform", category=0, media_count=8)
    shared_pose_tag = Tag(id=11, name="red ribbon", category=0, media_count=6)

    media_one.media_tags = [
        MediaTag(media_id=media_one.id, tag_id=10, confidence=0.95, tag=shared_outfit_tag),
        MediaTag(media_id=media_one.id, tag_id=11, confidence=0.89, tag=shared_pose_tag),
    ]
    media_two.media_tags = [
        MediaTag(media_id=media_two.id, tag_id=10, confidence=0.94, tag=shared_outfit_tag),
        MediaTag(media_id=media_two.id, tag_id=11, confidence=0.88, tag=shared_pose_tag),
    ]

    item_one = ImportBatchItem(batch_id=batch_id, media_id=media_one.id, source_filename="one.webp", status=ItemStatus.done)
    item_one.id = uuid.uuid4()
    item_one.media = media_one
    item_two = ImportBatchItem(batch_id=batch_id, media_id=media_two.id, source_filename="two.webp", status=ItemStatus.done)
    item_two.id = uuid.uuid4()
    item_two.media = media_two

    fake_db.execute = AsyncMock(
        side_effect=[
            RowResult(
                rows=[
                    SimpleNamespace(name="Natsume Rin", tag_id=10, media_count=4),
                    SimpleNamespace(name="Natsume Rin", tag_id=11, media_count=2),
                    SimpleNamespace(name="Noumi Kudryavka", tag_id=10, media_count=1),
                ]
            ),
            RowResult(
                rows=[
                    SimpleNamespace(name="Little Busters!", tag_id=10, media_count=5),
                    SimpleNamespace(name="Little Busters!", tag_id=11, media_count=2),
                    SimpleNamespace(name="Rewrite", tag_id=10, media_count=1),
                ]
            ),
            RowResult(rows=[]),
            None,
        ]
    )

    with patch.object(service, "get_batch_for_user", AsyncMock()), \
         patch("backend.app.services.processing.ImportBatchItemRepository") as items_repo_cls, \
         patch("backend.app.services.processing.UserFavoriteRepository") as favorite_repo_cls:
        items_repo_cls.return_value.list_review_candidates_for_batch = AsyncMock(return_value=[item_one, item_two])
        favorite_repo_cls.return_value.get_favorited_ids = AsyncMock(return_value=set())
        favorite_repo_cls.return_value.get_favorite_counts = AsyncMock(return_value={})

        result = await service.list_batch_review_items(batch_id, user.id, include_recommendations=True)

    assert len(result.recommendation_groups) == 1
    group = result.recommendation_groups[0]
    assert group.suggested_characters[0].name == "Natsume Rin"
    assert group.suggested_series[0].name == "Little Busters!"


@pytest.mark.asyncio
async def test_character_name_groups_case_insensitive_bucketing(fake_db, user):
    service = ProcessingService(fake_db)
    batch_id = uuid.uuid4()
    now = datetime.now(timezone.utc)

    def make_item(name: str, char_name: str) -> ImportBatchItem:
        media = Media(
            id=uuid.uuid4(),
            uploader_id=user.id,
            owner_id=user.id,
            filename=name,
            original_filename=name,
            filepath=f"/tmp/{name}",
            media_type=MediaType.IMAGE,
            captured_at=now,
            uploaded_at=now,
            visibility=MediaVisibility.private,
            version=1,
            is_nsfw=False,
            tagging_status=TaggingStatus.DONE,
            thumbnail_status=ProcessingStatus.DONE,
            poster_status=ProcessingStatus.NOT_APPLICABLE,
            metadata_review_dismissed=False,
        )
        media.media_tags = []
        media.entities = [
            MediaEntity(id=uuid.uuid4(), media_id=media.id, entity_type=MediaEntityType.character, name=char_name, role="primary", source="tagger", confidence=0.9),
        ]
        item = ImportBatchItem(batch_id=batch_id, media_id=media.id, source_filename=name, status=ItemStatus.done)
        item.id = uuid.uuid4()
        item.media = media
        return item

    item_one = make_item("one.webp", "saber")
    item_two = make_item("two.webp", "SABER")

    fake_db.execute = AsyncMock(side_effect=[RowResult(rows=[]), RowResult(rows=[]), RowResult(rows=[]), None])

    with patch.object(service, "get_batch_for_user", AsyncMock()), \
         patch("backend.app.services.processing.ImportBatchItemRepository") as items_repo_cls, \
         patch("backend.app.services.processing.UserFavoriteRepository") as favorite_repo_cls:
        items_repo_cls.return_value.list_review_candidates_for_batch = AsyncMock(return_value=[item_one, item_two])
        favorite_repo_cls.return_value.get_favorited_ids = AsyncMock(return_value=set())
        favorite_repo_cls.return_value.get_favorite_counts = AsyncMock(return_value={})

        result = await service.list_batch_review_items(batch_id, user.id, include_recommendations=True)

    assert len(result.recommendation_groups) == 1
    assert set(result.recommendation_groups[0].media_ids) == {item_one.media.id, item_two.media.id}


@pytest.mark.asyncio
async def test_character_name_groups_skip_single_item_buckets(fake_db, user):
    service = ProcessingService(fake_db)
    batch_id = uuid.uuid4()
    now = datetime.now(timezone.utc)

    def make_item(name: str, char_name: str) -> ImportBatchItem:
        media = Media(
            id=uuid.uuid4(),
            uploader_id=user.id,
            owner_id=user.id,
            filename=name,
            original_filename=name,
            filepath=f"/tmp/{name}",
            media_type=MediaType.IMAGE,
            captured_at=now,
            uploaded_at=now,
            visibility=MediaVisibility.private,
            version=1,
            is_nsfw=False,
            tagging_status=TaggingStatus.DONE,
            thumbnail_status=ProcessingStatus.DONE,
            poster_status=ProcessingStatus.NOT_APPLICABLE,
            metadata_review_dismissed=False,
        )
        media.media_tags = []
        media.entities = [
            MediaEntity(id=uuid.uuid4(), media_id=media.id, entity_type=MediaEntityType.character, name=char_name, role="primary", source="tagger", confidence=0.9),
        ]
        item = ImportBatchItem(batch_id=batch_id, media_id=media.id, source_filename=name, status=ItemStatus.done)
        item.id = uuid.uuid4()
        item.media = media
        return item

    item_one = make_item("one.webp", "Saber")
    item_two = make_item("two.webp", "Rin")

    with patch.object(service, "get_batch_for_user", AsyncMock()), \
         patch("backend.app.services.processing.ImportBatchItemRepository") as items_repo_cls, \
         patch("backend.app.services.processing.UserFavoriteRepository") as favorite_repo_cls:
        items_repo_cls.return_value.list_review_candidates_for_batch = AsyncMock(return_value=[item_one, item_two])
        favorite_repo_cls.return_value.get_favorited_ids = AsyncMock(return_value=set())
        favorite_repo_cls.return_value.get_favorite_counts = AsyncMock(return_value={})

        result = await service.list_batch_review_items(batch_id, user.id, include_recommendations=True)

    assert result.recommendation_groups == []


@pytest.mark.asyncio
async def test_character_name_groups_only_apply_to_missing_series_items(fake_db, user):
    service = ProcessingService(fake_db)
    batch_id = uuid.uuid4()
    now = datetime.now(timezone.utc)

    def make_item(name: str, char_name: str, has_series: bool) -> ImportBatchItem:
        media = Media(
            id=uuid.uuid4(),
            uploader_id=user.id,
            owner_id=user.id,
            filename=name,
            original_filename=name,
            filepath=f"/tmp/{name}",
            media_type=MediaType.IMAGE,
            captured_at=now,
            uploaded_at=now,
            visibility=MediaVisibility.private,
            version=1,
            is_nsfw=False,
            tagging_status=TaggingStatus.DONE,
            thumbnail_status=ProcessingStatus.DONE,
            poster_status=ProcessingStatus.NOT_APPLICABLE,
            metadata_review_dismissed=False,
        )
        media.media_tags = []
        entities = [
            MediaEntity(id=uuid.uuid4(), media_id=media.id, entity_type=MediaEntityType.character, name=char_name, role="primary", source="tagger", confidence=0.9),
        ]
        if has_series:
            entities.append(
                MediaEntity(id=uuid.uuid4(), media_id=media.id, entity_type=MediaEntityType.series, name="Fate", role="primary", source="tagger", confidence=0.9),
            )
        media.entities = entities
        item = ImportBatchItem(batch_id=batch_id, media_id=media.id, source_filename=name, status=ItemStatus.done)
        item.id = uuid.uuid4()
        item.media = media
        return item

    item_missing_series = make_item("one.webp", "Saber", has_series=False)
    item_has_series = make_item("two.webp", "Saber", has_series=True)

    with patch.object(service, "get_batch_for_user", AsyncMock()), \
         patch("backend.app.services.processing.ImportBatchItemRepository") as items_repo_cls, \
         patch("backend.app.services.processing.UserFavoriteRepository") as favorite_repo_cls:
        items_repo_cls.return_value.list_review_candidates_for_batch = AsyncMock(return_value=[item_missing_series])
        favorite_repo_cls.return_value.get_favorited_ids = AsyncMock(return_value=set())
        favorite_repo_cls.return_value.get_favorite_counts = AsyncMock(return_value={})

        result = await service.list_batch_review_items(batch_id, user.id, include_recommendations=True)

    assert result.recommendation_groups == []


@pytest.mark.asyncio
async def test_character_name_groups_not_duplicated_in_similarity_groups(fake_db, user):
    service = ProcessingService(fake_db)
    batch_id = uuid.uuid4()
    now = datetime.now(timezone.utc)

    shared_tag = Tag(id=1, name="sword", category=0, media_count=2)

    def make_item(name: str, char_name: str) -> ImportBatchItem:
        media = Media(
            id=uuid.uuid4(),
            uploader_id=user.id,
            owner_id=user.id,
            filename=name,
            original_filename=name,
            filepath=f"/tmp/{name}",
            media_type=MediaType.IMAGE,
            captured_at=now,
            uploaded_at=now,
            visibility=MediaVisibility.private,
            version=1,
            is_nsfw=False,
            tagging_status=TaggingStatus.DONE,
            thumbnail_status=ProcessingStatus.DONE,
            poster_status=ProcessingStatus.NOT_APPLICABLE,
            metadata_review_dismissed=False,
        )
        media.media_tags = [MediaTag(media_id=media.id, tag_id=1, confidence=0.95, tag=shared_tag)]
        media.entities = [
            MediaEntity(id=uuid.uuid4(), media_id=media.id, entity_type=MediaEntityType.character, name=char_name, role="primary", source="tagger", confidence=0.95),
        ]
        item = ImportBatchItem(batch_id=batch_id, media_id=media.id, source_filename=name, status=ItemStatus.done)
        item.id = uuid.uuid4()
        item.media = media
        return item

    item_one = make_item("one.webp", "Saber")
    item_two = make_item("two.webp", "Saber")

    fake_db.execute = AsyncMock(side_effect=[RowResult(rows=[]), RowResult(rows=[]), RowResult(rows=[]), None])

    with patch.object(service, "get_batch_for_user", AsyncMock()), \
         patch("backend.app.services.processing.ImportBatchItemRepository") as items_repo_cls, \
         patch("backend.app.services.processing.UserFavoriteRepository") as favorite_repo_cls:
        items_repo_cls.return_value.list_review_candidates_for_batch = AsyncMock(return_value=[item_one, item_two])
        favorite_repo_cls.return_value.get_favorited_ids = AsyncMock(return_value=set())
        favorite_repo_cls.return_value.get_favorite_counts = AsyncMock(return_value={})

        result = await service.list_batch_review_items(batch_id, user.id, include_recommendations=True)

    assert len(result.recommendation_groups) == 1
    all_media_ids = [mid for group in result.recommendation_groups for mid in group.media_ids]
    assert len(all_media_ids) == len(set(all_media_ids)), "no item should appear in multiple groups"


@pytest.mark.asyncio
async def test_list_batch_review_items_uses_cached_recommendation_groups(fake_db, user):
    service = ProcessingService(fake_db)
    batch_id = uuid.uuid4()
    media = Media(
        id=uuid.uuid4(),
        uploader_id=user.id,
        owner_id=user.id,
        filename="one.webp",
        original_filename="one.webp",
        filepath="/tmp/one.webp",
        media_type=MediaType.IMAGE,
        captured_at=datetime.now(timezone.utc),
        uploaded_at=datetime.now(timezone.utc),
        visibility=MediaVisibility.private,
        version=1,
        is_nsfw=False,
        tagging_status=TaggingStatus.DONE,
        thumbnail_status=ProcessingStatus.DONE,
        poster_status=ProcessingStatus.NOT_APPLICABLE,
        metadata_review_dismissed=False,
    )
    media.entities = []
    review_item = ImportBatchItem(batch_id=batch_id, media_id=media.id, source_filename="one.webp", status=ItemStatus.done)
    review_item.id = uuid.uuid4()
    review_item.media = media
    batch = ImportBatch(
        id=batch_id,
        user_id=user.id,
        type=BatchType.upload,
        status=BatchStatus.done,
        total_items=1,
        queued_items=0,
        processing_items=0,
        done_items=1,
        failed_items=0,
    )
    batch.recommendation_groups = [{
        "id": "batch-group-1",
        "media_ids": [str(media.id)],
        "item_count": 1,
        "missing_character_count": 1,
        "missing_series_count": 1,
        "suggested_characters": [],
        "suggested_series": [{"name": "Fate/stay night", "confidence": 1.0}],
        "shared_signals": [],
        "confidence": 0.9,
    }]

    with patch.object(service, "get_batch_for_user", AsyncMock(return_value=batch)), \
         patch.object(service, "_build_recommendation_groups", AsyncMock(return_value=[])) as build_groups, \
         patch("backend.app.services.processing.ImportBatchItemRepository") as items_repo_cls, \
         patch("backend.app.services.processing.UserFavoriteRepository") as favorite_repo_cls:
        items_repo_cls.return_value.list_review_candidates_for_batch = AsyncMock(return_value=[review_item])
        favorite_repo_cls.return_value.get_favorited_ids = AsyncMock(return_value=set())
        favorite_repo_cls.return_value.get_favorite_counts = AsyncMock(return_value={})

        result = await service.list_batch_review_items(batch_id, user.id, include_recommendations=True)

    build_groups.assert_not_awaited()
    assert result.recommendation_groups[0].suggested_series[0].name == "Fate/stay night"


@pytest.mark.asyncio
async def test_merge_review_batches_reuses_persisted_merged_batch_when_contents_match(fake_db, user):
    service = ProcessingService(fake_db)
    merged_batch = ImportBatch(
        id=uuid.uuid4(),
        user_id=user.id,
        type=BatchType.review_merge,
        status=BatchStatus.done,
        total_items=2,
        queued_items=0,
        processing_items=0,
        done_items=2,
        failed_items=0,
    )

    expected_review = ImportBatchMergedReviewResponse(
        merged_batch_id=merged_batch.id,
        total=2,
        items=[],
        recommendation_groups=[],
    )

    with patch("backend.app.services.processing.ImportBatchRepository") as repo_cls, \
         patch.object(service, "_merged_review_batch_needs_refresh", AsyncMock(return_value=False)) as needs_refresh, \
         patch.object(service, "_refresh_merged_review_batch", AsyncMock()) as refresh_merged, \
         patch.object(
             service,
             "list_batch_review_items",
             AsyncMock(return_value=ImportBatchReviewListResponse(total=2, items=[], recommendation_groups=[])),
         ) as list_review:
        repo_cls.return_value.get_latest_for_user_by_type = AsyncMock(return_value=merged_batch)

        result = await service.merge_review_batches(user.id, include_recommendations=True)

    needs_refresh.assert_awaited_once_with(merged_batch, user.id)
    refresh_merged.assert_not_awaited()
    list_review.assert_awaited_once_with(
        merged_batch.id,
        user.id,
        include_recommendations=True,
        force_refresh=False,
    )
    assert result == expected_review


@pytest.mark.asyncio
async def test_merge_review_batches_refreshes_persisted_merged_batch_when_contents_change(fake_db, user):
    service = ProcessingService(fake_db)
    merged_batch = ImportBatch(
        id=uuid.uuid4(),
        user_id=user.id,
        type=BatchType.review_merge,
        status=BatchStatus.done,
        total_items=2,
        queued_items=0,
        processing_items=0,
        done_items=2,
        failed_items=0,
    )

    with patch("backend.app.services.processing.ImportBatchRepository") as repo_cls, \
         patch.object(service, "_merged_review_batch_needs_refresh", AsyncMock(return_value=True)) as needs_refresh, \
         patch.object(service, "_refresh_merged_review_batch", AsyncMock()) as refresh_merged, \
         patch.object(
             service,
             "list_batch_review_items",
             AsyncMock(return_value=ImportBatchReviewListResponse(total=3, items=[], recommendation_groups=[])),
         ) as list_review:
        repo_cls.return_value.get_latest_for_user_by_type = AsyncMock(return_value=merged_batch)

        await service.merge_review_batches(user.id, include_recommendations=True)

    needs_refresh.assert_awaited_once_with(merged_batch, user.id)
    refresh_merged.assert_awaited_once_with(merged_batch, user.id)
    list_review.assert_awaited_once_with(
        merged_batch.id,
        user.id,
        include_recommendations=True,
        force_refresh=True,
    )
