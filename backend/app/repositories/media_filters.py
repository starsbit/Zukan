"""
This file contains a bunch of filters for SQL building.
Its in the repository domain because it relates closely to SQL related logic.
"""

import re
from sqlalchemy import extract, func, or_, select
from backend.app.errors import AppError, nsfw_disabled
from backend.app.models.auth import User
from backend.app.models.media import Media, MediaTag, MediaType
from backend.app.models.relations import MediaEntity, MediaEntityType
from backend.app.models.tags import Tag
from backend.app.schemas import MediaMetadataFilter, NsfwFilter, TagFilterMode
from backend.app.utils.search import normalize_character_name_search

def captured_timestamp_expr():
    return func.coalesce(Media.captured_at, Media.created_at)

def apply_tag_filters(stmt, tags: list[str] | None, exclude_tags: list[str] | None, mode: TagFilterMode):
    if tags:
        if mode == TagFilterMode.AND:
            for tag_name in tags:
                subq = select(MediaTag.media_id).join(Tag).where(Tag.name == tag_name)
                stmt = stmt.where(Media.id.in_(subq))
        else:
            subq = select(MediaTag.media_id).join(Tag).where(Tag.name.in_(tags))
            stmt = stmt.where(Media.id.in_(subq))
    if exclude_tags:
        subq = select(MediaTag.media_id).join(Tag).where(Tag.name.in_(exclude_tags))
        stmt = stmt.where(~Media.id.in_(subq))
    return stmt

def apply_character_name_filter(stmt, character_name: str | None):
    if character_name and character_name.strip():
        normalized_query = normalize_character_name_search(character_name)
        if normalized_query:
            normalized_entity_name = func.btrim(
                func.regexp_replace(func.lower(func.coalesce(MediaEntity.name, "")), r"[^a-z0-9]+", "_", "g"),
                "_",
            )
            subq = select(MediaEntity.media_id).where(
                MediaEntity.entity_type == MediaEntityType.character,
                normalized_entity_name.contains(normalized_query),
            )
            stmt = stmt.where(Media.id.in_(subq))
    return stmt

def apply_ocr_text_filter(stmt, ocr_text: str | None):
    if ocr_text and ocr_text.strip():
        term = ocr_text.strip().lower()
        stmt = stmt.where(
            or_(
                func.lower(func.coalesce(Media.ocr_text, "")).contains(term),
                func.lower(func.coalesce(Media.ocr_text_override, "")).contains(term),
            )
        )
    return stmt

def apply_media_type_filters(stmt, media_type_filter: list[str] | None):
    if not media_type_filter:
        return stmt
    valid_values = [MediaType(value) for value in media_type_filter]
    return stmt.where(Media.media_type.in_(valid_values))

def apply_captured_at_filters(stmt, metadata: MediaMetadataFilter):
    captured_at = captured_timestamp_expr()
    if metadata.captured_year is not None:
        stmt = stmt.where(extract("year", captured_at) == metadata.captured_year)
    if metadata.captured_month is not None:
        stmt = stmt.where(extract("month", captured_at) == metadata.captured_month)
    if metadata.captured_day is not None:
        stmt = stmt.where(extract("day", captured_at) == metadata.captured_day)
    if metadata.captured_after is not None:
        stmt = stmt.where(captured_at >= metadata.captured_after)
    if metadata.captured_before is not None:
        stmt = stmt.where(captured_at <= metadata.captured_before)
    if metadata.captured_before_year is not None:
        stmt = stmt.where(extract("year", captured_at) < metadata.captured_before_year)
    return stmt

def apply_nsfw_list_filter(stmt, user: User, nsfw: NsfwFilter):
    if nsfw == NsfwFilter.DEFAULT:
        if not user.show_nsfw:
            stmt = stmt.where(Media.is_nsfw == False)
        return stmt
    if nsfw == NsfwFilter.ONLY:
        return stmt.where(Media.is_nsfw == True)
    return stmt
