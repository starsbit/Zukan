from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from backend.app.errors.error import AppError
from backend.app.models.auth import User
from backend.app.models.relations import MediaEntity, MediaEntityType
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
    user = SimpleNamespace(id=uuid.uuid4(), is_admin=False)
    t1 = SimpleNamespace(id=1, name="a", category=0, media_count=5)
    t2 = SimpleNamespace(id=2, name="b", category=0, media_count=4)
    t3 = SimpleNamespace(id=3, name="c", category=0, media_count=3)

    with patch("backend.app.services.tags.TagRepository") as repo_cls:
        repo_cls.return_value.count_accessible = AsyncMock(return_value=3)
        repo_cls.return_value.list_accessible = AsyncMock(return_value=[t1, t2, t3])
        page = await service.list_tags(user, page_size=2, category=None, scope="owner")

    assert page.total == 3
    assert page.has_more is True
    assert len(page.items) == 2
    repo_cls.return_value.count_accessible.assert_awaited_once_with(user, category=None, query=None, scope="owner")
    repo_cls.return_value.list_accessible.assert_awaited_once_with(user, category=None, query=None, scope="owner")


@pytest.mark.asyncio
async def test_remove_tag_from_media_updates_links_and_nsfw(fake_db, user, media):
    safe_tag = Tag(id=1, owner_user_id=user.id, name="safe", category=0, media_count=1)
    nsfw_tag = Tag(id=2, owner_user_id=user.id, name="nsfw", category=9, media_count=1)
    media.media_tags = [
        MediaTag(tag_id=1, tag=safe_tag, confidence=0.9),
        MediaTag(tag_id=2, tag=nsfw_tag, confidence=0.8),
    ]
    fake_db.execute = AsyncMock(return_value=ScalarResult(rows=[media]))

    with patch("backend.app.services.tags.TagRepository") as repo_cls:
        repo = repo_cls.return_value
        repo.get_by_id = AsyncMock(return_value=None)
        repo.set_media_tag_links = AsyncMock()

        result = await TagService(fake_db).remove_tag_from_media(user, source_tag=nsfw_tag)

    assert result.matched_media == 1
    assert result.updated_media == 1
    assert result.deleted_tag is True
    assert media.is_nsfw is False
    assert media.is_sensitive is False
    assert result.deleted_source is True


@pytest.mark.asyncio
async def test_remove_tag_from_media_preserves_manual_classification_overrides(fake_db, user, media):
    safe_tag = Tag(id=1, owner_user_id=user.id, name="safe", category=0, media_count=1)
    nsfw_tag = Tag(id=2, owner_user_id=user.id, name="nsfw", category=9, media_count=1)
    media.media_tags = [
        MediaTag(tag_id=1, tag=safe_tag, confidence=0.9),
        MediaTag(tag_id=2, tag=nsfw_tag, confidence=0.8),
    ]
    media.is_nsfw_override = False
    media.is_sensitive_override = True
    fake_db.execute = AsyncMock(return_value=ScalarResult(rows=[media]))

    with patch("backend.app.services.tags.TagRepository") as repo_cls:
        repo = repo_cls.return_value
        repo.get_by_id = AsyncMock(return_value=None)
        repo.set_media_tag_links = AsyncMock()

        await TagService(fake_db).remove_tag_from_media(user, source_tag=nsfw_tag)

    assert media.is_nsfw is False
    assert media.is_sensitive is False
    assert media.is_nsfw_override is False
    assert media.is_sensitive_override is True


@pytest.mark.asyncio
async def test_merge_tag_updates_only_accessible_media_and_deduplicates(fake_db, user, media):
    source_tag = Tag(id=1, owner_user_id=user.id, name="old", category=1, media_count=1)
    target_tag = Tag(id=2, owner_user_id=user.id, name="new", category=0, media_count=1)
    media.media_tags = [
        MediaTag(tag_id=1, tag=source_tag, confidence=0.8),
        MediaTag(tag_id=2, tag=target_tag, confidence=0.4),
    ]
    fake_db.execute = AsyncMock(return_value=ScalarResult(rows=[media]))

    with patch("backend.app.services.tags.TagRepository") as repo_cls:
        repo = repo_cls.return_value
        repo.set_media_tag_links = AsyncMock()
        repo.get_by_id = AsyncMock(return_value=None)

        result = await TagService(fake_db).merge_tag(user, source_tag=source_tag, target_tag=target_tag)

    assert result.matched_media == 1
    assert result.updated_media == 1
    assert result.deleted_source is True
    repo.set_media_tag_links.assert_awaited_once_with(media, [("new", 1, 0.8)])


