from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from backend.app.config import settings
from backend.app.models.auth import User
from backend.app.models.media import Media, MediaType, ProcessingStatus, TaggingStatus
from backend.app.models.media import MediaVisibility
from backend.app.models.relations import MediaEntity, MediaEntityType
from backend.app.schemas import LibraryClassificationFeedbackCreate
from backend.app.repositories.embeddings import MediaNeighbor
from backend.app.services.hybrid_similarity import HybridScoreBreakdown, MediaSimilarityProfile
from backend.app.services.library_classification import CharacterFeedbackStats, CharacterPrototype, MediaLibraryEnrichmentService, SignatureVote
from backend.app.services.tags import TagService
from backend.tests.services.conftest import RowResult
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
        replace_existing_type=False,
    )
    fake_db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_library_enrichment_auto_applies_character_for_missing_slot_only(fake_db, user):
    target = make_media(
        user.id,
        "target.webp",
        series_names=[("Existing Series", "manual")],
    )

    service = MediaLibraryEnrichmentService(fake_db)
    service._load_media = AsyncMock(return_value=target)
    service._load_exact_matches = AsyncMock(return_value=[])
    service._load_media_by_ids = AsyncMock(return_value=[])
    service._embeddings.ensure_for_media = AsyncMock()
    service._embeddings.backfill_user_embeddings = AsyncMock(return_value=0)
    service._embedding_repo.get_by_media_id = AsyncMock(return_value=None)
    service._score_character_prototypes = AsyncMock(return_value={
        "auto_names": ["Saber"],
        "confidence": 0.91,
        "suggestions": [],
        "metadata": {"reason": "prototype_auto_apply", "explanation": "high confidence"},
    })
    service._score_signatures = lambda **_: {
        "auto_names": [],
        "confidence": None,
        "suggestions": [],
        "metadata": {"reason": "suggest_only"},
    }
    service._record_feedback = AsyncMock()

    with patch("backend.app.services.library_classification.MediaEntityRepository") as entity_repo_cls:
        entity_repo_cls.return_value.add_media_entities = AsyncMock()

        result = await service.enrich_media(target.id, user_id=user.id)

    assert result.applied == {MediaEntityType.character: ["Saber"]}
    entity_repo_cls.return_value.add_media_entities.assert_awaited_once_with(
        target,
        entity_type=MediaEntityType.character,
        names=["Saber"],
        source="library_match",
        confidence=0.91,
        replace_existing_type=False,
    )
    fake_db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_library_enrichment_reloads_when_passed_target_media_is_not_ready(fake_db, user):
    loaded_target = make_media(user.id, "target.webp")
    partial_target = SimpleNamespace(
        id=loaded_target.id,
        uploader_id=user.id,
        deleted_at=None,
    )

    service = MediaLibraryEnrichmentService(fake_db)
    service._has_loaded_enrichment_relationships = lambda _: False
    service._load_media = AsyncMock(return_value=loaded_target)
    service._load_exact_matches = AsyncMock(return_value=[])
    service._load_media_by_ids = AsyncMock(return_value=[])
    service._embeddings.ensure_for_media = AsyncMock()
    service._embeddings.backfill_user_embeddings = AsyncMock(return_value=0)
    service._embedding_repo.get_by_media_id = AsyncMock(return_value=None)

    with patch("backend.app.services.library_classification.MediaEntityRepository") as entity_repo_cls:
        entity_repo_cls.return_value.add_media_entities = AsyncMock()

        result = await service.enrich_media(loaded_target.id, user_id=user.id, target_media=partial_target)

    service._load_media.assert_awaited_once_with(loaded_target.id, uploader_id=user.id)
    assert result.applied == {}
    entity_repo_cls.return_value.add_media_entities.assert_not_awaited()


