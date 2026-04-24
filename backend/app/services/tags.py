from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.app.config import settings
from backend.app.errors.error import AppError
from backend.app.errors.tags import tag_not_found
from backend.app.models.auth import User
from backend.app.models.media import Media, MediaTag
from backend.app.models.relations import MediaEntity, MediaEntityType
from backend.app.models.tags import Tag
from backend.app.repositories.media import MediaRepository
from backend.app.repositories.relations import MediaEntityRepository
from backend.app.repositories.tags import TagRepository
from backend.app.schemas import CATEGORY_NAMES, MetadataListScope, TagListResponse, TagManagementResult, TagRead
from backend.app.services.library_classification import MediaLibraryEnrichmentService
from backend.app.utils.pagination import decode_cursor_typed, encode_cursor
from backend.app.utils.tagging import (
    TaggerBackend,
    TaggingResult,
    aggregate_tagging_results,
    derive_series_predictions,
    tag_names_mark_sensitive,
    tag_names_mark_nsfw,
)
from backend.app.utils.frame_sampling import cleanup_sampled_frames, sample_media_frames

logger = logging.getLogger(__name__)


class TagService:
    def __init__(
        self,
        db: AsyncSession,
        tagger: TaggerBackend | None = None,
        library_enrichment: MediaLibraryEnrichmentService | None = None,
    ) -> None:
        self._db = db
        self._tagger = tagger
        self._library_enrichment = library_enrichment or MediaLibraryEnrichmentService(db)

    async def get_tag_by_id(self, tag_id: int) -> Tag:
        tag = await TagRepository(self._db).get_by_id(tag_id)
        if tag is None:
            raise AppError(status_code=404, code=tag_not_found, detail="Tag not found")
        return tag

    async def get_manageable_tag_by_id(self, user: User, tag_id: int) -> Tag:
        tag = await self.get_tag_by_id(tag_id)
        if not user.is_admin and tag.owner_user_id != user.id:
            raise AppError(status_code=404, code=tag_not_found, detail="Tag not found")
        return tag

    async def list_tags(
        self,
        user: User,
        *,
        after: str | None = None,
        page_size: int = 100,
        category: int | None,
        query: str | None = None,
        sort_by: str = "media_count",
        sort_order: str = "desc",
        scope: MetadataListScope = MetadataListScope.ACCESSIBLE,
    ) -> TagListResponse:
        tags_repo = TagRepository(self._db)
        total = await tags_repo.count_accessible(user, category=category, query=query, scope=scope)
        tag_list = await tags_repo.list_accessible(user, category=category, query=query, scope=scope)

        reverse = sort_order == "desc"
        if sort_by == "name":
            tag_list = sorted(tag_list, key=lambda row: (row.name, row.id), reverse=reverse)
        else:
            tag_list = sorted(tag_list, key=lambda row: (row.media_count, row.id), reverse=reverse)

        if after:
            value_type = "str" if sort_by == "name" else "int"
            decoded = decode_cursor_typed(after, value_type, id_type="int")
            if decoded is not None:
                cursor_val, cursor_id = decoded
                tag_list = [
                    row for row in tag_list
                    if _tag_row_after_cursor(
                        row,
                        sort_by=sort_by,
                        sort_order=sort_order,
                        cursor_val=cursor_val,
                        cursor_id=cursor_id,
                    )
                ]

        has_more = len(tag_list) > page_size
        tag_list = tag_list[:page_size]

        next_cursor = None
        if has_more and tag_list:
            last = tag_list[-1]
            sort_val = last.name if sort_by == "name" else last.media_count
            next_cursor = encode_cursor(sort_val, last.id)

        return TagListResponse(
            total=total,
            next_cursor=next_cursor,
            has_more=has_more,
            page_size=page_size,
            items=[_to_tag_read(row) for row in tag_list],
        )

    async def remove_tag_from_media_by_id(self, user, *, tag_id: int) -> TagManagementResult:
        tag = await self.get_manageable_tag_by_id(user, tag_id)
        return await self.remove_tag_from_media(user, source_tag=tag)

    async def trash_media_by_tag_id(self, user, *, tag_id: int) -> TagManagementResult:
        tag = await self.get_manageable_tag_by_id(user, tag_id)
        return await self.trash_media_by_tag(user, tag=tag)

    async def remove_tag_from_media(self, user, *, source_tag: Tag) -> TagManagementResult:
        tags_repo = TagRepository(self._db)
        media_rows = (
            await self._db.execute(
                _manageable_media_stmt(user)
                .where(Media.id.in_(select(MediaTag.media_id).where(MediaTag.tag_id == source_tag.id)))
                .options(selectinload(Media.media_tags).selectinload(MediaTag.tag))
            )
        ).scalars().all()

        updated = 0
        for media in media_rows:
            next_payloads = [
                (mt.tag.name, mt.tag.category, mt.confidence)
                for mt in media.media_tags
                if mt.tag_id != source_tag.id
            ]
            if len(next_payloads) == len(media.media_tags):
                continue
            await tags_repo.set_media_tag_links(media, next_payloads)
            remaining_names = [name for name, _, _ in next_payloads]
            media.is_nsfw = tag_names_mark_nsfw(remaining_names)
            media.is_sensitive = tag_names_mark_sensitive(remaining_names)
            updated += 1

        await self._db.flush()
        remaining = await tags_repo.get_by_id(source_tag.id)
        deleted_tag = remaining is None

        await self._db.commit()
        logger.info(
            "Removed tag from media user_id=%s tag_id=%s tag_name=%s matched_media=%s updated_media=%s deleted_tag=%s",
            user.id,
            source_tag.id,
            source_tag.name,
            len(media_rows),
            updated,
            deleted_tag,
        )
        return TagManagementResult(
            matched_media=len(media_rows),
            updated_media=updated,
            deleted_tag=deleted_tag,
            deleted_source=deleted_tag,
        )

    async def merge_tag_by_id(self, user, *, tag_id: int, target_tag_id: int) -> TagManagementResult:
        source_tag = await self.get_manageable_tag_by_id(user, tag_id)
        target_tag = await self.get_manageable_tag_by_id(user, target_tag_id)
        return await self.merge_tag(user, source_tag=source_tag, target_tag=target_tag)

    async def merge_tag(self, user, *, source_tag: Tag, target_tag: Tag) -> TagManagementResult:
        if source_tag.id == target_tag.id:
            return TagManagementResult(matched_media=0, updated_media=0)
        if source_tag.owner_user_id != target_tag.owner_user_id:
            raise AppError(status_code=404, code=tag_not_found, detail="Tag not found")

        tags_repo = TagRepository(self._db)
        media_rows = (
            await self._db.execute(
                _manageable_media_stmt(user)
                .where(Media.id.in_(select(MediaTag.media_id).where(MediaTag.tag_id == source_tag.id)))
                .options(selectinload(Media.media_tags).selectinload(MediaTag.tag))
            )
        ).scalars().all()

        updated = 0
        for media in media_rows:
            next_payloads = _merge_media_tag_payloads(media, source_tag=source_tag, target_tag=target_tag)
            if next_payloads is None:
                continue
            await tags_repo.set_media_tag_links(media, next_payloads)
            remaining_names = [name for name, _, _ in next_payloads]
            media.is_nsfw = tag_names_mark_nsfw(remaining_names)
            media.is_sensitive = tag_names_mark_sensitive(remaining_names)
            updated += 1

        await self._db.flush()
        remaining = await tags_repo.get_by_id(source_tag.id)
        deleted_source = remaining is None
        await self._db.commit()
        logger.info(
            "Merged tag user_id=%s source_tag_id=%s target_tag_id=%s matched_media=%s updated_media=%s deleted_source=%s",
            user.id,
            source_tag.id,
            target_tag.id,
            len(media_rows),
            updated,
            deleted_source,
        )
        return TagManagementResult(
            matched_media=len(media_rows),
            updated_media=updated,
            deleted_tag=deleted_source,
            deleted_source=deleted_source,
        )

    async def trash_media_by_tag(self, user, *, tag: Tag) -> TagManagementResult:
        matches = (
            await self._db.execute(
                _manageable_media_stmt(user)
                .where(Media.id.in_(select(MediaTag.media_id).where(MediaTag.tag_id == tag.id)))
            )
        ).scalars().all()
        trashed = 0
        already_trashed = 0
        now = datetime.now(timezone.utc)
        for media in matches:
            if media.deleted_at is None:
                media.deleted_at = now
                trashed += 1
            else:
                already_trashed += 1
        await self._db.commit()
        logger.info(
            "Trashed media by tag user_id=%s tag_id=%s tag_name=%s trashed=%s already_trashed=%s",
            user.id,
            tag.id,
            tag.name,
            trashed,
            already_trashed,
        )
        return TagManagementResult(matched_media=len(matches), trashed_media=trashed, already_trashed=already_trashed)

    async def tag_media(self, media_id: uuid.UUID) -> None:
        assert self._tagger is not None, "TagService requires a tagger backend to run tag_media"
        media = await MediaRepository(self._db).get_by_id(media_id)
        if media is None:
            logger.warning("Tagging skipped because media was not found media_id=%s", media_id)
            return
        media.tagging_status = "processing"
        media.tagging_error = None
        await self._db.commit()
        logger.info("Tagging started media_id=%s media_type=%s", media.id, media.media_type.value)

        frames = sample_media_frames(media.filepath, media.media_type)
        try:
            results: list[TaggingResult] = []
            for frame_path in frames or [Path(media.filepath)]:
                results.append(await self._predict_with_retries(str(frame_path)))
            aggregated = aggregate_tagging_results(results)
            await self._store_tagging_result(media, aggregated)
            uploader = await self._db.get(User, media.uploader_id) if media.uploader_id is not None else None
            if uploader is not None and uploader.library_classification_enabled:
                await self._library_enrichment.enrich_media(media.id, user_id=media.uploader_id)
        finally:
            cleanup_sampled_frames([frame for frame in frames if frame != Path(media.filepath)])

    async def _predict_with_retries(self, image_path: str) -> TaggingResult:
        attempts = max(1, settings.tagging_retry_attempts)
        last_error: Exception | None = None
        for attempt in range(1, attempts + 1):
            try:
                return await self._tagger.predict(image_path)
            except Exception as exc:
                last_error = exc
                logger.warning(
                    "Tag prediction attempt failed image_path=%s attempt=%s max_attempts=%s error=%s",
                    image_path,
                    attempt,
                    attempts,
                    exc,
                )
                if attempt >= attempts:
                    break
                await asyncio.sleep(settings.tagging_retry_backoff_seconds * attempt)
        assert last_error is not None
        raise last_error

    async def _store_tagging_result(self, media: Media, tagging_result: TaggingResult) -> None:
        uploader = None
        if media.uploader_id is not None:
            uploader = await self._db.get(User, media.uploader_id)
        tag_threshold = uploader.tag_confidence_threshold if uploader is not None else settings.tagger_threshold_general

        filtered_predictions = [
            p for p in tagging_result.predictions
            if p.category == 9 or p.confidence >= tag_threshold
        ]

        tag_payloads = [(p.name, p.category, p.confidence) for p in filtered_predictions]
        await TagRepository(self._db).set_media_tag_links(media, tag_payloads)
        filtered_tag_names = [p.name for p in filtered_predictions]
        media.is_nsfw = tagging_result.is_nsfw or tag_names_mark_nsfw(filtered_tag_names)
        media.is_sensitive = tagging_result.is_sensitive or tag_names_mark_sensitive(filtered_tag_names)
        media.tagging_status = "done"
        media.tagging_error = None

        entity_predictions = [
            (MediaEntityType.character, prediction)
            for prediction in filtered_predictions
            if prediction.category == 4
        ] + [
            (MediaEntityType.series, prediction)
            for prediction in derive_series_predictions(filtered_predictions)
        ]
        seen_entities: set[tuple[MediaEntityType, str]] = set()
        for entity_type, prediction in entity_predictions:
            key = (entity_type, prediction.name.casefold())
            if key in seen_entities:
                continue
            seen_entities.add(key)
        entity_repo = MediaEntityRepository(self._db)
        character_names = [prediction.name for entity_type, prediction in entity_predictions if entity_type == MediaEntityType.character]
        series_names = [prediction.name for entity_type, prediction in entity_predictions if entity_type == MediaEntityType.series]
        await entity_repo.add_media_entities(
            media,
            entity_type=MediaEntityType.character,
            names=character_names,
            source="tagger",
            confidence=None,
            replace_existing_type=True,
        )
        await entity_repo.add_media_entities(
            media,
            entity_type=MediaEntityType.series,
            names=series_names,
            source="tagger",
            confidence=None,
            replace_existing_type=True,
        )

        if character_names or series_names:
            by_name = {prediction.name: prediction.confidence for _, prediction in entity_predictions}
            for entity in await entity_repo.get_by_media(media.id):
                if entity.entity_type not in {MediaEntityType.character, MediaEntityType.series}:
                    continue
                entity.confidence = by_name.get(entity.name, entity.confidence)

        await self._db.commit()
        logger.info(
            "Tagging finished media_id=%s filtered_tags=%s entities=%s is_nsfw=%s is_sensitive=%s",
            media.id,
            len(filtered_predictions),
            len(seen_entities),
            media.is_nsfw,
            media.is_sensitive,
        )


