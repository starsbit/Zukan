from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from backend.app.models.auth import User
from backend.app.models.media import Media, MediaType, ProcessingStatus, TaggingStatus
from backend.app.models.media import MediaVisibility
from backend.app.models.relations import MediaEntity, MediaEntityType
from backend.app.repositories.embeddings import MediaNeighbor
from backend.app.services.library_classification import MediaLibraryEnrichmentService
from backend.app.services.tags import TagService
from backend.app.utils.tagging import TagPrediction, TaggingResult


def make_media(
    user_id: uuid.UUID,
    name: str,
    *,
    phash: str | None = None,
    character_names: list[tuple[str, str]] | None = None,
    series_names: list[tuple[str, str]] | None = None,
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
        deleted_at=None,
    )
    media.entities = [
        *[
            MediaEntity(
                id=uuid.uuid4(),
                media_id=media.id,
                entity_type=MediaEntityType.character,
                name=entity_name,
                role="primary",
                source=source,
                confidence=0.95,
            )
            for entity_name, source in (character_names or [])
        ],
        *[
            MediaEntity(
                id=uuid.uuid4(),
                media_id=media.id,
                entity_type=MediaEntityType.series,
                name=entity_name,
                role="primary",
                source=source,
                confidence=0.95,
            )
            for entity_name, source in (series_names or [])
        ],
    ]
    return media


@pytest.mark.asyncio
async def test_library_enrichment_uses_exact_phash_match_for_missing_series(fake_db, user):
    target = make_media(user.id, "target.webp", phash="samehash", character_names=[("Saber", "tagger")])
    candidate = make_media(
        user.id,
        "candidate.webp",
        phash="samehash",
        character_names=[("Saber", "tagger")],
        series_names=[("Fate/stay night", "manual")],
    )

    service = MediaLibraryEnrichmentService(fake_db)
    service._load_media = AsyncMock(return_value=target)
    service._load_exact_matches = AsyncMock(return_value=[candidate])
    service._load_media_by_ids = AsyncMock(return_value=[])
    service._embeddings.ensure_for_media = AsyncMock()
    service._embeddings.backfill_user_embeddings = AsyncMock(return_value=0)
    service._embedding_repo.get_by_media_id = AsyncMock(return_value=None)

    with patch("backend.app.services.library_classification.MediaEntityRepository") as entity_repo_cls:
        entity_repo_cls.return_value.add_media_entities = AsyncMock()

        result = await service.enrich_media(target.id, user_id=user.id)

    assert result.applied == {MediaEntityType.series: ["Fate/stay night"]}
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
async def test_library_enrichment_returns_suggestions_for_ambiguous_neighbors(fake_db, user):
    target = make_media(user.id, "target.webp")
    saber = make_media(
        user.id,
        "saber.webp",
        character_names=[("Saber", "manual")],
        series_names=[("Fate/stay night", "manual")],
    )
    rin = make_media(
        user.id,
        "rin.webp",
        character_names=[("Rin", "manual")],
        series_names=[("Fate/stay night", "manual")],
    )

    service = MediaLibraryEnrichmentService(fake_db)
    service._load_media = AsyncMock(return_value=target)
    service._load_exact_matches = AsyncMock(return_value=[])
    service._load_media_by_ids = AsyncMock(return_value=[saber, rin])
    service._embeddings.ensure_for_media = AsyncMock()
    service._embeddings.backfill_user_embeddings = AsyncMock(return_value=0)
    service._embedding_repo.get_by_media_id = AsyncMock(side_effect=[
        SimpleNamespace(embedding=[0.1, 0.2]),
    ])
    service._embedding_repo.nearest_neighbors = AsyncMock(return_value=[
        MediaNeighbor(media_id=saber.id, similarity=0.81),
        MediaNeighbor(media_id=rin.id, similarity=0.79),
    ])

    with patch("backend.app.services.library_classification.MediaEntityRepository") as entity_repo_cls:
        entity_repo_cls.return_value.add_media_entities = AsyncMock()

        result = await service.enrich_media(target.id, user_id=user.id)

    assert result.applied == {MediaEntityType.series: ["Fate/stay night"]}
    assert [suggestion.name for suggestion in result.suggestions[MediaEntityType.character]] == ["Saber", "Rin"]
    entity_repo_cls.return_value.add_media_entities.assert_awaited_once()
    fake_db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_library_enrichment_excludes_library_match_candidates(fake_db, user):
    target = make_media(user.id, "target.webp")
    candidate = make_media(
        user.id,
        "candidate.webp",
        character_names=[("Saber", "library_match")],
        series_names=[("Fate/stay night", "library_match")],
    )

    service = MediaLibraryEnrichmentService(fake_db)
    service._load_media = AsyncMock(return_value=target)
    service._load_exact_matches = AsyncMock(return_value=[])
    service._load_media_by_ids = AsyncMock(return_value=[candidate])
    service._embeddings.ensure_for_media = AsyncMock()
    service._embeddings.backfill_user_embeddings = AsyncMock(return_value=0)
    service._embedding_repo.get_by_media_id = AsyncMock(side_effect=[
        SimpleNamespace(embedding=[0.1, 0.2]),
    ])
    service._embedding_repo.nearest_neighbors = AsyncMock(return_value=[
        MediaNeighbor(media_id=candidate.id, similarity=0.96),
    ])

    with patch("backend.app.services.library_classification.MediaEntityRepository") as entity_repo_cls:
        entity_repo_cls.return_value.add_media_entities = AsyncMock()

        result = await service.enrich_media(target.id, user_id=user.id)

    assert result.applied == {}
    assert result.suggestions[MediaEntityType.character] == []
    assert result.suggestions[MediaEntityType.series] == []
    entity_repo_cls.return_value.add_media_entities.assert_not_awaited()