@pytest.mark.asyncio
async def test_character_prototype_auto_apply_requires_positive_feedback_history(fake_db, user):
    target = make_media(user.id, "target.webp")
    service = MediaLibraryEnrichmentService(fake_db)
    service._rejected_suggestion_keys = AsyncMock(return_value=set())
    service._build_character_prototypes = AsyncMock(return_value=[
            CharacterPrototype(
                names=["Saber"],
                normalized_signature=("saber",),
                centroid=[1.0, 0.0],
                support_keys={f"media-{index}" for index in range(10)},
            )
    ])

    decision = await service._score_character_prototypes(
        user_id=user.id,
        target=target,
        target_embedding=[1.0, 0.0],
    )

    assert decision["auto_names"] == []
    assert decision["metadata"]["reason"] == "prototype_suggest_only"


@pytest.mark.asyncio
async def test_character_prototype_auto_applies_with_high_confidence_support_and_feedback(fake_db, user):
    target = make_media(user.id, "target.webp")
    service = MediaLibraryEnrichmentService(fake_db)
    service._rejected_suggestion_keys = AsyncMock(return_value=set())
    service._build_character_prototypes = AsyncMock(return_value=[
            CharacterPrototype(
                names=["Saber"],
                normalized_signature=("saber",),
                centroid=[1.0, 0.0],
                support_keys={f"media-{index}" for index in range(10)},
            )
    ])

    decision = await service._score_character_prototypes(
        user_id=user.id,
        target=target,
        target_embedding=[1.0, 0.0],
        feedback_stats={("saber",): CharacterFeedbackStats(accepted=2, rejected=0)},
    )

    assert decision["auto_names"] == ["Saber"]
    assert decision["metadata"]["reason"] == "prototype_auto_apply"


@pytest.mark.asyncio
async def test_character_prototype_single_high_match_is_suppressed_by_confidence(fake_db, user):
    target = make_media(user.id, "target.webp")
    service = MediaLibraryEnrichmentService(fake_db)
    service._rejected_suggestion_keys = AsyncMock(return_value=set())
    service._build_character_prototypes = AsyncMock(return_value=[
        CharacterPrototype(
            names=["Saber"],
            normalized_signature=("saber",),
            centroid=[1.0, 0.0],
            support_keys={"media-a"},
        )
    ])

    decision = await service._score_character_prototypes(
        user_id=user.id,
        target=target,
        target_embedding=[1.0, 0.0],
    )

    assert decision["auto_names"] == []
    assert decision["suggestions"] == []
    assert decision["metadata"]["reason"] == "no_ranked_prototypes"


@pytest.mark.asyncio
async def test_character_prototypes_use_manual_labels_only(fake_db, user):
    service = MediaLibraryEnrichmentService(fake_db)
    fake_db.execute = AsyncMock(return_value=RowResult([]))

    await service._build_character_prototypes(
        user_id=user.id,
        target_media_id=uuid.uuid4(),
    )

    stmt = fake_db.execute.await_args.args[0]
    compiled = stmt.compile()
    source_values = [
        value
        for key, value in compiled.params.items()
        if key.startswith("source_")
    ]
    assert source_values == ["manual"]


def test_trusted_entity_names_include_only_high_confidence_tagger_labels(fake_db, user):
    service = MediaLibraryEnrichmentService(fake_db)
    low_confidence = make_media(user.id, "low.webp", character_names=[("Saber", "tagger")])
    high_confidence = make_media(user.id, "high.webp", character_names=[("Saber", "tagger")])
    high_confidence.entities[0].confidence = 0.99
    manual = make_media(user.id, "manual.webp", character_names=[("Saber", "manual")])
    manual.entities[0].confidence = 0.2

    assert service._trusted_entity_names(low_confidence, MediaEntityType.character) == []
    assert service._trusted_entity_names(high_confidence, MediaEntityType.character) == ["Saber"]
    assert service._trusted_entity_names(manual, MediaEntityType.character) == ["Saber"]


