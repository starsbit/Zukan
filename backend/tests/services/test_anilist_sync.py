from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from backend.app.main import _run_anilist_sync_once
from backend.app.models.processing import BatchStatus, BatchType, ItemStatus
from backend.app.services.anilist import AniListSeries
from backend.app.services.anilist_sync import (
    AniListCharacterTarget,
    DanbooruPost,
    AniListSyncService,
    build_danbooru_character_candidates,
    build_danbooru_copyright_candidates,
    build_danbooru_tag_payloads,
    compute_media_phash,
    parse_danbooru_post,
)


def test_build_danbooru_copyright_candidates_normalizes_titles():
    assert build_danbooru_copyright_candidates(["Fate/Zero", "Fate Zero", ""]) == ["fate_zero"]


def test_build_danbooru_character_candidates_normalizes_names():
    assert build_danbooru_character_candidates(["Artoria Pendragon", "artoria_pendragon"]) == ["artoria_pendragon"]


def test_parse_danbooru_post_builds_category_maps():
    post = parse_danbooru_post(
        {
            "id": 12,
            "file_url": "https://example.com/image.webp",
            "source": "https://artist.example/post/12",
            "created_at": "2026-04-05T14:00:00Z",
            "tag_string_general": "solo night",
            "tag_string_artist": "takeuchi_takashi",
            "tag_string_copyright": "fate_zero",
            "tag_string_character": "saber",
            "tag_string_meta": "highres",
            "rating": "questionable",
        }
    )

    assert post is not None
    assert post.tags_by_category[3] == ["fate_zero"]
    assert post.tags_by_category[4] == ["saber"]
    assert post.tags_by_category[9] == ["rating:questionable"]


def test_build_danbooru_tag_payloads_keeps_categories():
    post = DanbooruPost(
        post_id=9,
        file_url="https://example.com/a.webp",
        source_url=None,
        created_at=datetime.now(UTC),
        tags_by_category={
            0: ["solo"],
            1: ["artist_name"],
            3: ["series_name"],
            4: ["character_name"],
            5: ["highres"],
            9: ["rating:explicit"],
        },
    )

    assert build_danbooru_tag_payloads(post) == [
        ("solo", 0, 1.0),
        ("artist_name", 1, 1.0),
        ("series_name", 3, 1.0),
        ("character_name", 4, 1.0),
        ("highres", 5, 1.0),
        ("rating:explicit", 9, 1.0),
    ]


def test_compute_media_phash_returns_stable_hash(tmp_path):
    from PIL import Image

    path = tmp_path / "image.png"
    Image.new("RGB", (20, 20), color="white").save(path)

    assert compute_media_phash(path) == compute_media_phash(path)


@pytest.mark.asyncio
async def test_sync_user_creates_anilist_sync_batch(fake_db, user):
    integration = SimpleNamespace(user=user, user_id=user.id, token="secret")
    service = AniListSyncService(fake_db)
    target = AniListCharacterTarget(
        series=AniListSeries(media_id=1, preferred_title="Fate/Zero", titles=["Fate/Zero"]),
        character=SimpleNamespace(character_id=7, preferred_name="Saber", names=["Saber"]),
    )

    with patch.object(service, "_build_character_targets", AsyncMock(return_value=[target])), patch.object(
        service, "_import_character_for_user", AsyncMock(return_value=[uuid.uuid4()])
    ), patch.object(service, "_publish_character_import_notification", AsyncMock()), patch.object(
        service, "_publish_sync_summary_notification", AsyncMock()
    ), patch.object(service._query, "get_import_batch_statuses", AsyncMock(return_value=[ItemStatus.done])):
        batch = await service.sync_user(integration)

    assert batch.type == BatchType.anilist_sync
    assert batch.status == BatchStatus.done
    items = [obj for obj in fake_db.added if obj.__class__.__name__ == "ImportBatchItem"]
    assert len(items) == 1
    assert items[0].status == ItemStatus.done
    assert items[0].source_filename == "Saber (Fate/Zero)"


@pytest.mark.asyncio
async def test_build_character_targets_expands_series_to_characters(fake_db):
    service = AniListSyncService(fake_db)
    series = AniListSeries(media_id=1, preferred_title="Fate/Zero", titles=["Fate/Zero"])
    characters = [
        SimpleNamespace(character_id=11, preferred_name="Saber", names=["Saber"]),
        SimpleNamespace(character_id=12, preferred_name="Rin Tohsaka", names=["Rin Tohsaka"]),
    ]

    with patch("backend.app.services.anilist_sync.fetch_user_anime_series", AsyncMock(return_value=[series])), patch(
        "backend.app.services.anilist_sync.fetch_series_characters", AsyncMock(return_value=characters)
    ):
        targets = await service._build_character_targets("secret")

    assert [target.source_filename for target in targets] == ["Saber (Fate/Zero)", "Rin Tohsaka (Fate/Zero)"]


@pytest.mark.asyncio
async def test_run_anilist_sync_once_uses_service():
    session = SimpleNamespace()

    class _SessionContext:
        async def __aenter__(self):
            return session

        async def __aexit__(self, exc_type, exc, tb):
            return False

    with patch("backend.app.main.AsyncSessionLocal", return_value=_SessionContext()), patch(
        "backend.app.main.AniListSyncService"
    ) as service_cls:
        service_cls.return_value.sync_all_linked_users = AsyncMock(return_value=4)
        synced = await _run_anilist_sync_once()

    assert synced == 4
