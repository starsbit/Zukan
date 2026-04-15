from __future__ import annotations

import uuid
from datetime import datetime, timezone

from backend.app.models.auth import User
from backend.app.models.media import Media, MediaType, MediaVisibility, ProcessingStatus, TaggingStatus
from backend.app.models.tags import MediaTag, Tag
from backend.app.utils.media_projections import build_media_metadata, build_media_read, enrich_media


def _make_media() -> Media:
    now = datetime.now(timezone.utc)
    media = Media(
        id=uuid.uuid4(),
        uploader_id=uuid.uuid4(),
        filename="x.webp",
        original_filename="x.webp",
        filepath="/tmp/x.webp",
        file_size=123,
        sha256="a" * 64,
        mime_type="image/webp",
        media_type=MediaType.IMAGE,
        width=100,
        height=200,
        duration_seconds=None,
        frame_count=1,
        is_nsfw=False,
        is_sensitive=False,
        tagging_status=TaggingStatus.DONE,
        tagging_error=None,
        thumbnail_status=ProcessingStatus.DONE,
        poster_status=ProcessingStatus.NOT_APPLICABLE,
        captured_at=now,
        uploaded_at=now,
        deleted_at=None,
        version=1,
        visibility=MediaVisibility.private,
    )
    t1 = Tag(id=1, name="b", category=0, media_count=1)
    t2 = Tag(id=2, name="a", category=0, media_count=1)
    media.media_tags = [MediaTag(tag=t1, confidence=0.5), MediaTag(tag=t2, confidence=0.6)]
    media.entities = []
    media.external_refs = []
    media.uploader = User(username="uploader", email="uploader@example.com", hashed_password="x")
    media.owner = User(username="owner", email="owner@example.com", hashed_password="x")
    return media


def test_build_media_metadata_uses_captured_or_created_at():
    media = _make_media()
    md = build_media_metadata(media)
    assert md.width == 100
    assert md.captured_at == media.captured_at


def test_build_media_read_and_enrich_media():
    media = _make_media()
    read = build_media_read(media, True)
    assert read.is_favorited is True
    assert read.tags == ["a", "b"]
    assert read.uploader_username == "uploader"
    assert read.owner_username == "owner"
    assert read.uploaded_at == media.uploaded_at

    result = enrich_media([media], {media.id}, {media.id: 3})
    assert len(result) == 1
    assert result[0].is_favorited is True
    assert result[0].favorite_count == 3
