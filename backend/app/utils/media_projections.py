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
        captured_at=media.captured_at or media.uploaded_at,
    )


def build_media_read(media: Media, is_favorited: bool, favorite_count: int = 0, tag_names: list[str] | None = None) -> MediaRead:
    owner_id = media.owner_id or media.uploader_id
    owner = media.owner or media.uploader
    return MediaRead(
        id=media.id,
        uploader_id=media.uploader_id,
        uploader_username=media.uploader.username if media.uploader is not None else None,
        owner_id=owner_id,
        owner_username=owner.username if owner is not None else None,
        visibility=media.visibility,
        filename=media.filename,
        original_filename=media.original_filename,
        media_type=media.media_type,
        metadata=build_media_metadata(media),
        version=media.version,
        tags=tag_names if tag_names is not None else sorted(mt.tag.name for mt in media.media_tags),
        ocr_text=media.ocr_text,
        ocr_text_override=media.ocr_text_override,
        metadata_review_dismissed=bool(media.metadata_review_dismissed),
        is_nsfw=bool(media.is_nsfw),
        is_sensitive=bool(getattr(media, "is_sensitive", False)),
        tagging_status=media.tagging_status,
        tagging_error=media.tagging_error,
        thumbnail_status=media.thumbnail_status,
        poster_status=media.poster_status,
        uploaded_at=media.uploaded_at,
        deleted_at=media.deleted_at,
        is_favorited=is_favorited,
        favorite_count=favorite_count,
    )


def enrich_media(rows: list[Media], favorited: set[uuid.UUID], counts: dict[uuid.UUID, int] | None = None, tag_names_map: dict[uuid.UUID, list[str]] | None = None) -> list[MediaRead]:
    counts = counts or {}
    return [
        build_media_read(row, row.id in favorited, counts.get(row.id, 0), tag_names_map.get(row.id, []) if tag_names_map is not None else None)
        for row in rows
    ]
