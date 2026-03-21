import asyncio
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, UploadFile
from sqlalchemy import and_, extract, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.models import Image, ImageTag, Tag, User, UserFavorite
from app.schemas import (
    BatchUploadResponse,
    BulkResult,
    CATEGORY_NAMES,
    ImageDetail,
    ImageBatchDelete,
    ImageBatchUpdate,
    ImageMetadataFilter,
    ImageMetadata,
    ImageListResponse,
    ImageListState,
    ImageRead,
    ImageUpdate,
    NsfwFilter,
    TagFilterMode,
    TagWithConfidence,
    UploadResult,
)
from app.services.storage import delete_file, extract_image_timestamp, generate_thumbnail, get_image_dimensions, save_upload
from app.services.tagger import NSFW_RATING_TAGS

_tag_queue: asyncio.Queue | None = None


def set_tag_queue(queue: asyncio.Queue) -> None:
    global _tag_queue
    _tag_queue = queue


def get_tag_queue() -> asyncio.Queue | None:
    return _tag_queue


def enrich_images(rows: list[Image], favorited: set[uuid.UUID]) -> list[ImageRead]:
    return [_build_image_read(row, row.id in favorited) for row in rows]


async def favorited_ids(db: AsyncSession, user_id: uuid.UUID, image_ids: list[uuid.UUID]) -> set[uuid.UUID]:
    if not image_ids:
        return set()

    result = await db.execute(
        select(UserFavorite.image_id).where(
            UserFavorite.user_id == user_id,
            UserFavorite.image_id.in_(image_ids),
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
        stmt = stmt.where(Image.tags.contains(include_tags) if mode == TagFilterMode.AND else Image.tags.overlap(include_tags))

    excluded_tags = _parse_tag_values(exclude_tags)
    if excluded_tags:
        stmt = stmt.where(~Image.tags.contains(excluded_tags))

    return stmt


def _apply_character_name_filter(stmt, character_name: str | None):
    if character_name and character_name.strip():
        stmt = stmt.where(Image.character_name.ilike(f"%{character_name.strip()}%"))
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
    return func.coalesce(Image.captured_at, Image.created_at)


def _image_captured_at(image: Image) -> datetime:
    return image.captured_at or image.created_at


def _build_image_metadata(image: Image) -> ImageMetadata:
    return ImageMetadata(
        file_size=image.file_size,
        width=image.width,
        height=image.height,
        mime_type=image.mime_type,
        captured_at=_image_captured_at(image),
    )


def _build_image_read(image: Image, is_favorited: bool) -> ImageRead:
    return ImageRead(
        id=image.id,
        uploader_id=image.uploader_id,
        filename=image.filename,
        original_filename=image.original_filename,
        metadata=_build_image_metadata(image),
        tags=image.tags,
        character_name=image.character_name,
        is_nsfw=image.is_nsfw,
        tagging_status=image.tagging_status,
        thumbnail_status=image.thumbnail_status,
        created_at=image.created_at,
        deleted_at=image.deleted_at,
        is_favorited=is_favorited,
    )


def _apply_nsfw_list_filter(stmt, user: User, nsfw: NsfwFilter):
    if nsfw == NsfwFilter.DEFAULT:
        if not user.show_nsfw:
            stmt = stmt.where(Image.is_nsfw == False)
        return stmt

    if nsfw == NsfwFilter.ONLY:
        if not user.show_nsfw and not user.is_admin:
            raise HTTPException(status_code=403, detail="Enable NSFW in your profile first")
        return stmt.where(Image.is_nsfw == True)

    return stmt


def _apply_captured_at_filters(
    stmt,
    metadata: ImageMetadataFilter,
):
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


async def list_images(
    db: AsyncSession,
    user: User,
    state: ImageListState,
    tags: str | None,
    character_name: str | None,
    exclude_tags: str | None,
    mode: TagFilterMode,
    nsfw: NsfwFilter,
    status_filter: str | None,
    metadata: ImageMetadataFilter,
    favorited: bool | None,
    page: int,
    page_size: int,
) -> ImageListResponse:
    stmt = select(Image)
    if state == ImageListState.TRASHED:
        stmt = stmt.where(Image.deleted_at.is_not(None))
        if not user.is_admin:
            stmt = stmt.where(Image.uploader_id == user.id)
    else:
        stmt = stmt.where(Image.deleted_at.is_(None))
        stmt = _apply_nsfw_list_filter(stmt, user, nsfw)

    if status_filter and status_filter != "any":
        stmt = stmt.where(Image.tagging_status == status_filter)

    if favorited is True:
        stmt = stmt.join(UserFavorite, and_(UserFavorite.image_id == Image.id, UserFavorite.user_id == user.id))

    stmt = _apply_tag_filters(stmt, tags, exclude_tags, mode)
    stmt = _apply_character_name_filter(stmt, character_name)
    stmt = _apply_captured_at_filters(stmt, metadata)

    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (
        await db.execute(stmt.order_by(_captured_timestamp_expr().desc()).offset((page - 1) * page_size).limit(page_size))
    ).scalars().all()
    favs = await favorited_ids(db, user.id, [row.id for row in rows])
    return ImageListResponse(total=total, page=page, page_size=page_size, items=enrich_images(rows, favs))


async def list_trash(db: AsyncSession, user: User, page: int, page_size: int) -> ImageListResponse:
    return await list_images(
        db,
        user,
        ImageListState.TRASHED,
        tags=None,
        character_name=None,
        exclude_tags=None,
        mode=TagFilterMode.AND,
        nsfw=NsfwFilter.DEFAULT,
        status_filter=None,
        metadata=ImageMetadataFilter(),
        favorited=None,
        page=page,
        page_size=page_size,
    )


async def empty_trash(db: AsyncSession, user: User) -> None:
    stmt = select(Image).where(Image.deleted_at.is_not(None))
    if not user.is_admin:
        stmt = stmt.where(Image.uploader_id == user.id)

    for image in (await db.execute(stmt)).scalars().all():
        await purge_image_record(image, db)

    await db.commit()


async def list_favorites(
    db: AsyncSession,
    user: User,
    tags: str | None,
    exclude_tags: str | None,
    mode: TagFilterMode,
    page: int,
    page_size: int,
) -> ImageListResponse:
    stmt = (
        select(Image)
        .join(UserFavorite, and_(UserFavorite.image_id == Image.id, UserFavorite.user_id == user.id))
        .where(Image.deleted_at.is_(None))
    )
    if not user.show_nsfw:
        stmt = stmt.where(Image.is_nsfw == False)

    stmt = _apply_tag_filters(stmt, tags, exclude_tags, mode)

    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (
        await db.execute(stmt.order_by(_captured_timestamp_expr().desc()).offset((page - 1) * page_size).limit(page_size))
    ).scalars().all()
    return ImageListResponse(
        total=total,
        page=page,
        page_size=page_size,
        items=[_build_image_read(row, True) for row in rows],
    )


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
                UploadResult(
                    id=None,
                    original_filename=original_name,
                    status="error",
                    message="Unsupported type or file too large",
                )
            )
            errors += 1
            continue

        path, sha256, file_size = saved
        captured_at = extract_image_timestamp(str(path)) or datetime.now(timezone.utc)
        existing = (await db.execute(select(Image).where(Image.sha256 == sha256))).scalar_one_or_none()
        if existing is not None:
            delete_file(str(path))
            if existing.deleted_at is None:
                results.append(
                    UploadResult(
                        id=None,
                        original_filename=original_name,
                        status="duplicate",
                        message="Image already exists",
                    )
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

        dims = get_image_dimensions(str(path))
        thumb = generate_thumbnail(str(path))
        image = Image(
            uploader_id=user.id,
            filename=path.name,
            original_filename=original_name,
            filepath=str(path),
            file_size=file_size,
            width=dims[0] if dims else None,
            height=dims[1] if dims else None,
            sha256=sha256,
            mime_type=upload.content_type,
            tags=[],
            character_name=None,
            tagging_status="pending",
            thumbnail_path=str(thumb) if thumb else None,
            thumbnail_status="done" if thumb else "failed",
            captured_at=captured_at,
        )
        db.add(image)
        await db.flush()
        if queue:
            await queue.put(image.id)
        results.append(UploadResult(id=image.id, original_filename=original_name, status="accepted"))
        accepted += 1

    await db.commit()
    return BatchUploadResponse(accepted=accepted, duplicates=duplicates, errors=errors, results=results)


async def get_downloadable_images(db: AsyncSession, user: User, image_ids: list[uuid.UUID]) -> list[Image]:
    rows = (
        await db.execute(
            select(Image).where(
                Image.id.in_(image_ids),
                Image.deleted_at.is_(None),
                Image.uploader_id == user.id if not user.is_admin else True,
            )
        )
    ).scalars().all()
    if not user.is_admin:
        rows = [row for row in rows if row.uploader_id == user.id]
    if not rows:
        raise HTTPException(status_code=404, detail="No accessible images found")
    return rows


async def get_visible_image(db: AsyncSession, image_id: uuid.UUID, user: User) -> Image:
    image = (await db.execute(select(Image).where(Image.id == image_id, Image.deleted_at.is_(None)))).scalar_one_or_none()
    if image is None:
        raise HTTPException(status_code=404, detail="Not found")
    if image.is_nsfw and not user.show_nsfw and not user.is_admin:
        raise HTTPException(status_code=403, detail="NSFW content hidden")
    return image


async def get_image_detail(db: AsyncSession, image_id: uuid.UUID, user: User) -> ImageDetail:
    image = await _get_image_with_tags(db, image_id, deleted=False)
    if image is None:
        raise HTTPException(status_code=404, detail="Not found")
    if image.is_nsfw and not user.show_nsfw and not user.is_admin:
        raise HTTPException(status_code=403, detail="NSFW content hidden")
    return await build_image_detail(db, image, user.id)


async def update_image_metadata(
    db: AsyncSession,
    image_id: uuid.UUID,
    user: User,
    payload: ImageUpdate,
) -> ImageDetail:
    metadata_fields = payload.metadata.model_fields_set if payload.metadata is not None else set()
    needs_owner_access = any(field in payload.model_fields_set for field in {"tags", "character_name", "metadata", "deleted"})
    if needs_owner_access:
        image = await get_owned_or_admin_image(db, image_id, user, trashed=None)
    else:
        image = await get_active_image(db, image_id)

    if "tags" in payload.model_fields_set and payload.tags is not None:
        normalized_tags = _normalize_manual_tags(payload.tags)
        existing_image_tags = (
            await db.execute(
                select(ImageTag)
                .options(selectinload(ImageTag.tag))
                .where(ImageTag.image_id == image_id)
            )
        ).scalars().all()
        existing_by_name = {item.tag.name: item for item in existing_image_tags}

        for name, image_tag in existing_by_name.items():
            if name not in normalized_tags:
                image_tag.tag.image_count = max(0, image_tag.tag.image_count - 1)
                await db.delete(image_tag)

        new_tag_names = [name for name in normalized_tags if name not in existing_by_name]
        existing_tags = {}
        if new_tag_names:
            existing_tags = {
                tag.name: tag
                for tag in (
                    await db.execute(select(Tag).where(Tag.name.in_(new_tag_names)))
                ).scalars().all()
            }

        for name in new_tag_names:
            tag = existing_tags.get(name)
            if tag is None:
                tag = Tag(name=name, category=0, image_count=0)
                db.add(tag)
                await db.flush()
            tag.image_count += 1
            db.add(ImageTag(image_id=image_id, tag_id=tag.id, confidence=1.0))

        image.tags = normalized_tags
        image.is_nsfw = any(tag in NSFW_RATING_TAGS for tag in normalized_tags)

    if "character_name" in payload.model_fields_set:
        image.character_name = payload.character_name.strip() if payload.character_name and payload.character_name.strip() else None

    if "metadata" in payload.model_fields_set and "captured_at" in metadata_fields:
        image.captured_at = payload.metadata.captured_at or image.created_at

    if "deleted" in payload.model_fields_set:
        image.deleted_at = datetime.now(timezone.utc) if payload.deleted else None

    if "favorited" in payload.model_fields_set:
        await set_favorite_state(db, image.id, user, payload.favorited)

    await db.commit()
    image = await _get_image_with_tags(db, image_id, deleted=None)
    return await build_image_detail(db, image, user.id)


async def soft_delete_image(db: AsyncSession, image_id: uuid.UUID, user: User) -> None:
    image = await get_owned_or_admin_image(db, image_id, user, trashed=False)
    image.deleted_at = datetime.now(timezone.utc)
    await db.commit()


async def restore_image(db: AsyncSession, image_id: uuid.UUID, user: User) -> None:
    image = await get_owned_or_admin_image(db, image_id, user, trashed=True)
    image.deleted_at = None
    await db.commit()


async def purge_image(db: AsyncSession, image_id: uuid.UUID, user: User) -> None:
    image = await get_owned_or_admin_image(db, image_id, user, trashed=None)
    await purge_image_record(image, db)
    await db.commit()


async def favorite_image(db: AsyncSession, image_id: uuid.UUID, user: User) -> None:
    await set_favorite_state(db, image_id, user, True)
    await db.commit()


async def unfavorite_image(db: AsyncSession, image_id: uuid.UUID, user: User) -> None:
    favorite = await get_favorite(db, image_id, user.id)
    if favorite is None:
        raise HTTPException(status_code=404, detail="Not in favorites")
    await db.delete(favorite)
    await db.commit()


async def retag_image(db: AsyncSession, image_id: uuid.UUID, user: User) -> int:
    image = await get_owned_or_admin_image(db, image_id, user, trashed=False)
    image.tagging_status = "pending"
    await db.commit()
    queue = get_tag_queue()
    if queue:
        await queue.put(image_id)
    return 1


async def batch_update_images(
    db: AsyncSession,
    payload: ImageBatchUpdate,
    user: User,
) -> BulkResult:
    processed = skipped = 0

    if payload.deleted is not None:
        processed, skipped = await _batch_update_deleted_state(db, payload.image_ids, payload.deleted, user)
    elif payload.favorited is not None:
        processed, skipped = await _batch_update_favorite_state(db, payload.image_ids, payload.favorited, user)

    return BulkResult(processed=processed, skipped=skipped)


async def batch_purge_images(
    db: AsyncSession,
    payload: ImageBatchDelete,
    user: User,
) -> BulkResult:
    rows = (await db.execute(select(Image).where(Image.id.in_(payload.image_ids)))).scalars().all()

    found_ids = {row.id for row in rows}
    skipped = len(payload.image_ids) - len(found_ids)
    processed = 0

    for image in rows:
        if image.uploader_id == user.id or user.is_admin:
            await purge_image_record(image, db)
            processed += 1
        else:
            skipped += 1

    await db.commit()
    return BulkResult(processed=processed, skipped=skipped)


async def get_owned_or_admin_image(
    db: AsyncSession,
    image_id: uuid.UUID,
    user: User,
    trashed: bool | None,
) -> Image:
    stmt = select(Image).where(Image.id == image_id)
    if trashed is True:
        stmt = stmt.where(Image.deleted_at.is_not(None))
    elif trashed is False:
        stmt = stmt.where(Image.deleted_at.is_(None))

    image = (await db.execute(stmt)).scalar_one_or_none()
    if image is None:
        detail = "Not found in trash" if trashed is True else "Not found"
        raise HTTPException(status_code=404, detail=detail)
    if image.uploader_id != user.id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Forbidden")
    return image


async def get_active_image(db: AsyncSession, image_id: uuid.UUID) -> Image:
    image = (await db.execute(select(Image).where(Image.id == image_id, Image.deleted_at.is_(None)))).scalar_one_or_none()
    if image is None:
        raise HTTPException(status_code=404, detail="Not found")
    return image


async def get_favorite(db: AsyncSession, image_id: uuid.UUID, user_id: uuid.UUID) -> UserFavorite | None:
    return (
        await db.execute(select(UserFavorite).where(UserFavorite.user_id == user_id, UserFavorite.image_id == image_id))
    ).scalar_one_or_none()


async def set_favorite_state(db: AsyncSession, image_id: uuid.UUID, user: User, favorited: bool | None) -> bool:
    await get_active_image(db, image_id)
    existing = await get_favorite(db, image_id, user.id)
    if favorited is True and existing is None:
        db.add(UserFavorite(user_id=user.id, image_id=image_id))
        return True
    if favorited is False and existing is not None:
        await db.delete(existing)
        return True
    return False


async def _get_image_with_tags(db: AsyncSession, image_id: uuid.UUID, deleted: bool | None) -> Image | None:
    stmt = select(Image).options(selectinload(Image.image_tags).selectinload(ImageTag.tag)).where(Image.id == image_id)
    if deleted is True:
        stmt = stmt.where(Image.deleted_at.is_not(None))
    elif deleted is False:
        stmt = stmt.where(Image.deleted_at.is_(None))
    return (await db.execute(stmt)).scalar_one_or_none()


async def build_image_detail(db: AsyncSession, image: Image, user_id: uuid.UUID) -> ImageDetail:
    is_favorited = await get_favorite(db, image.id, user_id) is not None
    tag_details = [
        TagWithConfidence(
            name=item.tag.name,
            category=item.tag.category,
            category_name=CATEGORY_NAMES.get(item.tag.category, "unknown"),
            confidence=item.confidence,
        )
        for item in sorted(image.image_tags, key=lambda item: item.confidence, reverse=True)
    ]
    base = _build_image_read(image, is_favorited)
    return ImageDetail(**base.model_dump(), tag_details=tag_details)


async def _batch_update_deleted_state(
    db: AsyncSession,
    image_ids: list[uuid.UUID],
    deleted: bool,
    user: User,
) -> tuple[int, int]:
    rows = (await db.execute(select(Image).where(Image.id.in_(image_ids)))).scalars().all()
    found_ids = {row.id for row in rows}
    skipped = len(image_ids) - len(found_ids)
    processed = 0
    now = datetime.now(timezone.utc)

    for image in rows:
        if image.uploader_id != user.id and not user.is_admin:
            skipped += 1
            continue
        if deleted and image.deleted_at is None:
            image.deleted_at = now
            processed += 1
        elif not deleted and image.deleted_at is not None:
            image.deleted_at = None
            processed += 1
        else:
            skipped += 1

    await db.commit()
    return processed, skipped


async def _batch_update_favorite_state(
    db: AsyncSession,
    image_ids: list[uuid.UUID],
    favorited: bool,
    user: User,
) -> tuple[int, int]:
    active_ids = set(
        (await db.execute(select(Image.id).where(Image.id.in_(image_ids), Image.deleted_at.is_(None)))).scalars().all()
    )
    existing_ids = set(
        (
            await db.execute(
                select(UserFavorite.image_id).where(
                    UserFavorite.user_id == user.id,
                    UserFavorite.image_id.in_(image_ids),
                )
            )
        ).scalars().all()
    )

    if favorited:
        to_change = active_ids - existing_ids
        for image_id in to_change:
            db.add(UserFavorite(user_id=user.id, image_id=image_id))
    else:
        to_change = existing_ids
        favorites = (
            await db.execute(
                select(UserFavorite).where(
                    UserFavorite.user_id == user.id,
                    UserFavorite.image_id.in_(image_ids),
                )
            )
        ).scalars().all()
        for favorite in favorites:
            await db.delete(favorite)

    await db.commit()
    return len(to_change), len(image_ids) - len(to_change)


async def purge_image_record(image: Image, db: AsyncSession) -> None:
    tag_ids = (await db.execute(select(ImageTag.tag_id).where(ImageTag.image_id == image.id))).scalars().all()
    await db.delete(image)
    await db.flush()
    if tag_ids:
        for tag in (await db.execute(select(Tag).where(Tag.id.in_(tag_ids)))).scalars().all():
            tag.image_count = max(0, tag.image_count - 1)
    delete_file(image.filepath)
