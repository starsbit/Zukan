from __future__ import annotations

import uuid

from backend.app.models.media import Media
from backend.app.schemas import MediaMetadata, MediaRead


def build_media_metadata(media: Media) -> MediaMetadata:
    return MediaMetadata(
        file_size=media.file_size,
        width=media.width,
        height=media.height,
        duration_seconds=media.duration_seconds,
        frame_count=media.frame_count,
        mime_type=media.mime_type,
        captured_at=media.captured_at or media.created_at,
    )


def build_media_read(media: Media, is_favorited: bool) -> MediaRead:
    return MediaRead(
        id=media.id,
        uploader_id=media.uploader_id,
        filename=media.filename,
        original_filename=media.original_filename,
        media_type=media.media_type,
        metadata=build_media_metadata(media),
        version=media.version,
        tags=sorted(mt.tag.name for mt in media.media_tags),
        ocr_text=media.ocr_text,
        ocr_text_override=media.ocr_text_override,
        is_nsfw=media.is_nsfw,
        tagging_status=media.tagging_status,
        tagging_error=media.tagging_error,
        thumbnail_status=media.thumbnail_status,
        poster_status=media.poster_status,
        created_at=media.created_at,
        deleted_at=media.deleted_at,
        is_favorited=is_favorited,
    )


def enrich_media(rows: list[Media], favorited: set[uuid.UUID]) -> list[MediaRead]:
    return [build_media_read(row, row.id in favorited) for row in rows]
