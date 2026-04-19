from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from backend.app.models.media import Media, MediaType, ProcessingStatus, TaggingStatus
from backend.app.models.media import MediaVisibility
from backend.app.models.relations import MediaEntity, MediaEntityType
from backend.app.models.tags import MediaTag, Tag
from backend.app.services.library_matching import MediaLibraryEnrichmentService
from backend.app.services.tags import TagService
from backend.app.utils.tagging import TagPrediction, TaggingResult
from backend.tests.services.conftest import ScalarResult


def make_media(
    user_id: uuid.UUID,
    name: str,
    *,
    phash: str | None = None,
    ocr_text: str | None = None,
    character_names: list[str] | None = None,
    series_names: list[str] | None = None,
    tags: list[tuple[int, str, int, float]] | None = None,
) -> Media:
    now = datetime.now(timezone.utc)
    media = Media(
        id=uuid.uuid4(),
        uploader_id=user_id,
        owner_id=user_id,
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
        deleted_at=None,
    )
    media.entities = [
        *[
            MediaEntity(
                id=uuid.uuid4(),
                media_id=media.id,
                entity_type=MediaEntityType.character,
                name=name,
                role="primary",
                source="tagger",
                confidence=0.95,
            )
            for name in (character_names or [])
        ],
        *[
            MediaEntity(
                id=uuid.uuid4(),
                media_id=media.id,
                entity_type=MediaEntityType.series,
                name=name,
                role="primary",
                source="tagger",
                confidence=0.95,
            )
            for name in (series_names or [])
        ],
    ]
    media.media_tags = [
        MediaTag(
            media_id=media.id,
            tag_id=tag_id,
            confidence=confidence,
            tag=Tag(id=tag_id, name=tag_name, category=category, media_count=4),
        )
        for tag_id, tag_name, category, confidence in (tags or [])
    ]
    return media


@pytest.mark.asyncio
async def test_library_enrichment_uses_exact_phash_match_for_missing_series(fake_db, user):
    target = make_media(user.id, "target.webp", phash="samehash", character_names=["Saber"])
    candidate = make_media(
        user.id,
        "candidate.webp",
        phash="samehash",
        character_names=["Saber"],
        series_names=["Fate/stay night"],
    )
    fake_db.execute = AsyncMock(side_effect=[
        ScalarResult(one=target),
        ScalarResult(rows=[candidate]),
    ])

    service = MediaLibraryEnrichmentService(fake_db)

    with patch("backend.app.services.library_matching.MediaEntityRepository") as entity_repo_cls:
        entity_repo_cls.return_value.add_media_entities = AsyncMock()

        applied = await service.enrich_media(target.id, user_id=user.id)

    assert applied == {MediaEntityType.series: ["Fate/stay night"]}
    entity_repo_cls.return_value.add_media_entities.assert_awaited_once_with(
        target,
        entity_type=MediaEntityType.series,
        names=["Fate/stay night"],
        source="library_match",
        confidence=0.99,
        replace_existing_type=True,
    )
    fake_db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_library_enrichment_uses_strong_similarity_for_missing_character(fake_db, user):
    shared_tags = [
        (1, "blue dress", 0, 0.94),
        (2, "fate/stay night", 3, 0.92),
    ]
    target = make_media(user.id, "target.webp", tags=shared_tags, series_names=["Fate/stay night"], ocr_text="fuyuki")
    candidate = make_media(
        user.id,
        "candidate.webp",
        tags=shared_tags,
        character_names=["Saber"],
        series_names=["Fate/stay night"],
        ocr_text="fuyuki",
    )
    weak_candidate = make_media(
        user.id,
        "weak.webp",
        tags=[(3, "outdoor", 0, 0.85)],
        character_names=["Rin"],
        series_names=["Fate/stay night"],
        ocr_text="park",
    )
    fake_db.execute = AsyncMock(side_effect=[
        ScalarResult(one=target),
        ScalarResult(rows=[candidate, weak_candidate]),
    ])

    service = MediaLibraryEnrichmentService(fake_db)

    with patch("backend.app.services.library_matching.MediaEntityRepository") as entity_repo_cls:
        entity_repo_cls.return_value.add_media_entities = AsyncMock()

        applied = await service.enrich_media(target.id, user_id=user.id)

    assert applied == {MediaEntityType.character: ["Saber"]}
    add_call = entity_repo_cls.return_value.add_media_entities.await_args
    assert add_call.kwargs["source"] == "library_match"
    assert add_call.kwargs["replace_existing_type"] is True
    assert add_call.kwargs["names"] == ["Saber"]
    assert add_call.kwargs["confidence"] >= 0.72