@pytest.mark.asyncio
async def test_library_enrichment_auto_applies_strong_neighbor_consensus(fake_db, user):
    target = make_media(user.id, "target.webp")
    saber_manual = make_media(
        user.id,
        "saber-manual.webp",
        character_names=[("Saber", "manual")],
        series_names=[("Fate/stay night", "manual")],
    )
    saber_tagger = make_media(
        user.id,
        "saber-tagger.webp",
        character_names=[("Saber", "tagger")],
        series_names=[("Fate/stay night", "tagger")],
    )

    service = MediaLibraryEnrichmentService(fake_db)
    service._load_media = AsyncMock(return_value=target)
    service._load_exact_matches = AsyncMock(return_value=[])
    service._load_media_by_ids = AsyncMock(return_value=[saber_manual, saber_tagger])
    service._embeddings.ensure_for_media = AsyncMock()
    service._embeddings.backfill_user_embeddings = AsyncMock(return_value=0)
    service._embedding_repo.get_by_media_id = AsyncMock(return_value=SimpleNamespace(embedding=[0.1, 0.2]))
    service._embedding_repo.nearest_neighbors = AsyncMock(return_value=[
        MediaNeighbor(media_id=saber_manual.id, similarity=0.93),
        MediaNeighbor(media_id=saber_tagger.id, similarity=0.91),
    ])

    with patch("backend.app.services.library_classification.MediaEntityRepository") as entity_repo_cls:
        entity_repo_cls.return_value.add_media_entities = AsyncMock()

        result = await service.enrich_media(target.id, user_id=user.id)

    assert result.applied == {
        MediaEntityType.character: ["Saber"],
        MediaEntityType.series: ["Fate/stay night"],
    }
    assert [call.kwargs["entity_type"] for call in entity_repo_cls.return_value.add_media_entities.await_args_list] == [
        MediaEntityType.character,
        MediaEntityType.series,
    ]
    assert [call.kwargs["names"] for call in entity_repo_cls.return_value.add_media_entities.await_args_list] == [
        ["Saber"],
        ["Fate/stay night"],
    ]
    fake_db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_library_enrichment_apply_false_keeps_suggestions_read_only(fake_db, user):
    target = make_media(user.id, "target.webp")
    candidate = make_media(
        user.id,
        "candidate.webp",
        character_names=[("Saber", "manual")],
        series_names=[("Fate/stay night", "manual")],
    )

    service = MediaLibraryEnrichmentService(fake_db)
    service._load_media = AsyncMock(return_value=target)
    service._load_exact_matches = AsyncMock(return_value=[])
    service._load_media_by_ids = AsyncMock(return_value=[candidate])
    service._embeddings.ensure_for_media = AsyncMock()
    service._embeddings.backfill_user_embeddings = AsyncMock(return_value=0)
    service._embedding_repo.get_by_media_id = AsyncMock(return_value=SimpleNamespace(embedding=[0.1, 0.2]))
    service._embedding_repo.nearest_neighbors = AsyncMock(return_value=[
        MediaNeighbor(media_id=candidate.id, similarity=0.97),
    ])

    with patch("backend.app.services.library_classification.MediaEntityRepository") as entity_repo_cls:
        entity_repo_cls.return_value.add_media_entities = AsyncMock()

        result = await service.enrich_media(target.id, user_id=user.id, apply=False)

    assert result.applied == {}
    assert [suggestion.name for suggestion in result.suggestions[MediaEntityType.character]] == ["Saber"]
    assert [suggestion.name for suggestion in result.suggestions[MediaEntityType.series]] == ["Fate/stay night"]
    entity_repo_cls.return_value.add_media_entities.assert_not_awaited()
    fake_db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_library_enrichment_does_not_override_existing_entities(fake_db, user):
    target = make_media(
        user.id,
        "target.webp",
        character_names=[("Existing Character", "manual")],
        series_names=[("Existing Series", "manual")],
    )

    service = MediaLibraryEnrichmentService(fake_db)
    service._load_media = AsyncMock(return_value=target)
    service._load_exact_matches = AsyncMock()
    service._load_media_by_ids = AsyncMock()
    service._embeddings.ensure_for_media = AsyncMock()
    service._embeddings.backfill_user_embeddings = AsyncMock()
    service._embedding_repo.get_by_media_id = AsyncMock()
    service._embedding_repo.nearest_neighbors = AsyncMock()

    with patch("backend.app.services.library_classification.MediaEntityRepository") as entity_repo_cls:
        entity_repo_cls.return_value.add_media_entities = AsyncMock()

        result = await service.enrich_media(target.id, user_id=user.id)

    assert result.applied == {}
    assert result.metadata["reason"] == "no_missing_entities"
    service._load_exact_matches.assert_not_awaited()
    service._embedding_repo.nearest_neighbors.assert_not_awaited()
    entity_repo_cls.return_value.add_media_entities.assert_not_awaited()
    fake_db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_tag_media_runs_library_enrichment_only_when_enabled(fake_db, media):
    tagger = SimpleNamespace(
        predict=AsyncMock(return_value=TaggingResult(predictions=[TagPrediction("safe", 0, 0.9)], is_nsfw=False)),
    )
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
    enrichment.enrich_media.assert_awaited_once_with(media.id, user_id=media.uploader_id)


