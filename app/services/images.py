import asyncio
import uuid
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import HTTPException, UploadFile
from sqlalchemy import and_, extract, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.models import Image, ImageTag, Tag, User, UserFavorite
from app.schemas import (
    BatchUploadResponse,
    CATEGORY_NAMES,
    ImageDetail,
    ImageListResponse,
    ImageRead,
    NsfwFilter,
    OnThisDayResponse,
    OnThisDayYear,
    TagFilterMode,
    TagWithConfidence,
    UploadResult,
)
from app.services.storage import delete_file, generate_thumbnail, get_image_dimensions, save_upload

_tag_queue: asyncio.Queue | None = None


def set_tag_queue(queue: asyncio.Queue) -> None:
    global _tag_queue
    _tag_queue = queue


def get_tag_queue() -> asyncio.Queue | None:
    return _tag_queue


def enrich_images(rows: list[Image], favorited: set[uuid.UUID]) -> list[ImageRead]:
    return [ImageRead.model_validate(row).model_copy(update={"is_favorited": row.id in favorited}) for row in rows]


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


async def list_images(
    db: AsyncSession,
    user: User,
    tags: str | None,
    exclude_tags: str | None,
    mode: TagFilterMode,
    nsfw: NsfwFilter,
    status_filter: str | None,
    favorited: bool | None,
    page: int,
    page_size: int,
) -> ImageListResponse:
    stmt = select(Image).where(Image.deleted_at.is_(None))
    stmt = _apply_nsfw_list_filter(stmt, user, nsfw)

    if status_filter and status_filter != "any":
        stmt = stmt.where(Image.tagging_status == status_filter)

    if favorited is True:
        stmt = stmt.join(UserFavorite, and_(UserFavorite.image_id == Image.id, UserFavorite.user_id == user.id))

    stmt = _apply_tag_filters(stmt, tags, exclude_tags, mode)

    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (
        await db.execute(stmt.order_by(Image.created_at.desc()).offset((page - 1) * page_size).limit(page_size))
    ).scalars().all()
    favs = await favorited_ids(db, user.id, [row.id for row in rows])
    return ImageListResponse(total=total, page=page, page_size=page_size, items=enrich_images(rows, favs))


async def list_trash(db: AsyncSession, user: User, page: int, page_size: int) -> ImageListResponse:
    stmt = select(Image).where(Image.deleted_at.is_not(None))
    if not user.is_admin:
        stmt = stmt.where(Image.uploader_id == user.id)

    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (
        await db.execute(stmt.order_by(Image.deleted_at.desc()).offset((page - 1) * page_size).limit(page_size))
    ).scalars().all()
    favs = await favorited_ids(db, user.id, [row.id for row in rows])
    return ImageListResponse(total=total, page=page, page_size=page_size, items=enrich_images(rows, favs))


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
        await db.execute(stmt.order_by(Image.created_at.desc()).offset((page - 1) * page_size).limit(page_size))
    ).scalars().all()
    return ImageListResponse(
        total=total,
        page=page,
        page_size=page_size,
        items=[ImageRead.model_validate(row).model_copy(update={"is_favorited": True}) for row in rows],
    )


async def on_this_day(db: AsyncSession, user: User) -> OnThisDayResponse:
    now = datetime.now(timezone.utc)
    stmt = select(Image).where(
        extract("month", Image.created_at) == now.month,
        extract("day", Image.created_at) == now.day,
        extract("year", Image.created_at) < now.year,
        Image.deleted_at.is_(None),
    )
    if not user.show_nsfw:
        stmt = stmt.where(Image.is_nsfw == False)

    rows = (await db.execute(stmt.order_by(Image.created_at.desc()))).scalars().all()
    favs = await favorited_ids(db, user.id, [row.id for row in rows])
    enriched = enrich_images(rows, favs)

    by_year: dict[int, list[ImageRead]] = defaultdict(list)
    for row, item in zip(rows, enriched):
        by_year[row.created_at.year].append(item)

    return OnThisDayResponse(years=[OnThisDayYear(year=year, images=items) for year, items in sorted(by_year.items(), reverse=True)])


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
            tagging_status="pending",
            thumbnail_path=str(thumb) if thumb else None,
            thumbnail_status="done" if thumb else "failed",
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
    image = (
        await db.execute(
            select(Image)
            .options(selectinload(Image.image_tags).selectinload(ImageTag.tag))
            .where(Image.id == image_id, Image.deleted_at.is_(None))
        )
    ).scalar_one_or_none()
    if image is None:
        raise HTTPException(status_code=404, detail="Not found")
    if image.is_nsfw and not user.show_nsfw and not user.is_admin:
        raise HTTPException(status_code=403, detail="NSFW content hidden")

    is_favorited = (
        await db.execute(select(UserFavorite).where(UserFavorite.user_id == user.id, UserFavorite.image_id == image_id))
    ).scalar_one_or_none() is not None

    tag_details = [
        TagWithConfidence(
            name=item.tag.name,
            category=item.tag.category,
            category_name=CATEGORY_NAMES.get(item.tag.category, "unknown"),
            confidence=item.confidence,
        )
        for item in sorted(image.image_tags, key=lambda item: item.confidence, reverse=True)
    ]
    base = ImageRead.model_validate(image).model_copy(update={"is_favorited": is_favorited})
    return ImageDetail(**base.model_dump(), tag_details=tag_details)


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
    if (await db.execute(select(Image).where(Image.id == image_id, Image.deleted_at.is_(None)))).scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Not found")

    existing = (
        await db.execute(select(UserFavorite).where(UserFavorite.user_id == user.id, UserFavorite.image_id == image_id))
    ).scalar_one_or_none()
    if existing is None:
        db.add(UserFavorite(user_id=user.id, image_id=image_id))
        await db.commit()


async def unfavorite_image(db: AsyncSession, image_id: uuid.UUID, user: User) -> None:
    favorite = (
        await db.execute(select(UserFavorite).where(UserFavorite.user_id == user.id, UserFavorite.image_id == image_id))
    ).scalar_one_or_none()
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


async def purge_image_record(image: Image, db: AsyncSession) -> None:
    tag_ids = (await db.execute(select(ImageTag.tag_id).where(ImageTag.image_id == image.id))).scalars().all()
    await db.delete(image)
    await db.flush()
    if tag_ids:
        for tag in (await db.execute(select(Tag).where(Tag.id.in_(tag_ids)))).scalars().all():
            tag.image_count = max(0, tag.image_count - 1)
    delete_file(image.filepath)