def test_character_feedback_adjustment_rewards_and_penalizes_scores(fake_db):
    service = MediaLibraryEnrichmentService(fake_db)

    rewarded = service._apply_character_feedback_adjustment(
        0.5,
        ("saber",),
        {("saber",): CharacterFeedbackStats(accepted=5, rejected=0)},
    )
    penalized = service._apply_character_feedback_adjustment(
        0.5,
        ("saber",),
        {("saber",): CharacterFeedbackStats(accepted=0, rejected=5)},
    )

    assert rewarded == pytest.approx(0.66)
    assert penalized == pytest.approx(0.18)


def test_character_evidence_score_penalizes_low_context_overlap(fake_db):
    service = MediaLibraryEnrichmentService(fake_db)
    target = MediaSimilarityProfile(embedding=[1.0, 0.0], tags={"fox", "uniform", "white hair"})
    candidate = MediaSimilarityProfile(embedding=[0.86, 0.51], tags={"witch", "black dress", "white hair"})

    score = service._character_evidence_score(
        0.67,
        HybridScoreBreakdown(visual=0.86, tags=0.05, color=0.86, confidence=1.0, series_penalty=1.0),
        target,
        candidate,
    )

    assert score == pytest.approx(0.3015)


def test_character_evidence_score_keeps_very_strong_visual_matches(fake_db):
    service = MediaLibraryEnrichmentService(fake_db)
    target = MediaSimilarityProfile(embedding=[1.0, 0.0], tags={"fox", "uniform", "white hair"})
    candidate = MediaSimilarityProfile(embedding=[0.94, 0.34], tags={"witch", "black dress", "white hair"})

    score = service._character_evidence_score(
        0.67,
        HybridScoreBreakdown(visual=0.94, tags=0.05, color=0.86, confidence=1.0, series_penalty=1.0),
        target,
        candidate,
    )

    assert score == pytest.approx(0.67)


def test_build_suggestions_uses_absolute_confidence(fake_db):
    service = MediaLibraryEnrichmentService(fake_db)

    suggestions = service._build_suggestions([
        SignatureVote(names=["Echidna"], normalized_signature=("echidna",), score=0.67, max_similarity=0.67),
        SignatureVote(names=["Nero"], normalized_signature=("nero",), score=0.61, max_similarity=0.61),
    ])

    assert [suggestion.confidence for suggestion in suggestions] == [0.67, 0.61]


