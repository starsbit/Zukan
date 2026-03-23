import asyncio
import base64
import json
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import UploadFile
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.app.config import settings
from backend.app.errors import AppError, album_not_found, media_not_found, nsfw_hidden, nsfw_disabled, tagging_job_already_queued, upload_limit_exceeded, version_conflict
from backend.app.models.auth import User
from backend.app.models.albums import Album, AlbumMedia, AlbumShare
from backend.app.models.media import Media, MediaTag, MediaType
from backend.app.models.tags import Tag  # noqa: F401 — referenced by tests via media_service.Tag
from backend.app.models.relations import MediaEntity, MediaEntityType
from backend.app.models.media_interactions import UserFavorite
from backend.app.repositories import media_filters
from backend.app.repositories.media import MediaRepository
from backend.app.repositories.media_interactions import UserFavoriteRepository
from backend.app.repositories.relations import MediaEntityRepository, MediaExternalRefRepository
from backend.app.repositories.tags import TagRepository
from backend.app.schemas import (
    BatchUploadResponse,
    BulkResult,
    CATEGORY_NAMES,
    EntityRead,
    ExternalRefRead,
    MediaBatchDelete,
    MediaBatchUpdate,
    MediaCursorPage,
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
from backend.app.services.storage import (
    cleanup_sampled_frames,
    delete_media_files,
    extract_media_metadata,
    generate_poster_and_thumbnail,
    sample_media_frames,
    save_upload,
)
from backend.app.services.tagger import NSFW_RATING_TAGS, TagPrediction, TaggingResult, derive_character_name, tag_names_mark_nsfw, tagger  # noqa: F401

_tag_queue: asyncio.Queue | None = None
TRASH_RETENTION_DAYS = 30


def set_tag_queue(queue: asyncio.Queue) -> None:
    global _tag_queue
    _tag_queue = queue


def get_tag_queue() -> asyncio.Queue | None:
    return _tag_queue


def _trash_expiration_cutoff(now: datetime | None = None) -> datetime:
    reference = now or datetime.now(timezone.utc)
    return reference - timedelta(days=TRASH_RETENTION_DAYS)


async def purge_expired_trash(db: AsyncSession, now: datetime | None = None) -> int:
    expired = await MediaRepository(db).get_expired_trash(_trash_expiration_cutoff(now))
    for media in expired:
        await purge_media_record(media, db)
    if expired:
        await db.commit()
    return len(expired)


def enrich_media(rows: list[Media], favorited: set[uuid.UUID]) -> list[MediaRead]:
    return [_build_media_read(row, row.id in favorited) for row in rows]


async def favorited_ids(db: AsyncSession, user_id: uuid.UUID, media_ids: list[uuid.UUID]) -> set[uuid.UUID]:
    return await UserFavoriteRepository(db).get_favorited_ids(user_id, media_ids)


def _parse_csv_values(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


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
    return media_filters.captured_timestamp_expr()


def _encode_cursor(sort_val, item_id: uuid.UUID) -> str:
    s = sort_val.isoformat() if isinstance(sort_val, datetime) else sort_val
    payload = json.dumps({"s": s, "id": str(item_id)}, separators=(",", ":"))
    return base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")


def _decode_cursor(cursor: str, sort_by: str) -> tuple | None:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        data = json.loads(base64.urlsafe_b64decode(padded))
        item_id = uuid.UUID(data["id"])
        s = data["s"]
        if sort_by in ("captured_at", "created_at"):
            sort_val = datetime.fromisoformat(s)
        elif sort_by == "file_size":
            sort_val = int(s)
        else:
            sort_val = s
        return sort_val, item_id
    except Exception:
        return None


def _apply_cursor_where(stmt, sort_by: str, sort_order: str, cursor_val, cursor_id: uuid.UUID):
    sort_expr = {
        "captured_at": _captured_timestamp_expr(),
        "created_at": Media.created_at,
        "filename": Media.filename,
        "file_size": Media.file_size,
    }[sort_by]
    if sort_order == "desc":
        return stmt.where(and_(sort_expr < cursor_val) | and_(sort_expr == cursor_val, Media.id < cursor_id))
    return stmt.where(and_(sort_expr > cursor_val) | and_(sort_expr == cursor_val, Media.id > cursor_id))


def _format_tagging_error(exc: Exception) -> str:
    message = str(exc).strip() or exc.__class__.__name__
    return f"{exc.__class__.__name__}: {message}"[:1024]


async def mark_tagging_failure(db: AsyncSession, media_id: uuid.UUID, exc: Exception) -> None:
    media = await MediaRepository(db).get_by_id(media_id)
    if media is None:
        return
    media.tagging_status = "failed"
    media.tagging_error = _format_tagging_error(exc)
    await db.commit()


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


def _build_tag_payloads(
    tag_names: list[str],
    *,
    default_category: int = 0,
    default_confidence: float = 1.0,
) -> list[tuple[str, int, float]]:
    return [(tag_name, default_category, default_confidence) for tag_name in _normalize_manual_tags(tag_names)]


async def _set_media_tag_links(db: AsyncSession, media: Media, tag_payloads: list[tuple[str, int, float]]) -> None:
    await TagRepository(db).set_media_tag_links(media, tag_payloads)


async def list_media(
    db: AsyncSession,
    user: User,
    state: MediaListState,
    tags: list[str] | None,
    character_name: str | None,
    exclude_tags: list[str] | None,
    mode: TagFilterMode,
    nsfw: NsfwFilter,
    status_filter: str | None,
    metadata: MediaMetadataFilter,
    favorited: bool | None,
    media_type: list[str] | None = None,
    album_id: uuid.UUID | None = None,
    after: str | None = None,
    page_size: int = 20,
    sort_by: str = "captured_at",
    sort_order: str = "desc",
    ocr_text: str | None = None,
    include_total: bool = True,
) -> MediaCursorPage:
    await purge_expired_trash(db)
    stmt = select(Media).options(selectinload(Media.media_tags).selectinload(MediaTag.tag))
    if album_id is not None:
        await _ensure_album_is_visible(db, user, album_id)
        stmt = stmt.join(AlbumMedia, AlbumMedia.media_id == Media.id).where(AlbumMedia.album_id == album_id)
    if state == MediaListState.TRASHED:
        stmt = stmt.where(Media.deleted_at.is_not(None))
        if not user.is_admin:
            stmt = stmt.where(Media.uploader_id == user.id)
    else:
        stmt = stmt.where(Media.deleted_at.is_(None))
        if nsfw == NsfwFilter.ONLY and not user.show_nsfw and not user.is_admin:
            raise AppError(status_code=403, code=nsfw_disabled, detail="Enable NSFW in your profile first")
        stmt = media_filters.apply_nsfw_list_filter(stmt, user, nsfw)
    status_values = [value for value in _parse_csv_values(status_filter) if value != "any"]
    if status_values:
        stmt = stmt.where(Media.tagging_status.in_(status_values))
    if favorited is True:
        stmt = stmt.join(UserFavorite, and_(UserFavorite.media_id == Media.id, UserFavorite.user_id == user.id))

    stmt = media_filters.apply_tag_filters(stmt, tags, exclude_tags, mode)
    stmt = media_filters.apply_character_name_filter(stmt, character_name)
    stmt = media_filters.apply_media_type_filters(stmt, media_type)
    stmt = media_filters.apply_captured_at_filters(stmt, metadata)
    stmt = media_filters.apply_ocr_text_filter(stmt, ocr_text)

    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one() if include_total else None

    if after is not None:
        decoded = _decode_cursor(after, sort_by)
        if decoded is not None:
            cursor_val, cursor_id = decoded
            stmt = _apply_cursor_where(stmt, sort_by, sort_order, cursor_val, cursor_id)

    sort_col = {
        "captured_at": _captured_timestamp_expr(),
        "created_at": Media.created_at,
        "filename": Media.filename,
        "file_size": Media.file_size,
    }[sort_by]
    if sort_order == "desc":
        order_exprs = [sort_col.desc(), Media.id.desc()]
    else:
        order_exprs = [sort_col.asc(), Media.id.asc()]

    rows = (await db.execute(stmt.order_by(*order_exprs).limit(page_size))).scalars().all()
    favs = await UserFavoriteRepository(db).get_favorited_ids(user.id, [row.id for row in rows])

    next_cursor = None
    if len(rows) == page_size:
        last = rows[-1]
        sv = (last.captured_at or last.created_at) if sort_by == "captured_at" else getattr(last, sort_by)
        next_cursor = _encode_cursor(sv, last.id)

    return MediaCursorPage(total=total, next_cursor=next_cursor, page_size=page_size, items=enrich_media(rows, favs))


async def _ensure_album_is_visible(db: AsyncSession, user: User, album_id: uuid.UUID) -> None:
    album = (await db.execute(select(Album).where(Album.id == album_id))).scalar_one_or_none()
    if album is None:
        raise AppError(status_code=404, code=album_not_found, detail="Album not found")

    if album.owner_id == user.id or user.is_admin:
        return

    share = (
        await db.execute(select(AlbumShare).where(AlbumShare.album_id == album_id, AlbumShare.user_id == user.id))
    ).scalar_one_or_none()
    if share is None:
        raise AppError(status_code=404, code=album_not_found, detail="Album not found")


async def list_character_suggestions(
    db: AsyncSession,
    user: User,
    *,
    q: str,
    limit: int,
) -> list[dict[str, int | str]]:
    await purge_expired_trash(db)
    query = q.strip()
    if not query:
        return []
    return await MediaEntityRepository(db).list_character_suggestions(
        query=query,
        limit=limit,
        show_nsfw=user.show_nsfw,
        is_admin=user.is_admin,
    )


async def list_trash(db: AsyncSession, user: User, after: str | None, page_size: int) -> MediaCursorPage:
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
        media_type=None,
        album_id=None,
        after=after,
        page_size=page_size,
    )


async def empty_trash(db: AsyncSession, user: User) -> None:
    await purge_expired_trash(db)
    stmt = select(Media).where(Media.deleted_at.is_not(None))
    if not user.is_admin:
        stmt = stmt.where(Media.uploader_id == user.id)
    for media in (await db.execute(stmt)).scalars().all():
        await purge_media_record(media, db)
    await db.commit()


async def list_favorites(
    db: AsyncSession,
    user: User,
    tags: list[str] | None,
    exclude_tags: list[str] | None,
    mode: TagFilterMode,
    page: int,
    page_size: int,
) -> MediaListResponse:
    await purge_expired_trash(db)
    stmt = (
        select(Media)
        .options(selectinload(Media.media_tags).selectinload(MediaTag.tag))
        .join(UserFavorite, and_(UserFavorite.media_id == Media.id, UserFavorite.user_id == user.id))
        .where(Media.deleted_at.is_(None))
    )
    if not user.show_nsfw:
        stmt = stmt.where(Media.is_nsfw == False)
    stmt = media_filters.apply_tag_filters(stmt, tags, exclude_tags, mode)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (
        await db.execute(stmt.order_by(_captured_timestamp_expr().desc()).offset((page - 1) * page_size).limit(page_size))
    ).scalars().all()
    return MediaListResponse(total=total, page=page, page_size=page_size, items=[_build_media_read(row, True) for row in rows])


async def build_upload_response(
    db: AsyncSession,
    user: User,
    files: list[UploadFile],
    *,
    album_id: uuid.UUID | None = None,
    tags: list[str] | None = None,
    captured_at_override: datetime | None = None,
) -> BatchUploadResponse:
    await purge_expired_trash(db)
    if len(files) > settings.max_batch_size:
        raise AppError(status_code=400, code=upload_limit_exceeded, detail=f"Max {settings.max_batch_size} files per request")

    queue = get_tag_queue()
    results: list[UploadResult] = []
    accepted = duplicates = errors = 0
    queued_media_ids: list[uuid.UUID] = []
    tagging_media_ids: list[uuid.UUID] = []
    media_repo = MediaRepository(db)
    tags_repo = TagRepository(db)

    for upload in files:
        original_name = upload.filename or "unknown"
        saved = await save_upload(upload)
        if saved is None:
            results.append(
                UploadResult(id=None, original_filename=original_name, status="error", message="Unsupported type or file too large")
            )
            errors += 1
            continue

        file_metadata = extract_media_metadata(str(saved.path), saved.media_type)
        captured_at = file_metadata.captured_at or datetime.now(timezone.utc)
        existing = await media_repo.get_by_sha256(saved.sha256)
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
            existing.tagging_error = None
            existing.captured_at = existing.captured_at or captured_at
            await db.flush()
            queued_media_ids.append(existing.id)
            tagging_media_ids.append(existing.id)
            results.append(UploadResult(id=existing.id, original_filename=original_name, status="accepted"))
            accepted += 1
            continue

        poster, thumb = generate_poster_and_thumbnail(str(saved.path), saved.media_type)
        normalized_tags = _normalize_manual_tags(tags) if tags else []
        media = Media(
            uploader_id=user.id,
            filename=saved.path.name,
            original_filename=original_name,
            filepath=str(saved.path),
            file_size=saved.file_size,
            sha256=saved.sha256,
            mime_type=saved.mime_type,
            media_type=saved.media_type,
            width=file_metadata.width,
            height=file_metadata.height,
            duration_seconds=file_metadata.duration_seconds,
            frame_count=file_metadata.frame_count,
            tagging_status="pending",
            tagging_error=None,
            thumbnail_path=str(thumb) if thumb else None,
            thumbnail_status="done" if thumb else "failed",
            poster_path=str(poster) if poster else None,
            poster_status="done" if poster or saved.media_type == MediaType.IMAGE else "failed",
            captured_at=captured_at_override or captured_at,
        )
        db.add(media)
        await db.flush()
        if normalized_tags:
            await tags_repo.set_media_tag_links(media, _build_tag_payloads(normalized_tags))
            media.is_nsfw = tag_names_mark_nsfw(normalized_tags)
            media.tagging_status = "done"
        else:
            tagging_media_ids.append(media.id)
        queued_media_ids.append(media.id)
        results.append(UploadResult(id=media.id, original_filename=original_name, status="accepted"))
        accepted += 1

    await db.commit()
    if album_id is not None and queued_media_ids:
        from backend.app.services.albums import add_media_to_album
        await add_media_to_album(db, album_id, queued_media_ids, user)
    if queue:
        for media_id in tagging_media_ids:
            await queue.put(media_id)
    return BatchUploadResponse(accepted=accepted, duplicates=duplicates, errors=errors, results=results)


async def get_downloadable_media(db: AsyncSession, user: User, media_ids: list[uuid.UUID]) -> list[Media]:
    await purge_expired_trash(db)
    rows = await MediaRepository(db).get_by_ids(media_ids)
    rows = [row for row in rows if row.deleted_at is None]
    if not user.is_admin:
        rows = [row for row in rows if row.uploader_id == user.id]
    if not rows:
        raise AppError(status_code=404, code=media_not_found, detail="No accessible media found")
    return rows


async def get_visible_media(db: AsyncSession, media_id: uuid.UUID, user: User) -> Media:
    await purge_expired_trash(db)
    media = await MediaRepository(db).get_by_id(media_id)
    if media is None:
        raise AppError(status_code=404, code=media_not_found, detail="Not found")
    if media.deleted_at is not None and media.uploader_id != user.id and not user.is_admin:
        raise AppError(status_code=404, code=media_not_found, detail="Not found")
    if media.is_nsfw and not user.show_nsfw and not user.is_admin:
        raise AppError(status_code=403, code=nsfw_hidden, detail="NSFW content hidden")
    return media


async def get_media_detail(db: AsyncSession, media_id: uuid.UUID, user: User) -> MediaDetail:
    await purge_expired_trash(db)
    media = await MediaRepository(db).get_by_id_with_relations(media_id, deleted=False)
    if media is None:
        raise AppError(status_code=404, code=media_not_found, detail="Not found")
    if media.is_nsfw and not user.show_nsfw and not user.is_admin:
        raise AppError(status_code=403, code=nsfw_hidden, detail="NSFW content hidden")
    return await build_media_detail(db, media, user.id)


async def update_media_metadata(db: AsyncSession, media_id: uuid.UUID, user: User, payload: MediaUpdate) -> MediaDetail:
    await purge_expired_trash(db)
    metadata_fields = payload.metadata.model_fields_set if payload.metadata is not None else set()
    needs_owner_access = any(field in payload.model_fields_set for field in {"tags", "entities", "metadata", "deleted", "ocr_text_override", "external_refs"})
    if needs_owner_access:
        media = await get_owned_or_admin_media(db, media_id, user, trashed=None)
    else:
        media = await get_active_media(db, media_id)

    if "version" in payload.model_fields_set and payload.version is not None and payload.version != media.version:
        raise AppError(status_code=409, code=version_conflict, detail="Version conflict: resource was modified by another request")

    if "tags" in payload.model_fields_set and payload.tags is not None:
        normalized_tags = _normalize_manual_tags(payload.tags)
        await TagRepository(db).set_media_tag_links(media, _build_tag_payloads(normalized_tags))
        media.is_nsfw = tag_names_mark_nsfw(normalized_tags)

    if "entities" in payload.model_fields_set and payload.entities is not None:
        for entity in await MediaEntityRepository(db).get_by_media(media.id):
            await db.delete(entity)
        await db.flush()
        for entity_create in payload.entities:
            db.add(MediaEntity(
                media_id=media.id,
                entity_type=entity_create.entity_type,
                entity_id=entity_create.entity_id,
                name=entity_create.name,
                role=entity_create.role,
                source="manual",
                confidence=entity_create.confidence,
            ))
    if "metadata" in payload.model_fields_set and "captured_at" in metadata_fields:
        media.captured_at = payload.metadata.captured_at or media.created_at
    if "deleted" in payload.model_fields_set:
        media.deleted_at = datetime.now(timezone.utc) if payload.deleted else None
    if "ocr_text_override" in payload.model_fields_set:
        media.ocr_text_override = payload.ocr_text_override or None
    if "external_refs" in payload.model_fields_set and payload.external_refs is not None:
        for ref in await MediaExternalRefRepository(db).get_by_media(media.id):
            await db.delete(ref)
        await db.flush()
        from backend.app.models.relations import MediaExternalRef
        for ref_create in payload.external_refs:
            db.add(MediaExternalRef(media_id=media.id, provider=ref_create.provider, external_id=ref_create.external_id, url=ref_create.url))
    if "favorited" in payload.model_fields_set:
        await set_favorite_state(db, media.id, user, payload.favorited)

    await db.commit()
    media = await MediaRepository(db).get_by_id_with_relations(media_id, deleted=None)
    return await build_media_detail(db, media, user.id)


async def soft_delete_media(db: AsyncSession, media_id: uuid.UUID, user: User) -> None:
    await purge_expired_trash(db)
    media = await get_owned_or_admin_media(db, media_id, user, trashed=False)
    media.deleted_at = datetime.now(timezone.utc)
    await db.commit()


async def delete_media(db: AsyncSession, media_id: uuid.UUID, user: User) -> None:
    await soft_delete_media(db, media_id, user)


async def restore_media(db: AsyncSession, media_id: uuid.UUID, user: User) -> None:
    await purge_expired_trash(db)
    media = await get_owned_or_admin_media(db, media_id, user, trashed=True)
    media.deleted_at = None
    await db.commit()


async def purge_media(db: AsyncSession, media_id: uuid.UUID, user: User) -> None:
    await purge_expired_trash(db)
    media = await get_owned_or_admin_media(db, media_id, user, trashed=None)
    await purge_media_record(media, db)
    await db.commit()


async def favorite_media(db: AsyncSession, media_id: uuid.UUID, user: User) -> None:
    await purge_expired_trash(db)
    await set_favorite_state(db, media_id, user, True)
    await db.commit()


async def unfavorite_media(db: AsyncSession, media_id: uuid.UUID, user: User) -> None:
    await purge_expired_trash(db)
    favorite = await UserFavoriteRepository(db).get(media_id, user.id)
    if favorite is None:
        raise AppError(status_code=404, code=media_not_found, detail="Not in favorites")
    await db.delete(favorite)
    await db.commit()


async def retag_media(db: AsyncSession, media_id: uuid.UUID, user: User) -> int:
    await purge_expired_trash(db)
    media = await get_owned_or_admin_media(db, media_id, user, trashed=False)
    if media.tagging_status in ("pending", "processing"):
        raise AppError(status_code=409, code=tagging_job_already_queued, detail="Tagging job is already queued or running")
    media.tagging_status = "pending"
    media.tagging_error = None
    await db.commit()
    queue = get_tag_queue()
    if queue:
        await queue.put(media_id)
    return 1


async def batch_update_media(db: AsyncSession, payload: MediaBatchUpdate, user: User) -> BulkResult:
    await purge_expired_trash(db)
    processed = skipped = 0
    if payload.deleted is not None:
        processed, skipped = await _batch_update_deleted_state(db, payload.media_ids, payload.deleted, user)
    elif payload.favorited is not None:
        processed, skipped = await _batch_update_favorite_state(db, payload.media_ids, payload.favorited, user)
    return BulkResult(processed=processed, skipped=skipped)


async def batch_delete_media(db: AsyncSession, payload: MediaBatchDelete, user: User) -> BulkResult:
    await purge_expired_trash(db)
    processed, skipped = await _batch_update_deleted_state(db, payload.media_ids, True, user)
    return BulkResult(processed=processed, skipped=skipped)


async def batch_purge_media(db: AsyncSession, payload: MediaBatchDelete, user: User) -> BulkResult:
    await purge_expired_trash(db)
    rows = await MediaRepository(db).get_by_ids(payload.media_ids)
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
    media = await MediaRepository(db).get_by_id(media_id)
    if media is not None:
        if trashed is True and media.deleted_at is None:
            media = None
        elif trashed is False and media.deleted_at is not None:
            media = None
    if media is None:
        detail = "Not found in trash" if trashed is True else "Not found"
        raise AppError(status_code=404, code=media_not_found, detail=detail)
    if media.uploader_id != user.id and not user.is_admin:
        raise AppError(status_code=403, code=media_not_found, detail="Forbidden")
    return media


async def get_active_media(db: AsyncSession, media_id: uuid.UUID) -> Media:
    media = await MediaRepository(db).get_by_id(media_id)
    if media is None or media.deleted_at is not None:
        raise AppError(status_code=404, code=media_not_found, detail="Not found")
    return media


async def get_favorite(db: AsyncSession, media_id: uuid.UUID, user_id: uuid.UUID) -> UserFavorite | None:
    return await UserFavoriteRepository(db).get(media_id, user_id)


async def set_favorite_state(db: AsyncSession, media_id: uuid.UUID, user: User, favorited: bool | None) -> bool:
    await get_active_media(db, media_id)
    existing = await UserFavoriteRepository(db).get(media_id, user.id)
    if favorited is True and existing is None:
        db.add(UserFavorite(user_id=user.id, media_id=media_id))
        return True
    if favorited is False and existing is not None:
        await db.delete(existing)
        return True
    return False


async def _get_media_with_tags(db: AsyncSession, media_id: uuid.UUID, deleted: bool | None) -> Media | None:
    return await MediaRepository(db).get_by_id_with_relations(media_id, deleted=deleted)


async def build_media_detail(db: AsyncSession, media: Media, user_id: uuid.UUID) -> MediaDetail:
    is_favorited = await UserFavoriteRepository(db).get(media.id, user_id) is not None
    tag_details = [
        TagWithConfidence(
            name=item.tag.name,
            category=item.tag.category,
            category_name=CATEGORY_NAMES.get(item.tag.category, "unknown"),
            category_key=CATEGORY_NAMES.get(item.tag.category, "unknown"),
            confidence=item.confidence,
        )
        for item in sorted(media.media_tags, key=lambda item: item.confidence, reverse=True)
    ]
    external_refs = [
        ExternalRefRead(id=ref.id, provider=ref.provider, external_id=ref.external_id, url=ref.url)
        for ref in media.external_refs
    ]
    entities = [
        EntityRead(
            id=entity.id,
            entity_type=entity.entity_type,
            entity_id=entity.entity_id,
            name=entity.name,
            role=entity.role,
            source=entity.source,
            confidence=entity.confidence,
        )
        for entity in media.entities
    ]
    base = _build_media_read(media, is_favorited)
    return MediaDetail(**base.model_dump(), tag_details=tag_details, external_refs=external_refs, entities=entities)


async def _batch_update_deleted_state(db: AsyncSession, media_ids: list[uuid.UUID], deleted: bool, user: User) -> tuple[int, int]:
    rows = await MediaRepository(db).get_by_ids(media_ids)
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
    active_ids = await MediaRepository(db).get_active_ids(media_ids)
    favorites_repo = UserFavoriteRepository(db)
    existing_favorites = await favorites_repo.get_by_user_and_media_ids(user.id, media_ids)
    existing_ids = {f.media_id for f in existing_favorites}
    if favorited:
        to_change = active_ids - existing_ids
        for media_id in to_change:
            db.add(UserFavorite(user_id=user.id, media_id=media_id))
    else:
        to_change = existing_ids
        for favorite in existing_favorites:
            await db.delete(favorite)
    await db.commit()
    return len(to_change), len(media_ids) - len(to_change)


async def purge_media_record(media: Media, db: AsyncSession) -> None:
    await MediaRepository(db).delete(media)
    delete_media_files(media.filepath, media.poster_path, media.thumbnail_path)


async def tag_media(db: AsyncSession, media_id: uuid.UUID) -> None:
    media = await MediaRepository(db).get_by_id(media_id)
    if media is None:
        return
    media.tagging_status = "processing"
    media.tagging_error = None
    await db.commit()

    frames = sample_media_frames(media.filepath, media.media_type)
    try:
        results: list[TaggingResult] = []
        for frame_path in frames or [Path(media.filepath)]:
            results.append(await _predict_with_retries(str(frame_path)))
        aggregated = aggregate_tagging_results(results)
        await _store_tagging_result(db, media, aggregated)
    finally:
        cleanup_sampled_frames([frame for frame in frames if frame != Path(media.filepath)])


async def _predict_with_retries(image_path: str) -> TaggingResult:
    attempts = max(1, settings.tagging_retry_attempts)
    last_error: Exception | None = None

    for attempt in range(1, attempts + 1):
        try:
            return await tagger.predict(image_path)
        except Exception as exc:
            last_error = exc
            if attempt >= attempts:
                break
            await asyncio.sleep(settings.tagging_retry_backoff_seconds * attempt)

    assert last_error is not None
    raise last_error


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
        is_nsfw=any(result.is_nsfw for result in results) or tag_names_mark_nsfw([prediction.name for prediction in predictions]),
    )


