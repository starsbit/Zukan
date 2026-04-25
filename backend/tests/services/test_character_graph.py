from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
import uuid

import pytest

from backend.app.errors.error import AppError
from backend.app.models.relations import MediaEntityType
from backend.app.services.character_graph import CharacterGraphService


def _entity(name: str, media_count: int = 3):
    return SimpleNamespace(id=uuid.uuid4(), name=name, media_count=media_count)


def _media(series_name: str | None = None, *, is_nsfw: bool = False, is_nsfw_override: bool | None = None):
    return SimpleNamespace(
        id=uuid.uuid4(),
        media_tags=[],
        entities=[
            SimpleNamespace(entity_type=MediaEntityType.series, name=series_name)
        ] if series_name else [],
        is_nsfw=is_nsfw,
        is_nsfw_override=is_nsfw_override,
        thumbnail_path=None,
        poster_path=None,
        filepath="/tmp/does-not-exist.webp",
        uploaded_at=datetime.now(timezone.utc),
    )


def test_character_graph_builds_edges_and_applies_series_mode(fake_db):
    service = CharacterGraphService(fake_db)
    saber = _entity("Saber", media_count=8)
    rin = _entity("Rin Tohsaka", media_count=6)
    miku = _entity("Hatsune Miku", media_count=5)
    candidates = service._build_candidates(
        [
            (saber, _media("fate"), [1.0, 0.0]),
            (rin, _media("fate"), [0.98, 0.2]),
            (miku, _media("vocaloid"), [0.98, 0.2]),
        ],
        sample_size=2,
        include_nsfw_thumbnails=False,
    )

    same_series_edges = service._build_edges(candidates, min_similarity=0.65, series_mode="same")
    different_series_edges = service._build_edges(candidates, min_similarity=0.65, series_mode="different")

    assert len(candidates) == 3
    assert [candidate.name for candidate in candidates] == ["Saber", "Rin Tohsaka", "Hatsune Miku"]
    assert all(edge.shared_series == ["fate"] for edge in same_series_edges)
    assert same_series_edges
    assert different_series_edges
    assert all(edge.shared_series == [] for edge in different_series_edges)


def test_character_graph_excludes_rows_without_embeddings(fake_db):
    service = CharacterGraphService(fake_db)
    saber = _entity("Saber")

    candidates = service._build_candidates(
        [
            (saber, _media("fate"), []),
            (saber, _media("fate"), [0.0, 0.0]),
        ],
        sample_size=2,
        include_nsfw_thumbnails=False,
    )

    assert candidates == []


def test_centered_character_graph_keeps_center_and_strongest_neighbors(fake_db):
    service = CharacterGraphService(fake_db)
    saber = _entity("Saber", media_count=8)
    rin = _entity("Rin Tohsaka", media_count=6)
    far = _entity("Far Character", media_count=10)
    candidates = service._build_candidates(
        [
            (saber, _media("fate"), [1.0, 0.0]),
            (rin, _media("fate"), [0.99, 0.1]),
            (far, _media("other"), [0.0, 1.0]),
        ],
        sample_size=1,
        include_nsfw_thumbnails=False,
    )
    center = next(candidate for candidate in candidates if candidate.name == "Saber")

    selected = service._select_candidates(
        candidates,
        center=center,
        limit=2,
        min_similarity=0.65,
        series_mode="any",
    )

    assert [candidate.name for candidate in selected] == ["Saber", "Rin Tohsaka"]


def test_character_graph_raises_for_missing_center(fake_db):
    service = CharacterGraphService(fake_db)

    with pytest.raises(AppError) as exc:
        service._find_center([], center_entity_id=uuid.uuid4(), center_name=None)

    assert exc.value.status_code == 404


def test_character_graph_hides_nsfw_representative_thumbnails_when_user_hides_nsfw(fake_db):
    service = CharacterGraphService(fake_db)
    saber = _entity("Saber", media_count=3)
    safe_media = _media("fate")
    nsfw_media = _media("fate", is_nsfw=True)

    candidates = service._build_candidates(
        [
            (saber, nsfw_media, [1.0, 0.0]),
            (saber, safe_media, [0.95, 0.05]),
        ],
        sample_size=2,
        include_nsfw_thumbnails=False,
    )

    assert candidates[0].embedding_support == 2
    assert candidates[0].representative_media_ids == [safe_media.id]


def test_character_graph_includes_nsfw_representative_thumbnails_when_user_shows_nsfw(fake_db):
    service = CharacterGraphService(fake_db)
    saber = _entity("Saber", media_count=2)
    nsfw_media = _media("fate", is_nsfw=True)

    candidates = service._build_candidates(
        [(saber, nsfw_media, [1.0, 0.0])],
        sample_size=2,
        include_nsfw_thumbnails=True,
    )

    assert candidates[0].representative_media_ids == [nsfw_media.id]


def test_character_graph_honors_nsfw_override_for_representative_thumbnails(fake_db):
    service = CharacterGraphService(fake_db)
    saber = _entity("Saber", media_count=2)
    overridden_media = _media("fate", is_nsfw=False, is_nsfw_override=True)

    candidates = service._build_candidates(
        [(saber, overridden_media, [1.0, 0.0])],
        sample_size=2,
        include_nsfw_thumbnails=False,
    )

    assert candidates[0].representative_media_ids == []