@pytest.mark.asyncio
async def test_record_feedback_persists_entity_id_aware_rejection(fake_db, user):
    media = make_media(user.id, "target.webp")
    entity_id = uuid.uuid4()
    fake_db.get = AsyncMock(return_value=media)
    service = MediaLibraryEnrichmentService(fake_db)

    feedback = await service.record_feedback(
        user.id,
        LibraryClassificationFeedbackCreate(
            media_id=media.id,
            entity_type=MediaEntityType.character,
            suggested_entity_id=entity_id,
            suggested_name="Saber",
            series_name="Fate/stay night",
            action="rejected",
            source="prototype",
            similarity=0.81,
            explanation="Matched 2 manual examples of Saber.",
        ),
    )

    assert feedback is not None
    assert feedback.suggested_entity_id == entity_id
    assert feedback.suggested_name == "Saber"
    assert feedback.action.value == "rejected"
    fake_db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_record_feedback_bulk_skips_media_not_owned_by_user(fake_db, user):
    owned_media_id = uuid.uuid4()
    foreign_media_id = uuid.uuid4()
    fake_db.execute = AsyncMock(return_value=RowResult([SimpleNamespace(id=owned_media_id)]))
    service = MediaLibraryEnrichmentService(fake_db)

    result = await service.record_feedback_bulk(
        user.id,
        [
            LibraryClassificationFeedbackCreate(
                media_id=owned_media_id,
                entity_type=MediaEntityType.character,
                suggested_name="Saber",
                action="accepted",
            ),
            LibraryClassificationFeedbackCreate(
                media_id=foreign_media_id,
                entity_type=MediaEntityType.character,
                suggested_name="Rin",
                action="rejected",
            ),
        ],
    )

    assert result.processed == 1
    assert result.skipped == 1
    assert len(fake_db.added) == 1
    assert fake_db.added[0].suggested_name == "Saber"
    fake_db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_library_enrichment_derives_series_from_existing_character_before_vector_majority(fake_db, user):
    target = make_media(user.id, "target.webp", character_names=[("Saber", "tagger")])
    blue_archive_neighbor = make_media(
        user.id,
        "blue-archive.webp",
        character_names=[("Arona", "manual")],
        series_names=[("Blue Archive", "manual")],
    )

    service = MediaLibraryEnrichmentService(fake_db)
    service._load_media = AsyncMock(return_value=target)
    service._load_exact_matches = AsyncMock(return_value=[])
    service._load_media_by_ids = AsyncMock(return_value=[blue_archive_neighbor])
    service._embeddings.ensure_for_media = AsyncMock()
    service._embeddings.backfill_user_embeddings = AsyncMock(return_value=0)
    service._embedding_repo.get_by_media_id = AsyncMock(return_value=SimpleNamespace(embedding=[0.1, 0.2]))
    service._embedding_repo.nearest_neighbors = AsyncMock(return_value=[
        MediaNeighbor(media_id=blue_archive_neighbor.id, similarity=0.98),
    ])
    fake_db.execute = AsyncMock(return_value=RowResult([
        SimpleNamespace(name="Fate/stay night", media_count=2),
    ]))

    with patch("backend.app.services.library_classification.MediaEntityRepository") as entity_repo_cls:
        entity_repo_cls.return_value.add_media_entities = AsyncMock()

        result = await service.enrich_media(target.id, user_id=user.id)

    assert result.applied == {MediaEntityType.series: ["Fate/stay night"]}
    assert [suggestion.name for suggestion in result.suggestions[MediaEntityType.series]] == ["Fate/stay night"]
    assert result.metadata["series"]["reason"] == "character_inference_auto_apply"
    entity_repo_cls.return_value.add_media_entities.assert_awaited_once_with(
        target,
        entity_type=MediaEntityType.series,
        names=["Fate/stay night"],
        source="library_match",
        confidence=1.0,
        replace_existing_type=False,
    )


@pytest.mark.asyncio
async def test_library_enrichment_derives_series_after_strong_character_prediction(fake_db, user):
    target = make_media(user.id, "target.webp")
    saber_blue_one = make_media(
        user.id,
        "saber-blue-one.webp",
        character_names=[("Saber", "manual")],
        series_names=[("Blue Archive", "manual")],
    )
    saber_blue_two = make_media(
        user.id,
        "saber-blue-two.webp",
        character_names=[("Saber", "tagger")],
        series_names=[("Blue Archive", "tagger")],
    )

    service = MediaLibraryEnrichmentService(fake_db)
    service._load_media = AsyncMock(return_value=target)
    service._load_exact_matches = AsyncMock(return_value=[])
    service._load_media_by_ids = AsyncMock(return_value=[saber_blue_one, saber_blue_two])
    service._embeddings.ensure_for_media = AsyncMock()
    service._embeddings.backfill_user_embeddings = AsyncMock(return_value=0)
    service._embedding_repo.get_by_media_id = AsyncMock(return_value=SimpleNamespace(embedding=[0.1, 0.2]))
    service._embedding_repo.nearest_neighbors = AsyncMock(return_value=[
        MediaNeighbor(media_id=saber_blue_one.id, similarity=0.94),
        MediaNeighbor(media_id=saber_blue_two.id, similarity=0.93),
    ])
    fake_db.execute = AsyncMock(return_value=RowResult([
        SimpleNamespace(name="Fate/stay night", media_count=3),
    ]))

    with patch("backend.app.services.library_classification.MediaEntityRepository") as entity_repo_cls:
        entity_repo_cls.return_value.add_media_entities = AsyncMock()

        result = await service.enrich_media(target.id, user_id=user.id)

    assert result.applied == {}
    assert [suggestion.name for suggestion in result.suggestions[MediaEntityType.character]] == ["Saber"]
    assert [suggestion.name for suggestion in result.suggestions[MediaEntityType.series]] == ["Blue Archive"]
    entity_repo_cls.return_value.add_media_entities.assert_not_awaited()


