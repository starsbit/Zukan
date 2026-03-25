from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from backend.app.errors.error import AppError
from backend.app.models.relations import MediaEntity
from backend.app.models.tags import MediaTag, Tag
from backend.app.services.tags import TagService
from backend.app.utils.tagging import TagPrediction, TaggingResult
from backend.tests.services.conftest import ScalarResult


@pytest.mark.asyncio
async def test_get_tag_by_id_not_found(fake_db):
    service = TagService(fake_db)

    with patch("backend.app.services.tags.TagRepository") as repo_cls:
        repo_cls.return_value.get_by_id = AsyncMock(return_value=None)
        with pytest.raises(AppError) as exc:
            await service.get_tag_by_id(1)

    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_list_tags_returns_cursor_page(fake_db):
    service = TagService(fake_db)
    t1 = Tag(id=1, name="a", category=0, media_count=5)
    t2 = Tag(id=2, name="b", category=0, media_count=4)
    t3 = Tag(id=3, name="c", category=0, media_count=3)
    fake_db.execute = AsyncMock(return_value=ScalarResult(rows=[t1, t2, t3]))

    with patch("backend.app.services.tags.TagRepository") as repo_cls:
        repo_cls.return_value.count = AsyncMock(return_value=3)
        page = await service.list_tags(page_size=2, category=None)

    assert page.total == 3
    assert page.has_more is True
    assert len(page.items) == 2


@pytest.mark.asyncio
async def test_remove_tag_from_media_updates_links_and_nsfw(fake_db, user, media):
    safe_tag = Tag(id=1, name="safe", category=0, media_count=1)
    nsfw_tag = Tag(id=2, name="nsfw", category=9, media_count=1)
    media.media_tags = [MediaTag(tag=safe_tag, confidence=0.9), MediaTag(tag=nsfw_tag, confidence=0.8)]
    fake_db.execute = AsyncMock(return_value=ScalarResult(rows=[media]))

    with patch("backend.app.services.tags.TagRepository") as repo_cls:
        repo = repo_cls.return_value
        repo.get_by_name = AsyncMock(return_value=SimpleNamespace(id=1))
        repo.get_by_id = AsyncMock(return_value=None)
        repo.set_media_tag_links = AsyncMock()

        result = await TagService(fake_db).remove_tag_from_media(user, tag_name="nsfw")

    assert result.matched_media == 1
    assert result.updated_media == 1
    assert result.deleted_tag is True
    assert media.is_nsfw is False


@pytest.mark.asyncio
async def test_trash_media_by_tag_counts(fake_db, user):
    m1 = SimpleNamespace(deleted_at=None)
    m2 = SimpleNamespace(deleted_at=datetime.now(timezone.utc))
    fake_db.execute = AsyncMock(return_value=ScalarResult(rows=[m1, m2]))

    result = await TagService(fake_db).trash_media_by_tag(user, tag_name="safe")

    assert result.matched_media == 2
    assert result.trashed_media == 1
    assert result.already_trashed == 1


@pytest.mark.asyncio
async def test_predict_with_retries_retries_then_succeeds(fake_db):
    tagger = SimpleNamespace(
        predict=AsyncMock(
            side_effect=[RuntimeError("first"), TaggingResult(predictions=[TagPrediction("safe", 0, 0.9)], is_nsfw=False)]
        )
    )
    service = TagService(fake_db, tagger=tagger)

    with patch("backend.app.services.tags.asyncio.sleep", AsyncMock()):
        result = await service._predict_with_retries("/tmp/a.webp")

    assert isinstance(result, TaggingResult)
    assert tagger.predict.await_count == 2


@pytest.mark.asyncio
async def test_store_tagging_result_sets_status_and_character_entity(fake_db, user, media):
    media.uploader_id = user.id
    media.id = uuid.uuid4()
    result = TaggingResult(
        predictions=[TagPrediction("Saber", 4, 0.95), TagPrediction("safe", 0, 0.8)],
        is_nsfw=False,
    )

    with patch("backend.app.services.tags.TagRepository") as tag_repo_cls, patch(
        "backend.app.services.tags.MediaEntityRepository"
    ) as entity_repo_cls:
        tag_repo_cls.return_value.set_media_tag_links = AsyncMock()
        entity_repo_cls.return_value.get_tagger_char_entities = AsyncMock(return_value=[SimpleNamespace(id=1)])
        fake_db.get = AsyncMock(return_value=user)

        await TagService(fake_db)._store_tagging_result(media, result)

    assert media.tagging_status == "done"
    assert media.tagging_error is None
    assert any(isinstance(item, MediaEntity) and item.name == "Saber" for item in fake_db.added)


@pytest.mark.asyncio
async def test_tag_wrappers_and_tag_media_missing_media(fake_db, user):
    service = TagService(fake_db)

    with patch.object(service, "get_tag_by_id", AsyncMock(return_value=SimpleNamespace(name="safe"))), patch.object(
        service, "remove_tag_from_media", AsyncMock(return_value=SimpleNamespace(matched_media=1))
    ) as remove_fn, patch.object(service, "trash_media_by_tag", AsyncMock(return_value=SimpleNamespace(matched_media=1))) as trash_fn:
        await service.remove_tag_from_media_by_id(user, tag_id=1)
        await service.trash_media_by_tag_id(user, tag_id=1)

    assert remove_fn.await_count == 1
    assert trash_fn.await_count == 1

    tagger = SimpleNamespace(predict=AsyncMock())
    service_with_tagger = TagService(fake_db, tagger=tagger)
    with patch("backend.app.services.tags.MediaRepository") as media_repo_cls:
        media_repo_cls.return_value.get_by_id = AsyncMock(return_value=None)
        await service_with_tagger.tag_media(uuid.uuid4())


@pytest.mark.asyncio
async def test_tag_media_full_flow_sets_processing_and_stores(fake_db, media):
    tagger = SimpleNamespace(predict=AsyncMock(return_value=TaggingResult(predictions=[TagPrediction("safe", 0, 0.9)], is_nsfw=False)))
    service = TagService(fake_db, tagger=tagger)

    with patch("backend.app.services.tags.MediaRepository") as media_repo_cls, patch(
        "backend.app.services.tags.sample_media_frames", return_value=[]
    ), patch.object(service, "_store_tagging_result", AsyncMock()) as store_fn:
        media_repo_cls.return_value.get_by_id = AsyncMock(return_value=media)
        await service.tag_media(media.id)

    assert media.tagging_status == "processing"
    assert store_fn.await_count == 1