@pytest.mark.asyncio
async def test_library_enrichment_skips_ambiguous_top_matches(fake_db, user):
    shared_tags = [
        (1, "blue dress", 0, 0.94),
        (2, "fate/stay night", 3, 0.92),
    ]
    target = make_media(user.id, "target.webp", tags=shared_tags, ocr_text="fuyuki")
    saber_candidate = make_media(
        user.id,
        "saber.webp",
        tags=shared_tags,
        character_names=["Saber"],
        series_names=["Fate/stay night"],
        ocr_text="fuyuki",
    )
    rin_candidate = make_media(
        user.id,
        "rin.webp",
        tags=shared_tags,
        character_names=["Rin"],
        series_names=["Fate/stay night"],
        ocr_text="fuyuki",
    )
    fake_db.execute = AsyncMock(side_effect=[
        ScalarResult(one=target),
        ScalarResult(rows=[saber_candidate, rin_candidate]),
    ])

    service = MediaLibraryEnrichmentService(fake_db)

    with patch("backend.app.services.library_matching.MediaEntityRepository") as entity_repo_cls:
        entity_repo_cls.return_value.add_media_entities = AsyncMock()

        applied = await service.enrich_media(target.id, user_id=user.id)

    assert applied == {}
    entity_repo_cls.return_value.add_media_entities.assert_not_awaited()
    fake_db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_library_enrichment_only_fills_missing_types(fake_db, user):
    shared_tags = [
        (1, "blue dress", 0, 0.94),
        (2, "fate/stay night", 3, 0.92),
    ]
    target = make_media(user.id, "target.webp", tags=shared_tags, character_names=["Saber"], series_names=["Fate/stay night"])
    candidate = make_media(
        user.id,
        "candidate.webp",
        tags=shared_tags,
        character_names=["Saber Alter"],
        series_names=["Fate/Zero"],
        ocr_text="fuyuki",
    )
    fake_db.execute = AsyncMock(side_effect=[
        ScalarResult(one=target),
    ])

    service = MediaLibraryEnrichmentService(fake_db)

    with patch("backend.app.services.library_matching.MediaEntityRepository") as entity_repo_cls:
        entity_repo_cls.return_value.add_media_entities = AsyncMock()

        applied = await service.enrich_media(target.id, user_id=user.id)

    assert applied == {}
    entity_repo_cls.return_value.add_media_entities.assert_not_awaited()
    fake_db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_tag_media_runs_library_enrichment_after_storing_results(fake_db, media):
    tagger = SimpleNamespace(
        predict=AsyncMock(return_value=TaggingResult(predictions=[TagPrediction("safe", 0, 0.9)], is_nsfw=False)),
    )
    enrichment = SimpleNamespace(enrich_media=AsyncMock())
    service = TagService(fake_db, tagger=tagger, library_enrichment=enrichment)

    with patch("backend.app.services.tags.MediaRepository") as media_repo_cls, patch(
        "backend.app.services.tags.sample_media_frames", return_value=[]
    ), patch.object(service, "_store_tagging_result", AsyncMock()) as store_fn:
        media_repo_cls.return_value.get_by_id = AsyncMock(return_value=media)
        await service.tag_media(media.id)

    store_fn.assert_awaited_once()
    enrichment.enrich_media.assert_awaited_once_with(media.id, user_id=media.uploader_id)