@pytest.mark.asyncio
async def test_library_enrichment_returns_character_derived_series_suggestions_read_only(fake_db, user):
    target = make_media(user.id, "target.webp", character_names=[("Saber", "tagger")])
    blue_archive_neighbor = make_media(
        user.id,
        "blue-archive.webp",
        series_names=[("Blue Archive", "manual")],
    )

    service = MediaLibraryEnrichmentService(fake_db)
    service._load_media = AsyncMock(return_value=target)
    service._load_exact_matches = AsyncMock(return_value=[])
    service._load_media_by_ids = AsyncMock(return_value=[blue_archive_neighbor])
    service._embeddings.ensure_for_media = AsyncMock()
    service._embeddings.backfill_user_embeddings = AsyncMock(return_value=0)
    service._embedding_repo.get_by_media_id = AsyncMock(return_value=SimpleNamespace(embedding=[0.1, 0.2]))
    service._embedding_repo.nearest_neighbors = AsyncMock(return_value=[
        MediaNeighbor(media_id=blue_archive_neighbor.id, similarity=0.99),
    ])
    fake_db.execute = AsyncMock(return_value=RowResult([
        SimpleNamespace(name="Fate/stay night", media_count=3),
        SimpleNamespace(name="Fate/Zero", media_count=1),
    ]))

    with patch("backend.app.services.library_classification.MediaEntityRepository") as entity_repo_cls:
        entity_repo_cls.return_value.add_media_entities = AsyncMock()

        result = await service.enrich_media(target.id, user_id=user.id, apply=False)

    assert result.applied == {}
    assert [suggestion.name for suggestion in result.suggestions[MediaEntityType.series]] == [
        "Fate/stay night",
        "Fate/Zero",
    ]
    assert result.metadata["series"]["reason"] == "character_inference_auto_apply"
    entity_repo_cls.return_value.add_media_entities.assert_not_awaited()
    fake_db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_library_enrichment_does_not_auto_apply_ambiguous_character_series_inference(fake_db, user):
    target = make_media(user.id, "target.webp", character_names=[("Saber", "tagger")])
    blue_archive_neighbor = make_media(
        user.id,
        "blue-archive.webp",
        series_names=[("Blue Archive", "manual")],
    )

    service = MediaLibraryEnrichmentService(fake_db)
    service._load_media = AsyncMock(return_value=target)
    service._load_exact_matches = AsyncMock(return_value=[])
    service._load_media_by_ids = AsyncMock(return_value=[blue_archive_neighbor])
    service._embeddings.ensure_for_media = AsyncMock()
    service._embeddings.backfill_user_embeddings = AsyncMock(return_value=0)
    service._embedding_repo.get_by_media_id = AsyncMock(return_value=SimpleNamespace(embedding=[0.1, 0.2]))
    service._embedding_repo.nearest_neighbors = AsyncMock(return_value=[
        MediaNeighbor(media_id=blue_archive_neighbor.id, similarity=0.99),
    ])
    fake_db.execute = AsyncMock(return_value=RowResult([
        SimpleNamespace(name="Fate/stay night", media_count=2),
        SimpleNamespace(name="Fate/Zero", media_count=2),
    ]))

    with patch("backend.app.services.library_classification.MediaEntityRepository") as entity_repo_cls:
        entity_repo_cls.return_value.add_media_entities = AsyncMock()

        result = await service.enrich_media(target.id, user_id=user.id)

    assert result.applied == {}
    assert [suggestion.name for suggestion in result.suggestions[MediaEntityType.series]] == [
        "Fate/stay night",
        "Fate/Zero",
        "Blue Archive",
    ]
    assert result.metadata["series"]["reason"] == "character_inference_suggest_only"
    assert result.metadata["series"]["fallback_neighbor_reason"] == "suggest_only"
    entity_repo_cls.return_value.add_media_entities.assert_not_awaited()
    fake_db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_library_enrichment_excludes_library_match_sources_from_character_series_inference(fake_db, user):
    target_id = uuid.uuid4()
    service = MediaLibraryEnrichmentService(fake_db)
    fake_db.execute = AsyncMock(return_value=RowResult([]))

    result = await service._infer_series_from_characters(
        user_id=user.id,
        target_media_id=target_id,
        character_names=["Saber"],
    )

    stmt = fake_db.execute.await_args.args[0]
    compiled = stmt.compile()
    source_values = [
        value
        for key, value in compiled.params.items()
        if key.startswith("source_")
    ]
    confidence_values = [
        value
        for key, value in compiled.params.items()
        if key.startswith("confidence_")
    ]
    assert result["suggestions"] == []
    assert source_values
    assert "manual" in source_values
    assert "tagger" in source_values
    assert "library_match" not in source_values
    assert settings.library_classification_trusted_tagger_min_confidence in confidence_values