def _manageable_media_stmt(user):
    stmt = select(Media)
    if not user.is_admin:
        stmt = stmt.where(
            (Media.uploader_id == user.id) | (Media.owner_id == user.id)
        )
    return stmt


def _merge_media_tag_payloads(media: Media, *, source_tag: Tag, target_tag: Tag) -> list[tuple[str, int, float]] | None:
    payloads: list[tuple[str, int, float]] = []
    changed = False
    merged_confidence = 0.0
    target_present = False

    for media_tag in media.media_tags:
        if media_tag.tag_id == source_tag.id:
            changed = True
            merged_confidence = max(merged_confidence, media_tag.confidence)
            continue
        if media_tag.tag_id == target_tag.id:
            target_present = True
            merged_confidence = max(merged_confidence, media_tag.confidence)
            target_category = target_tag.category if target_tag.category != 0 else source_tag.category
            payloads.append((target_tag.name, target_category, media_tag.confidence))
            continue
        payloads.append((media_tag.tag.name, media_tag.tag.category, media_tag.confidence))

    if not changed:
        return None

    if target_present:
        payloads = [
            (
                name,
                category,
                max(confidence, merged_confidence) if name == target_tag.name else confidence,
            )
            for name, category, confidence in payloads
        ]
        return payloads

    target_category = target_tag.category if target_tag.category != 0 else source_tag.category
    payloads.append((target_tag.name, target_category, merged_confidence))
    return payloads


def _tag_row_after_cursor(row, *, sort_by: str, sort_order: str, cursor_val, cursor_id: int) -> bool:
    row_val = row.name if sort_by == "name" else row.media_count
    if sort_order == "asc":
        return row_val > cursor_val or (row_val == cursor_val and row.id > cursor_id)
    return row_val < cursor_val or (row_val == cursor_val and row.id < cursor_id)


def _to_tag_read(tag) -> TagRead:
    category_key = CATEGORY_NAMES.get(tag.category, "unknown")
    return TagRead(
        id=tag.id,
        name=tag.name,
        category=tag.category,
        category_name=category_key,
        category_key=category_key,
        media_count=tag.media_count,
    )