@pytest.mark.asyncio
async def test_trash_media_by_tag_counts(fake_db, user):
    m1 = SimpleNamespace(deleted_at=None)
    m2 = SimpleNamespace(deleted_at=datetime.now(timezone.utc))
    fake_db.execute = AsyncMock(return_value=ScalarResult(rows=[m1, m2]))
    tag = Tag(id=1, owner_user_id=user.id, name="safe", category=0, media_count=2)

    result = await TagService(fake_db).trash_media_by_tag(user, tag=tag)

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
async def test_predict_with_retries_times_out_then_succeeds(fake_db, monkeypatch):
    attempts = 0

    async def predict(_image_path: str):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            await asyncio.Future()
        return TaggingResult(predictions=[TagPrediction("safe", 0, 0.9)], is_nsfw=False)

    monkeypatch.setattr("backend.app.services.tags.settings.tagging_retry_attempts", 2)
    monkeypatch.setattr("backend.app.services.tags.settings.tagging_retry_backoff_seconds", 0)
    monkeypatch.setattr("backend.app.services.tags.settings.tagging_prediction_timeout_seconds", 0.001)

    result = await TagService(fake_db, tagger=SimpleNamespace(predict=predict))._predict_with_retries(
        "/tmp/a.webp"
    )

    assert isinstance(result, TaggingResult)
    assert attempts == 2


@pytest.mark.asyncio
async def test_store_tagging_result_sets_status_and_persists_all_character_and_series_entities(fake_db, user, media):
    media.uploader_id = user.id
    media.id = uuid.uuid4()
    result = TaggingResult(
        predictions=[
            TagPrediction("Saber", 4, 0.95),
            TagPrediction("Rin Tohsaka", 4, 0.91),
            TagPrediction("Fate/stay night", 3, 0.94),
            TagPrediction("safe", 0, 0.8),
            TagPrediction("below threshold", 4, 0.2),
        ],
        is_nsfw=False,
    )

    with patch("backend.app.services.tags.TagRepository") as tag_repo_cls, patch(
        "backend.app.services.tags.MediaEntityRepository"
    ) as entity_repo_cls:
        tag_repo_cls.return_value.set_media_tag_links = AsyncMock()
        entity_repo_cls.return_value.add_media_entities = AsyncMock()
        entity_repo_cls.return_value.get_by_media = AsyncMock(return_value=[
            MediaEntity(id=uuid.uuid4(), media_id=media.id, entity_type=MediaEntityType.character, name="Saber", role="primary", source="tagger", confidence=None),
            MediaEntity(id=uuid.uuid4(), media_id=media.id, entity_type=MediaEntityType.character, name="Rin Tohsaka", role="primary", source="tagger", confidence=None),
            MediaEntity(id=uuid.uuid4(), media_id=media.id, entity_type=MediaEntityType.series, name="Fate/stay night", role="primary", source="tagger", confidence=None),
        ])
        fake_db.get = AsyncMock(return_value=user)

        await TagService(fake_db)._store_tagging_result(media, result)

    assert media.tagging_status == "done"
    assert media.tagging_error is None
    assert media.is_sensitive is False
    entity_repo_cls.return_value.add_media_entities.assert_any_await(
        media,
        entity_type=MediaEntityType.character,
        names=["Saber", "Rin Tohsaka"],
        source="tagger",
        confidence=None,
        replace_existing_type=True,
    )
    entity_repo_cls.return_value.add_media_entities.assert_any_await(
        media,
        entity_type=MediaEntityType.series,
        names=["Fate/stay night"],
        source="tagger",
        confidence=None,
        replace_existing_type=True,
    )