@pytest.mark.asyncio
async def test_tag_media_skips_library_enrichment_when_disabled(fake_db, media):
    tagger = SimpleNamespace(
        predict=AsyncMock(return_value=TaggingResult(predictions=[TagPrediction("safe", 0, 0.9)], is_nsfw=False)),
    )
    enrichment = SimpleNamespace(enrich_media=AsyncMock())
    service = TagService(fake_db, tagger=tagger, library_enrichment=enrichment)

    disabled_user = User(
        id=media.uploader_id,
        username="disabled",
        email="disabled@example.com",
        hashed_password="x",
        is_admin=False,
        show_nsfw=False,
        show_sensitive=False,
        tag_confidence_threshold=0.35,
        library_classification_enabled=False,
        version=1,
        storage_quota_mb=10240,
        created_at=datetime.now(timezone.utc),
    )

    with patch("backend.app.services.tags.MediaRepository") as media_repo_cls, patch(
        "backend.app.services.tags.sample_media_frames", return_value=[]
    ), patch.object(service, "_store_tagging_result", AsyncMock()) as store_fn:
        media_repo_cls.return_value.get_by_id = AsyncMock(return_value=media)
        fake_db.get = AsyncMock(return_value=disabled_user)
        await service.tag_media(media.id)

    store_fn.assert_awaited_once()
    enrichment.enrich_media.assert_not_awaited()
