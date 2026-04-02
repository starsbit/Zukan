from __future__ import annotations

import asyncio
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
from backend.app.schemas import CATEGORY_NAMES, TagListResponse, TagManagementResult, TagRead
from backend.app.utils.pagination import apply_cursor_where_expr, decode_cursor_typed, encode_cursor
from backend.app.utils.tagging import (
    TaggerBackend,
    TaggingResult,
    aggregate_tagging_results,
    tag_names_mark_nsfw,
)
from backend.app.utils.frame_sampling import cleanup_sampled_frames, sample_media_frames


class TagService:
    def __init__(self, db: AsyncSession, tagger: TaggerBackend | None = None) -> None:
        self._db = db
        self._tagger = tagger

    async def get_tag_by_id(self, tag_id: int) -> Tag:
        tag = await TagRepository(self._db).get_by_id(tag_id)
        if tag is None:
            raise AppError(status_code=404, code=tag_not_found, detail="Tag not found")
        return tag

    async def list_tags(
        self,
        *,
        after: str | None = None,
        page_size: int = 100,
        category: int | None,
        query: str | None = None,
        sort_by: str = "media_count",
        sort_order: str = "desc",
    ) -> TagListResponse:
        sort_col = Tag.name if sort_by == "name" else Tag.media_count
        base_stmt = select(Tag)
        if category is not None:
            base_stmt = base_stmt.where(Tag.category == category)
        if query:
            base_stmt = base_stmt.where(Tag.name.ilike(f"{query}%"))

        if after:
            value_type = "str" if sort_by == "name" else "int"
            decoded = decode_cursor_typed(after, value_type, id_type="int")
            if decoded is not None:
                cursor_val, cursor_id = decoded
                base_stmt = apply_cursor_where_expr(
                    base_stmt,
                    sort_expr=sort_col,
                    id_expr=Tag.id,
                    sort_order=sort_order,
                    cursor_val=cursor_val,
                    cursor_id=cursor_id,
                )

        if sort_order == "asc":
            order_exprs = [sort_col.asc(), Tag.id.asc()]
        else:
            order_exprs = [sort_col.desc(), Tag.id.desc()]

        tags_repo = TagRepository(self._db)
        total = await tags_repo.count(base_stmt)
        tag_list = (await self._db.execute(base_stmt.order_by(*order_exprs).limit(page_size + 1))).scalars().all()
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
            items=[_to_tag_read(tag) for tag in tag_list],
        )

    async def remove_tag_from_media_by_id(self, user, *, tag_id: int) -> TagManagementResult:
        tag = await self.get_tag_by_id(tag_id)
        return await self.remove_tag_from_media(user, tag_name=tag.name)

    async def trash_media_by_tag_id(self, user, *, tag_id: int) -> TagManagementResult:
        tag = await self.get_tag_by_id(tag_id)
        return await self.trash_media_by_tag(user, tag_name=tag.name)

    async def remove_tag_from_media(self, user, *, tag_name: str) -> TagManagementResult:
        tags_repo = TagRepository(self._db)
        tag = await tags_repo.get_by_name(tag_name)
        media_rows = (
            await self._db.execute(
                _accessible_media_stmt(user)
                .where(Media.id.in_(select(MediaTag.media_id).join(Tag).where(Tag.name == tag_name)))
                .options(selectinload(Media.media_tags).selectinload(MediaTag.tag))
            )
        ).scalars().all()

        updated = 0
        for media in media_rows:
            next_payloads = [
                (mt.tag.name, mt.tag.category, mt.confidence)
                for mt in media.media_tags
                if mt.tag.name != tag_name
            ]
            if len(next_payloads) == len(media.media_tags):
                continue
            await tags_repo.set_media_tag_links(media, next_payloads)
            media.is_nsfw = tag_names_mark_nsfw([name for name, _, _ in next_payloads])
            updated += 1

        await self._db.flush()
        deleted_tag = False
        if tag is not None:
            remaining = await tags_repo.get_by_id(tag.id)
            deleted_tag = remaining is None

        await self._db.commit()
        return TagManagementResult(matched_media=len(media_rows), updated_media=updated, deleted_tag=deleted_tag)

    async def trash_media_by_tag(self, user, *, tag_name: str) -> TagManagementResult:
        matches = (
            await self._db.execute(
                _accessible_media_stmt(user)
                .where(Media.id.in_(select(MediaTag.media_id).join(Tag).where(Tag.name == tag_name)))
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
        return TagManagementResult(matched_media=len(matches), trashed_media=trashed, already_trashed=already_trashed)

    async def tag_media(self, media_id: uuid.UUID) -> None:
        assert self._tagger is not None, "TagService requires a tagger backend to run tag_media"
        media = await MediaRepository(self._db).get_by_id(media_id)
        if media is None:
            return
        media.tagging_status = "processing"
        media.tagging_error = None
        await self._db.commit()

        frames = sample_media_frames(media.filepath, media.media_type)
        try:
            results: list[TaggingResult] = []
            for frame_path in frames or [Path(media.filepath)]:
                results.append(await self._predict_with_retries(str(frame_path)))
            aggregated = aggregate_tagging_results(results)
            await self._store_tagging_result(media, aggregated)
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
        media.is_nsfw = tagging_result.is_nsfw or tag_names_mark_nsfw([p.name for p in filtered_predictions])
        media.tagging_status = "done"
        media.tagging_error = None

        entity_repo = MediaEntityRepository(self._db)
        for entity_type in (MediaEntityType.character, MediaEntityType.series):
            for entity in await entity_repo.get_tagger_entities(media.id, entity_type):
                await self._db.delete(entity)

        entity_predictions = [
            (MediaEntityType.character, prediction)
            for prediction in filtered_predictions
            if prediction.category == 4
        ] + [
            (MediaEntityType.series, prediction)
            for prediction in filtered_predictions
            if prediction.category == 3
        ]
        seen_entities: set[tuple[MediaEntityType, str]] = set()
        for entity_type, prediction in entity_predictions:
            key = (entity_type, prediction.name.casefold())
            if key in seen_entities:
                continue
            seen_entities.add(key)
            self._db.add(MediaEntity(
                media_id=media.id,
                entity_type=entity_type,
                name=prediction.name,
                role="primary",
                source="tagger",
                confidence=prediction.confidence,
            ))

        await self._db.commit()


def _accessible_media_stmt(user):
    stmt = select(Media)
    if not user.is_admin:
        stmt = stmt.where(Media.uploader_id == user.id)
    return stmt


def _to_tag_read(tag: Tag) -> TagRead:
    category_key = CATEGORY_NAMES.get(tag.category, "unknown")
    return TagRead(
        id=tag.id,
        name=tag.name,
        category=tag.category,
        category_name=category_key,
        category_key=category_key,
        media_count=tag.media_count,
    )