async def _store_tagging_result(db: AsyncSession, media: Media, tagging_result: TaggingResult) -> None:
    uploader = None
    if media.uploader_id is not None:
        uploader = await db.get(User, media.uploader_id)
    tag_threshold = uploader.tag_confidence_threshold if uploader is not None else settings.tagger_threshold_general

    filtered_predictions = [
        prediction
        for prediction in tagging_result.predictions
        if prediction.category == 9 or prediction.confidence >= tag_threshold
    ]

    tag_payloads = [(prediction.name, prediction.category, prediction.confidence) for prediction in filtered_predictions]
    await TagRepository(db).set_media_tag_links(media, tag_payloads)
    tag_names = [prediction.name for prediction in filtered_predictions]
    media.is_nsfw = tagging_result.is_nsfw or tag_names_mark_nsfw(tag_names)
    media.tagging_status = "done"
    media.tagging_error = None

    for entity in await MediaEntityRepository(db).get_tagger_char_entities(media.id):
        await db.delete(entity)

    char_name = derive_character_name(filtered_predictions)
    if char_name:
        char_pred = next((p for p in filtered_predictions if p.name == char_name), None)
        db.add(MediaEntity(
            media_id=media.id,
            entity_type=MediaEntityType.character,
            name=char_name,
            role="primary",
            source="tagger",
            confidence=char_pred.confidence if char_pred else None,
        ))

    await db.commit()
