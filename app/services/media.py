import asyncio
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException, UploadFile
from sqlalchemy import and_, extract, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.models import Media, MediaTag, MediaType, Tag, User, UserFavorite
from app.schemas import (
    BatchUploadResponse,
    BulkResult,
    CATEGORY_NAMES,
    MediaBatchDelete,
    MediaBatchUpdate,
    MediaDetail,
    MediaListResponse,
    MediaListState,
    MediaMetadata,
    MediaMetadataFilter,
    MediaRead,
    MediaUpdate,
    NsfwFilter,
    TagFilterMode,
    TagWithConfidence,
    UploadResult,
)
from app.services.storage import (
    cleanup_sampled_frames,
    delete_media_files,
    extract_media_metadata,
    generate_poster_and_thumbnail,
    sample_media_frames,
    save_upload,
)
from app.services.tagger import NSFW_RATING_TAGS, TagPrediction, TaggingResult, derive_character_name, tagger

_tag_queue: asyncio.Queue | None = None


def set_tag_queue(queue: asyncio.Queue) -> None:
    global _tag_queue
    _tag_queue = queue


def get_tag_queue() -> asyncio.Queue | None:
    return _tag_queue


def enrich_media(rows: list[Media], favorited: set[uuid.UUID]) -> list[MediaRead]:
    return [_build_media_read(row, row.id in favorited) for row in rows]


async def favorited_ids(db: AsyncSession, user_id: uuid.UUID, media_ids: list[uuid.UUID]) -> set[uuid.UUID]:
    if not media_ids:
        return set()
    result = await db.execute(
        select(UserFavorite.media_id).where(
            UserFavorite.user_id == user_id,
            UserFavorite.media_id.in_(media_ids),
        )
    )
    return set(result.scalars().all())


def _parse_tag_values(value: str | None) -> list[str]:
    if not value:
        return []
    return [tag.strip() for tag in value.split(",") if tag.strip()]


def _apply_tag_filters(stmt, tags: str | None, exclude_tags: str | None, mode: TagFilterMode):
    include_tags = _parse_tag_values(tags)
    if include_tags:
        stmt = stmt.where(Media.tags.contains(include_tags) if mode == TagFilterMode.AND else Media.tags.overlap(include_tags))

    excluded_tags = _parse_tag_values(exclude_tags)
    if excluded_tags:
        stmt = stmt.where(~Media.tags.contains(excluded_tags))
    return stmt


def _apply_character_name_filter(stmt, character_name: str | None):
    if character_name and character_name.strip():
        stmt = stmt.where(Media.character_name.ilike(f"%{character_name.strip()}%"))
    return stmt