@pytest.mark.asyncio
async def test_store_tagging_result_derives_series_from_character_suffix_when_no_copyright_tag(fake_db, user, media):
    media.uploader_id = user.id
    media.id = uuid.uuid4()
    result = TaggingResult(
        predictions=[
            TagPrediction("kanna_(blue_archive)", 4, 0.91),
            TagPrediction("hoshino_(blue_archive)", 4, 0.89),
            TagPrediction("safe", 0, 0.8),
        ],
        is_nsfw=False,
    )

    with patch("backend.app.services.tags.TagRepository") as tag_repo_cls, patch(
        "backend.app.services.tags.MediaEntityRepository"
    ) as entity_repo_cls:
        tag_repo_cls.return_value.set_media_tag_links = AsyncMock()
        entity_repo_cls.return_value.add_media_entities = AsyncMock()
        entity_repo_cls.return_value.get_by_media = AsyncMock(return_value=[])
        fake_db.get = AsyncMock(return_value=user)

        await TagService(fake_db)._store_tagging_result(media, result)

    entity_repo_cls.return_value.add_media_entities.assert_any_await(
        media,
        entity_type=MediaEntityType.character,
        names=["kanna_(blue_archive)", "hoshino_(blue_archive)"],
        source="tagger",
        confidence=None,
        replace_existing_type=True,
    )
    entity_repo_cls.return_value.add_media_entities.assert_any_await(
        media,
        entity_type=MediaEntityType.series,
        names=["blue_archive"],
        source="tagger",
        confidence=None,
        replace_existing_type=True,
    )


@pytest.mark.asyncio
async def test_store_tagging_result_marks_sensitive_from_curated_tags(fake_db, user, media):
    media.uploader_id = user.id
    result = TaggingResult(
        predictions=[
            TagPrediction("sensitive", 0, 0.7),
        ],
        is_nsfw=False,
    )

    with patch("backend.app.services.tags.TagRepository") as tag_repo_cls, patch(
        "backend.app.services.tags.MediaEntityRepository"
    ) as entity_repo_cls:
        tag_repo_cls.return_value.set_media_tag_links = AsyncMock()
        entity_repo_cls.return_value.add_media_entities = AsyncMock()
        entity_repo_cls.return_value.get_by_media = AsyncMock(return_value=[])
        fake_db.get = AsyncMock(return_value=user)

        await TagService(fake_db)._store_tagging_result(media, result)

    assert media.is_nsfw is False
    assert media.is_sensitive is True


@pytest.mark.asyncio
async def test_store_tagging_result_preserves_manual_classification_overrides(fake_db, user, media):
    media.uploader_id = user.id
    media.is_nsfw_override = False
    media.is_sensitive_override = True
    result = TaggingResult(
        predictions=[
            TagPrediction("nsfw", 0, 0.9),
            TagPrediction("sensitive", 0, 0.8),
        ],
        is_nsfw=True,
        is_sensitive=True,
    )

    with patch("backend.app.services.tags.TagRepository") as tag_repo_cls, patch(
        "backend.app.services.tags.MediaEntityRepository"
    ) as entity_repo_cls:
        tag_repo_cls.return_value.set_media_tag_links = AsyncMock()
        entity_repo_cls.return_value.add_media_entities = AsyncMock()
        entity_repo_cls.return_value.get_by_media = AsyncMock(return_value=[])
        fake_db.get = AsyncMock(return_value=user)

        await TagService(fake_db)._store_tagging_result(media, result)

    assert media.is_nsfw is True
    assert media.is_sensitive is True
    assert media.is_nsfw_override is False
    assert media.is_sensitive_override is True