@pytest.mark.asyncio
async def test_library_enrichment_falls_back_to_vector_series_when_character_inference_has_no_result(fake_db, user):
    target = make_media(user.id, "target.webp", character_names=[("Arona", "tagger")])
    blue_archive_neighbor = make_media(
        user.id,
        "blue-archive.webp",
        series_names=[("Blue Archive", "manual")],
    )

    service = MediaLibraryEnrichmentService(fake_db)
    service._load_media = AsyncMock(return_value=target)
    service._load_exact_matches = AsyncMock(return_value=[])
    service._load_media_by_ids = AsyncMock(return_value=[blue_archive_neighbor])
    service._embeddings.ensure_for_media = AsyncMock()
    service._embeddings.backfill_user_embeddings = AsyncMock(return_value=0)
    service._embedding_repo.get_by_media_id = AsyncMock(return_value=SimpleNamespace(embedding=[0.1, 0.2]))
    service._embedding_repo.nearest_neighbors = AsyncMock(return_value=[
        MediaNeighbor(media_id=blue_archive_neighbor.id, similarity=0.98),
    ])
    fake_db.execute = AsyncMock(return_value=RowResult([]))

    with patch("backend.app.services.library_classification.MediaEntityRepository") as entity_repo_cls:
        entity_repo_cls.return_value.add_media_entities = AsyncMock()

        result = await service.enrich_media(target.id, user_id=user.id)

    assert result.applied == {}
    assert [suggestion.name for suggestion in result.suggestions[MediaEntityType.series]] == ["Blue Archive"]
    assert result.metadata["series"]["reason"] == "suggest_only"


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

    assert result.applied == {}
    assert [suggestion.name for suggestion in result.suggestions[MediaEntityType.character]] == ["Saber", "Rin"]
    assert [suggestion.name for suggestion in result.suggestions[MediaEntityType.series]] == ["Fate/stay night"]
    entity_repo_cls.return_value.add_media_entities.assert_not_awaited()
    fake_db.commit.assert_not_awaited()


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

    assert result.applied == {}
    assert [suggestion.name for suggestion in result.suggestions[MediaEntityType.character]] == ["Saber"]
    assert [suggestion.name for suggestion in result.suggestions[MediaEntityType.series]] == ["Fate/stay night"]
    entity_repo_cls.return_value.add_media_entities.assert_not_awaited()
    fake_db.commit.assert_not_awaited()


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
async def test_tag_media_does_not_block_on_library_enrichment(fake_db, media):
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
    enrichment.enrich_media.assert_not_awaited()


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
