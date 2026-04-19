"""
This file contains a bunch of filters for SQL building.
Its in the repository domain because it relates closely to SQL related logic.
"""

import re

from sqlalchemy import extract, exists, func, or_, select
from backend.app.models.auth import User
from backend.app.models.media import Media, MediaTag, MediaType, MediaVisibility
from backend.app.models.relations import MediaEntity, MediaEntityType
from backend.app.models.tags import Tag
from backend.app.schemas import MediaMetadataFilter, NsfwFilter, SensitiveFilter, TagFilterMode
from backend.app.utils.search import normalize_character_name_search



def captured_timestamp_expr():
    return func.coalesce(Media.captured_at, Media.uploaded_at)


def uploaded_timestamp_expr():
    return Media.uploaded_at

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
            normalized_entity_name = _normalized_entity_name_expr()
            subq = select(MediaEntity.media_id).where(
                MediaEntity.entity_type == MediaEntityType.character,
                normalized_entity_name.contains(normalized_query),
            )
            stmt = stmt.where(Media.id.in_(subq))
    return stmt


def apply_series_name_filter(stmt, series_name: str | None):
    if series_name and series_name.strip():
        normalized_query = normalize_character_name_search(series_name)
        if normalized_query:
            normalized_entity_name = _normalized_entity_name_expr()
            subq = select(MediaEntity.media_id).where(
                MediaEntity.entity_type == MediaEntityType.series,
                normalized_entity_name.contains(normalized_query),
            )
            stmt = stmt.where(Media.id.in_(subq))
    return stmt


def apply_owner_username_filter(stmt, owner_username: str | None):
    normalized = _normalize_exact_username(owner_username)
    if normalized is None:
        return stmt

    owner_match = exists(
        select(1).where(
            User.id == Media.owner_id,
            func.lower(User.username) == normalized,
        )
    )
    return stmt.where(owner_match)


def apply_uploader_username_filter(stmt, uploader_username: str | None):
    normalized = _normalize_exact_username(uploader_username)
    if normalized is None:
        return stmt

    uploader_match = exists(
        select(1).where(
            User.id == Media.uploader_id,
            func.lower(User.username) == normalized,
        )
    )
    return stmt.where(uploader_match)


def apply_ocr_text_filter(stmt, ocr_text: str | None):
    if ocr_text and ocr_text.strip():
        term = ocr_text.strip().lower()
        ocr_text_expr = func.lower(func.coalesce(Media.ocr_text, ""))
        ocr_override_expr = func.lower(func.coalesce(Media.ocr_text_override, ""))
        exact_match = or_(
            ocr_text_expr.contains(term),
            ocr_override_expr.contains(term),
        )

        fuzzy_pattern = _build_fuzzy_ocr_like_pattern(term)
        if not fuzzy_pattern:
            return stmt.where(exact_match)

        normalized_ocr_text_expr = func.regexp_replace(ocr_text_expr, r"[^a-z0-9]+", "", "g")
        normalized_ocr_override_expr = func.regexp_replace(ocr_override_expr, r"[^a-z0-9]+", "", "g")
        fuzzy_match = or_(
            normalized_ocr_text_expr.like(fuzzy_pattern),
            normalized_ocr_override_expr.like(fuzzy_pattern),
        )
        stmt = stmt.where(or_(exact_match, fuzzy_match))
    return stmt

def apply_media_type_filters(stmt, media_type_filter: list[str] | None):
    if not media_type_filter:
        return stmt
    valid_values = [MediaType(value) for value in media_type_filter]
    return stmt.where(Media.media_type.in_(valid_values))

def apply_visibility_filter(stmt, visibility: MediaVisibility | None):
    if visibility is None:
        return stmt
    return stmt.where(Media.visibility == visibility)

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


def apply_uploaded_at_filters(stmt, metadata: MediaMetadataFilter):
    uploaded_at = uploaded_timestamp_expr()
    if metadata.uploaded_year is not None:
        stmt = stmt.where(extract("year", uploaded_at) == metadata.uploaded_year)
    if metadata.uploaded_month is not None:
        stmt = stmt.where(extract("month", uploaded_at) == metadata.uploaded_month)
    if metadata.uploaded_day is not None:
        stmt = stmt.where(extract("day", uploaded_at) == metadata.uploaded_day)
    if metadata.uploaded_after is not None:
        stmt = stmt.where(uploaded_at >= metadata.uploaded_after)
    if metadata.uploaded_before is not None:
        stmt = stmt.where(uploaded_at <= metadata.uploaded_before)
    if metadata.uploaded_before_year is not None:
        stmt = stmt.where(extract("year", uploaded_at) < metadata.uploaded_before_year)
    return stmt

def apply_nsfw_list_filter(stmt, user: User, nsfw: NsfwFilter):
    if nsfw == NsfwFilter.DEFAULT:
        if not user.show_nsfw:
            stmt = stmt.where(Media.is_nsfw == False)
        return stmt
    if nsfw == NsfwFilter.ONLY:
        return stmt.where(Media.is_nsfw == True)
    return stmt


def apply_sensitive_list_filter(stmt, user: User, sensitive: SensitiveFilter):
    if sensitive == SensitiveFilter.DEFAULT:
        if not user.show_sensitive:
            stmt = stmt.where(Media.is_sensitive == False)
        return stmt
    if sensitive == SensitiveFilter.ONLY:
        return stmt.where(Media.is_sensitive == True)
    return stmt

def _build_fuzzy_ocr_like_pattern(term: str) -> str | None:
    normalized = re.sub(r"[^a-z0-9]+", "", term.lower())
    if len(normalized) < 4:
        return None
    # Insert SQL wildcards between characters to tolerate OCR noise inside words
    return "%" + "%".join(normalized) + "%"


def _normalized_entity_name_expr():
    return func.btrim(
        func.regexp_replace(func.lower(func.coalesce(MediaEntity.name, "")), r"[^a-z0-9]+", "_", "g"),
        "_",
    )


def _normalize_exact_username(username: str | None) -> str | None:
    if username is None:
        return None

    normalized = username.strip().lower()
    return normalized or None