def _normalize_manual_tags(tags: list[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for tag in tags:
        cleaned = tag.strip()
        if not cleaned or cleaned in seen:
            continue
        normalized.append(cleaned)
        seen.add(cleaned)
    return normalized


def _captured_timestamp_expr():
    return func.coalesce(Media.captured_at, Media.created_at)


def _media_captured_at(media: Media) -> datetime:
    return media.captured_at or media.created_at


def _build_media_metadata(media: Media) -> MediaMetadata:
    return MediaMetadata(
        file_size=media.file_size,
        width=media.width,
        height=media.height,
        duration_seconds=media.duration_seconds,
        frame_count=media.frame_count,
        mime_type=media.mime_type,
        captured_at=_media_captured_at(media),
    )


def _build_media_read(media: Media, is_favorited: bool) -> MediaRead:
    return MediaRead(
        id=media.id,
        uploader_id=media.uploader_id,
        filename=media.filename,
        original_filename=media.original_filename,
        media_type=media.media_type,
        metadata=_build_media_metadata(media),
        tags=media.tags,
        character_name=media.character_name,
        is_nsfw=media.is_nsfw,
        tagging_status=media.tagging_status,
        thumbnail_status=media.thumbnail_status,
        poster_status=media.poster_status,
        created_at=media.created_at,
        deleted_at=media.deleted_at,
        is_favorited=is_favorited,
    )


def _apply_nsfw_list_filter(stmt, user: User, nsfw: NsfwFilter):
    if nsfw == NsfwFilter.DEFAULT:
        if not user.show_nsfw:
            stmt = stmt.where(Media.is_nsfw == False)
        return stmt
    if nsfw == NsfwFilter.ONLY:
        if not user.show_nsfw and not user.is_admin:
            raise HTTPException(status_code=403, detail="Enable NSFW in your profile first")
        return stmt.where(Media.is_nsfw == True)
    return stmt


def _apply_captured_at_filters(stmt, metadata: MediaMetadataFilter):
    captured_at = _captured_timestamp_expr()
    if metadata.captured_year is not None:
        stmt = stmt.where(extract("year", captured_at) == metadata.captured_year)
    if metadata.captured_month is not None:
        stmt = stmt.where(extract("month", captured_at) == metadata.captured_month)
    if metadata.captured_day is not None:
        stmt = stmt.where(extract("day", captured_at) == metadata.captured_day)
    if metadata.captured_before_year is not None:
        stmt = stmt.where(extract("year", captured_at) < metadata.captured_before_year)
    return stmt


async def list_media(
    db: AsyncSession,
    user: User,
    state: MediaListState,
    tags: str | None,
    character_name: str | None,
    exclude_tags: str | None,
    mode: TagFilterMode,
    nsfw: NsfwFilter,
    status_filter: str | None,
    metadata: MediaMetadataFilter,
    favorited: bool | None,
    page: int,
    page_size: int,
) -> MediaListResponse:
    stmt = select(Media)
    if state == MediaListState.TRASHED:
        stmt = stmt.where(Media.deleted_at.is_not(None))
        if not user.is_admin:
            stmt = stmt.where(Media.uploader_id == user.id)
    else:
        stmt = stmt.where(Media.deleted_at.is_(None))
        stmt = _apply_nsfw_list_filter(stmt, user, nsfw)
    if status_filter and status_filter != "any":
        stmt = stmt.where(Media.tagging_status == status_filter)
    if favorited is True:
        stmt = stmt.join(UserFavorite, and_(UserFavorite.media_id == Media.id, UserFavorite.user_id == user.id))

    stmt = _apply_tag_filters(stmt, tags, exclude_tags, mode)
    stmt = _apply_character_name_filter(stmt, character_name)
    stmt = _apply_captured_at_filters(stmt, metadata)

    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (
        await db.execute(stmt.order_by(_captured_timestamp_expr().desc()).offset((page - 1) * page_size).limit(page_size))
    ).scalars().all()
    favs = await favorited_ids(db, user.id, [row.id for row in rows])
    return MediaListResponse(total=total, page=page, page_size=page_size, items=enrich_media(rows, favs))


async def list_trash(db: AsyncSession, user: User, page: int, page_size: int) -> MediaListResponse:
    return await list_media(
        db,
        user,
        MediaListState.TRASHED,
        tags=None,
        character_name=None,
        exclude_tags=None,
        mode=TagFilterMode.AND,
        nsfw=NsfwFilter.DEFAULT,
        status_filter=None,
        metadata=MediaMetadataFilter(),
        favorited=None,
        page=page,
        page_size=page_size,
    )


async def empty_trash(db: AsyncSession, user: User) -> None:
    stmt = select(Media).where(Media.deleted_at.is_not(None))
    if not user.is_admin:
        stmt = stmt.where(Media.uploader_id == user.id)
    for media in (await db.execute(stmt)).scalars().all():
        await purge_media_record(media, db)
    await db.commit()


async def list_favorites(
    db: AsyncSession,
    user: User,
    tags: str | None,
    exclude_tags: str | None,
    mode: TagFilterMode,
    page: int,
    page_size: int,
) -> MediaListResponse:
    stmt = (
        select(Media)
        .join(UserFavorite, and_(UserFavorite.media_id == Media.id, UserFavorite.user_id == user.id))
        .where(Media.deleted_at.is_(None))
    )
    if not user.show_nsfw:
        stmt = stmt.where(Media.is_nsfw == False)
    stmt = _apply_tag_filters(stmt, tags, exclude_tags, mode)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (
        await db.execute(stmt.order_by(_captured_timestamp_expr().desc()).offset((page - 1) * page_size).limit(page_size))
    ).scalars().all()
    return MediaListResponse(total=total, page=page, page_size=page_size, items=[_build_media_read(row, True) for row in rows])


async def build_upload_response(db: AsyncSession, user: User, files: list[UploadFile]) -> BatchUploadResponse:
    if len(files) > settings.max_batch_size:
        raise HTTPException(status_code=400, detail=f"Max {settings.max_batch_size} files per request")

    queue = get_tag_queue()
    results: list[UploadResult] = []
    accepted = duplicates = errors = 0

    for upload in files:
        original_name = upload.filename or "unknown"
        saved = await save_upload(upload)
        if saved is None:
            results.append(
                UploadResult(id=None, original_filename=original_name, status="error", message="Unsupported type or file too large")
            )
            errors += 1
            continue

        metadata = extract_media_metadata(str(saved.path), saved.media_type)
        captured_at = metadata.captured_at or datetime.now(timezone.utc)
        existing = (await db.execute(select(Media).where(Media.sha256 == saved.sha256))).scalar_one_or_none()
        if existing is not None:
            delete_media_files(str(saved.path))
            if existing.deleted_at is None:
                results.append(
                    UploadResult(id=None, original_filename=original_name, status="duplicate", message="Media already exists")
                )
                duplicates += 1
                continue

            existing.deleted_at = None
            existing.original_filename = original_name
            existing.tagging_status = "pending"
            existing.captured_at = existing.captured_at or captured_at
            await db.flush()
            if queue:
                await queue.put(existing.id)
            results.append(UploadResult(id=existing.id, original_filename=original_name, status="accepted"))
            accepted += 1
            continue

        poster, thumb = generate_poster_and_thumbnail(str(saved.path), saved.media_type)
        media = Media(
            uploader_id=user.id,
            filename=saved.path.name,
            original_filename=original_name,
            filepath=str(saved.path),
            file_size=saved.file_size,
            sha256=saved.sha256,
            mime_type=saved.mime_type,
            media_type=saved.media_type,
            width=metadata.width,
            height=metadata.height,
            duration_seconds=metadata.duration_seconds,
            frame_count=metadata.frame_count,
            tags=[],
            character_name=None,
            tagging_status="pending",
            thumbnail_path=str(thumb) if thumb else None,
            thumbnail_status="done" if thumb else "failed",
            poster_path=str(poster) if poster else None,
            poster_status="done" if poster or saved.media_type == MediaType.IMAGE else "failed",
            captured_at=captured_at,
        )
        db.add(media)
        await db.flush()
        if queue:
            await queue.put(media.id)
        results.append(UploadResult(id=media.id, original_filename=original_name, status="accepted"))
        accepted += 1

    await db.commit()
    return BatchUploadResponse(accepted=accepted, duplicates=duplicates, errors=errors, results=results)


async def get_downloadable_media(db: AsyncSession, user: User, media_ids: list[uuid.UUID]) -> list[Media]:
    rows = (
        await db.execute(
            select(Media).where(
                Media.id.in_(media_ids),
                Media.deleted_at.is_(None),
                Media.uploader_id == user.id if not user.is_admin else True,
            )
        )
    ).scalars().all()
    if not user.is_admin:
        rows = [row for row in rows if row.uploader_id == user.id]
    if not rows:
        raise HTTPException(status_code=404, detail="No accessible media found")
    return rows


async def get_visible_media(db: AsyncSession, media_id: uuid.UUID, user: User) -> Media:
    media = (await db.execute(select(Media).where(Media.id == media_id, Media.deleted_at.is_(None)))).scalar_one_or_none()
    if media is None:
        raise HTTPException(status_code=404, detail="Not found")
    if media.is_nsfw and not user.show_nsfw and not user.is_admin:
        raise HTTPException(status_code=403, detail="NSFW content hidden")
    return media


async def get_media_detail(db: AsyncSession, media_id: uuid.UUID, user: User) -> MediaDetail:
    media = await _get_media_with_tags(db, media_id, deleted=False)
    if media is None:
        raise HTTPException(status_code=404, detail="Not found")
    if media.is_nsfw and not user.show_nsfw and not user.is_admin:
        raise HTTPException(status_code=403, detail="NSFW content hidden")
    return await build_media_detail(db, media, user.id)


async def update_media_metadata(db: AsyncSession, media_id: uuid.UUID, user: User, payload: MediaUpdate) -> MediaDetail:
    metadata_fields = payload.metadata.model_fields_set if payload.metadata is not None else set()
    needs_owner_access = any(field in payload.model_fields_set for field in {"tags", "character_name", "metadata", "deleted"})
    if needs_owner_access:
        media = await get_owned_or_admin_media(db, media_id, user, trashed=None)
    else:
        media = await get_active_media(db, media_id)

    if "tags" in payload.model_fields_set and payload.tags is not None:
        normalized_tags = _normalize_manual_tags(payload.tags)
        existing_media_tags = (
            await db.execute(select(MediaTag).options(selectinload(MediaTag.tag)).where(MediaTag.media_id == media_id))
        ).scalars().all()
        existing_by_name = {item.tag.name: item for item in existing_media_tags}
        for name, media_tag in existing_by_name.items():
            if name not in normalized_tags:
                media_tag.tag.media_count = max(0, media_tag.tag.media_count - 1)
                await db.delete(media_tag)
        new_tag_names = [name for name in normalized_tags if name not in existing_by_name]
        existing_tags = {}
        if new_tag_names:
            existing_tags = {tag.name: tag for tag in (await db.execute(select(Tag).where(Tag.name.in_(new_tag_names)))).scalars().all()}
        for name in new_tag_names:
            tag = existing_tags.get(name)
            if tag is None:
                tag = Tag(name=name, category=0, media_count=0)
                db.add(tag)
                await db.flush()
            tag.media_count += 1
            db.add(MediaTag(media_id=media_id, tag_id=tag.id, confidence=1.0))
        media.tags = normalized_tags
        media.is_nsfw = any(tag in NSFW_RATING_TAGS for tag in normalized_tags)

    if "character_name" in payload.model_fields_set:
        media.character_name = payload.character_name.strip() if payload.character_name and payload.character_name.strip() else None
    if "metadata" in payload.model_fields_set and "captured_at" in metadata_fields:
        media.captured_at = payload.metadata.captured_at or media.created_at
    if "deleted" in payload.model_fields_set:
        media.deleted_at = datetime.now(timezone.utc) if payload.deleted else None
    if "favorited" in payload.model_fields_set:
        await set_favorite_state(db, media.id, user, payload.favorited)

    await db.commit()
    media = await _get_media_with_tags(db, media_id, deleted=None)
    return await build_media_detail(db, media, user.id)


async def soft_delete_media(db: AsyncSession, media_id: uuid.UUID, user: User) -> None:
    media = await get_owned_or_admin_media(db, media_id, user, trashed=False)
    media.deleted_at = datetime.now(timezone.utc)
    await db.commit()


async def delete_media(db: AsyncSession, media_id: uuid.UUID, user: User) -> None:
    await soft_delete_media(db, media_id, user)


async def restore_media(db: AsyncSession, media_id: uuid.UUID, user: User) -> None:
    media = await get_owned_or_admin_media(db, media_id, user, trashed=True)
    media.deleted_at = None
    await db.commit()


async def purge_media(db: AsyncSession, media_id: uuid.UUID, user: User) -> None:
    media = await get_owned_or_admin_media(db, media_id, user, trashed=None)
    await purge_media_record(media, db)
    await db.commit()


async def favorite_media(db: AsyncSession, media_id: uuid.UUID, user: User) -> None:
    await set_favorite_state(db, media_id, user, True)
    await db.commit()


async def unfavorite_media(db: AsyncSession, media_id: uuid.UUID, user: User) -> None:
    favorite = await get_favorite(db, media_id, user.id)
    if favorite is None:
        raise HTTPException(status_code=404, detail="Not in favorites")
    await db.delete(favorite)
    await db.commit()


async def retag_media(db: AsyncSession, media_id: uuid.UUID, user: User) -> int:
    media = await get_owned_or_admin_media(db, media_id, user, trashed=False)
    media.tagging_status = "pending"
    await db.commit()
    queue = get_tag_queue()
    if queue:
        await queue.put(media_id)
    return 1


async def batch_update_media(db: AsyncSession, payload: MediaBatchUpdate, user: User) -> BulkResult:
    processed = skipped = 0
    if payload.deleted is not None:
        processed, skipped = await _batch_update_deleted_state(db, payload.media_ids, payload.deleted, user)
    elif payload.favorited is not None:
        processed, skipped = await _batch_update_favorite_state(db, payload.media_ids, payload.favorited, user)
    return BulkResult(processed=processed, skipped=skipped)


async def batch_delete_media(db: AsyncSession, payload: MediaBatchDelete, user: User) -> BulkResult:
    processed, skipped = await _batch_update_deleted_state(db, payload.media_ids, True, user)
    return BulkResult(processed=processed, skipped=skipped)


async def batch_purge_media(db: AsyncSession, payload: MediaBatchDelete, user: User) -> BulkResult:
    rows = (await db.execute(select(Media).where(Media.id.in_(payload.media_ids)))).scalars().all()
    found_ids = {row.id for row in rows}
    skipped = len(payload.media_ids) - len(found_ids)
    processed = 0
    for media in rows:
        if media.uploader_id == user.id or user.is_admin:
            await purge_media_record(media, db)
            processed += 1
        else:
            skipped += 1
    await db.commit()
    return BulkResult(processed=processed, skipped=skipped)


async def get_owned_or_admin_media(db: AsyncSession, media_id: uuid.UUID, user: User, trashed: bool | None) -> Media:
    stmt = select(Media).where(Media.id == media_id)
    if trashed is True:
        stmt = stmt.where(Media.deleted_at.is_not(None))
    elif trashed is False:
        stmt = stmt.where(Media.deleted_at.is_(None))
    media = (await db.execute(stmt)).scalar_one_or_none()
    if media is None:
        detail = "Not found in trash" if trashed is True else "Not found"
        raise HTTPException(status_code=404, detail=detail)
    if media.uploader_id != user.id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Forbidden")
    return media


async def get_active_media(db: AsyncSession, media_id: uuid.UUID) -> Media:
    media = (await db.execute(select(Media).where(Media.id == media_id, Media.deleted_at.is_(None)))).scalar_one_or_none()
    if media is None:
        raise HTTPException(status_code=404, detail="Not found")
    return media


async def get_favorite(db: AsyncSession, media_id: uuid.UUID, user_id: uuid.UUID) -> UserFavorite | None:
    return (
        await db.execute(select(UserFavorite).where(UserFavorite.user_id == user_id, UserFavorite.media_id == media_id))
    ).scalar_one_or_none()


async def set_favorite_state(db: AsyncSession, media_id: uuid.UUID, user: User, favorited: bool | None) -> bool:
    await get_active_media(db, media_id)
    existing = await get_favorite(db, media_id, user.id)
    if favorited is True and existing is None:
        db.add(UserFavorite(user_id=user.id, media_id=media_id))
        return True
    if favorited is False and existing is not None:
        await db.delete(existing)
        return True
    return False


async def _get_media_with_tags(db: AsyncSession, media_id: uuid.UUID, deleted: bool | None) -> Media | None:
    stmt = select(Media).options(selectinload(Media.media_tags).selectinload(MediaTag.tag)).where(Media.id == media_id)
    if deleted is True:
        stmt = stmt.where(Media.deleted_at.is_not(None))
    elif deleted is False:
        stmt = stmt.where(Media.deleted_at.is_(None))
    return (await db.execute(stmt)).scalar_one_or_none()


async def build_media_detail(db: AsyncSession, media: Media, user_id: uuid.UUID) -> MediaDetail:
    is_favorited = await get_favorite(db, media.id, user_id) is not None
    tag_details = [
        TagWithConfidence(
            name=item.tag.name,
            category=item.tag.category,
            category_name=CATEGORY_NAMES.get(item.tag.category, "unknown"),
            confidence=item.confidence,
        )
        for item in sorted(media.media_tags, key=lambda item: item.confidence, reverse=True)
    ]
    base = _build_media_read(media, is_favorited)
    return MediaDetail(**base.model_dump(), tag_details=tag_details)


async def _batch_update_deleted_state(db: AsyncSession, media_ids: list[uuid.UUID], deleted: bool, user: User) -> tuple[int, int]:
    rows = (await db.execute(select(Media).where(Media.id.in_(media_ids)))).scalars().all()
    found_ids = {row.id for row in rows}
    skipped = len(media_ids) - len(found_ids)
    processed = 0
    now = datetime.now(timezone.utc)
    for media in rows:
        if media.uploader_id != user.id and not user.is_admin:
            skipped += 1
            continue
        if deleted and media.deleted_at is None:
            media.deleted_at = now
            processed += 1
        elif not deleted and media.deleted_at is not None:
            media.deleted_at = None
            processed += 1
        else:
            skipped += 1
    await db.commit()
    return processed, skipped


async def _batch_update_favorite_state(db: AsyncSession, media_ids: list[uuid.UUID], favorited: bool, user: User) -> tuple[int, int]:
    active_ids = set((await db.execute(select(Media.id).where(Media.id.in_(media_ids), Media.deleted_at.is_(None)))).scalars().all())
    existing_ids = set(
        (
            await db.execute(select(UserFavorite.media_id).where(UserFavorite.user_id == user.id, UserFavorite.media_id.in_(media_ids)))
        ).scalars().all()
    )
    if favorited:
        to_change = active_ids - existing_ids
        for media_id in to_change:
            db.add(UserFavorite(user_id=user.id, media_id=media_id))
    else:
        to_change = existing_ids
        favorites = (
            await db.execute(select(UserFavorite).where(UserFavorite.user_id == user.id, UserFavorite.media_id.in_(media_ids)))
        ).scalars().all()
        for favorite in favorites:
            await db.delete(favorite)
    await db.commit()
    return len(to_change), len(media_ids) - len(to_change)


async def purge_media_record(media: Media, db: AsyncSession) -> None:
    tag_ids = (await db.execute(select(MediaTag.tag_id).where(MediaTag.media_id == media.id))).scalars().all()
    await db.delete(media)
    await db.flush()
    if tag_ids:
        for tag in (await db.execute(select(Tag).where(Tag.id.in_(tag_ids)))).scalars().all():
            tag.media_count = max(0, tag.media_count - 1)
    delete_media_files(media.filepath, media.poster_path, media.thumbnail_path)


async def tag_media(db: AsyncSession, media_id: uuid.UUID) -> None:
    media = (await db.execute(select(Media).where(Media.id == media_id))).scalar_one_or_none()
    if media is None:
        return
    media.tagging_status = "processing"
    await db.commit()

    frames = sample_media_frames(media.filepath, media.media_type)
    try:
        results: list[TaggingResult] = []
        for frame_path in frames or [Path(media.filepath)]:
            results.append(await tagger.predict(str(frame_path)))
        aggregated = aggregate_tagging_results(results)
        await _store_tagging_result(db, media, aggregated)
    finally:
        cleanup_sampled_frames([frame for frame in frames if frame != Path(media.filepath)])


def aggregate_tagging_results(results: list[TaggingResult]) -> TaggingResult:
    tag_map: dict[str, TagPrediction] = {}
    for result in results:
        for prediction in result.predictions:
            existing = tag_map.get(prediction.name)
            if existing is None or prediction.confidence > existing.confidence:
                tag_map[prediction.name] = prediction
    predictions = sorted(tag_map.values(), key=lambda item: item.confidence, reverse=True)
    return TaggingResult(
        predictions=predictions,
        character_name=derive_character_name(predictions),
        is_nsfw=any(result.is_nsfw for result in results),
    )


async def _store_tagging_result(db: AsyncSession, media: Media, tagging_result: TaggingResult) -> None:
    existing_mts = await db.execute(select(MediaTag).where(MediaTag.media_id == media.id))
    old_tag_ids = [it.tag_id for it in existing_mts.scalars().all()]
    if old_tag_ids:
        old_tags = await db.execute(select(Tag).where(Tag.id.in_(old_tag_ids)))
        for tag in old_tags.scalars().all():
            tag.media_count = max(0, tag.media_count - 1)
        await db.execute(MediaTag.__table__.delete().where(MediaTag.media_id == media.id))

    tag_names: list[str] = []
    for prediction in tagging_result.predictions:
        tag_result = await db.execute(select(Tag).where(Tag.name == prediction.name))
        tag = tag_result.scalar_one_or_none()
        if tag is None:
            tag = Tag(name=prediction.name, category=prediction.category, media_count=0)
            db.add(tag)
            await db.flush()
        tag.media_count += 1
        db.add(MediaTag(media_id=media.id, tag_id=tag.id, confidence=prediction.confidence))
        tag_names.append(prediction.name)

    media.tags = tag_names
    media.character_name = tagging_result.character_name
    media.is_nsfw = tagging_result.is_nsfw
    media.tagging_status = "done"
    await db.commit()