@pytest.mark.asyncio
async def test_tag_wrappers_and_tag_media_missing_media(fake_db, user):
    service = TagService(fake_db)

    tag = SimpleNamespace(id=1, name="safe", owner_user_id=user.id)
    with patch.object(service, "get_manageable_tag_by_id", AsyncMock(return_value=tag)), patch.object(
        service, "remove_tag_from_media", AsyncMock(return_value=SimpleNamespace(matched_media=1))
    ) as remove_fn, patch.object(service, "trash_media_by_tag", AsyncMock(return_value=SimpleNamespace(matched_media=1))) as trash_fn, patch.object(
        service,
        "merge_tag",
        AsyncMock(return_value=SimpleNamespace(matched_media=1)),
    ) as merge_fn:
        await service.remove_tag_from_media_by_id(user, tag_id=1)
        await service.trash_media_by_tag_id(user, tag_id=1)
        await service.merge_tag_by_id(user, tag_id=1, target_tag_id=2)

    assert remove_fn.await_count == 1
    assert trash_fn.await_count == 1
    assert merge_fn.await_count == 1

    tagger = SimpleNamespace(predict=AsyncMock())
    service_with_tagger = TagService(fake_db, tagger=tagger)
    with patch("backend.app.services.tags.MediaRepository") as media_repo_cls:
        media_repo_cls.return_value.get_by_id = AsyncMock(return_value=None)
        await service_with_tagger.tag_media(uuid.uuid4())


@pytest.mark.asyncio
async def test_manageable_tag_rejects_foreign_owner(fake_db, user):
    foreign_tag = Tag(id=7, owner_user_id=uuid.uuid4(), name="shared", category=0, media_count=1)

    with patch("backend.app.services.tags.TagRepository") as repo_cls:
        repo_cls.return_value.get_by_id = AsyncMock(return_value=foreign_tag)
        with pytest.raises(AppError) as exc:
            await TagService(fake_db).get_manageable_tag_by_id(user, 7)

    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_merge_tag_rejects_cross_owner_target(fake_db, user):
    source_tag = Tag(id=1, owner_user_id=user.id, name="old", category=1, media_count=1)
    target_tag = Tag(id=2, owner_user_id=uuid.uuid4(), name="new", category=0, media_count=1)

    with pytest.raises(AppError) as exc:
        await TagService(fake_db).merge_tag(user, source_tag=source_tag, target_tag=target_tag)

    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_tag_media_full_flow_sets_processing_and_stores(fake_db, media):
    tagger = SimpleNamespace(predict=AsyncMock(return_value=TaggingResult(predictions=[TagPrediction("safe", 0, 0.9)], is_nsfw=False)))
    service = TagService(fake_db, tagger=tagger, library_enrichment=SimpleNamespace(enrich_media=AsyncMock()))

    with patch("backend.app.services.tags.MediaRepository") as media_repo_cls, patch(
        "backend.app.services.tags.sample_media_frames", return_value=[]
    ), patch.object(service, "_store_tagging_result", AsyncMock()) as store_fn:
        media_repo_cls.return_value.get_by_id = AsyncMock(return_value=media)
        await service.tag_media(media.id)

    assert media.tagging_status == "processing"
    assert store_fn.await_count == 1


@pytest.mark.asyncio
async def test_tag_media_passes_target_media_to_library_enrichment(fake_db, media):
    tagger = SimpleNamespace(predict=AsyncMock(return_value=TaggingResult(predictions=[TagPrediction("safe", 0, 0.9)], is_nsfw=False)))
    enrichment = SimpleNamespace(enrich_media=AsyncMock())
    service = TagService(fake_db, tagger=tagger, library_enrichment=enrichment)

    enabled_user = User(
        id=media.uploader_id,
        username="enabled",
        email="enabled@example.com",
        hashed_password="x",
        is_admin=False,
        show_nsfw=False,
        show_sensitive=False,
        tag_confidence_threshold=0.35,
        library_classification_enabled=True,
        version=1,
        storage_quota_mb=10240,
        created_at=datetime.now(timezone.utc),
    )

    with patch("backend.app.services.tags.MediaRepository") as media_repo_cls, patch(
        "backend.app.services.tags.sample_media_frames", return_value=[]
    ), patch.object(service, "_store_tagging_result", AsyncMock()) as store_fn:
        media_repo_cls.return_value.get_by_id = AsyncMock(return_value=media)
        fake_db.get = AsyncMock(return_value=enabled_user)
        await service.tag_media(media.id)

    store_fn.assert_awaited_once()
    enrichment.enrich_media.assert_awaited_once_with(
        media.id,
        user_id=media.uploader_id,
        target_media=media,
    )
