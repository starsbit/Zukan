import asyncio
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import and_, extract, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.deps import current_user
from app.models import Image, ImageTag, Tag, User, UserFavorite
from app.schemas import (
    BatchUploadResponse,
    DownloadRequest,
    ImageDetail,
    ImageListResponse,
    ImageRead,
    NsfwFilter,
    OnThisDayResponse,
    OnThisDayYear,
    TagFilterMode,
    TagWithConfidence,
    UploadResult,
    CATEGORY_NAMES,
)
from app.services.storage import delete_file, generate_thumbnail, get_image_dimensions, save_upload, zip_images

router = APIRouter(prefix="/images", tags=["images"])

_tag_queue: asyncio.Queue = None


def set_tag_queue(q: asyncio.Queue):
    global _tag_queue
    _tag_queue = q


def get_tag_queue() -> asyncio.Queue | None:
    return _tag_queue


async def _favorited_ids(db: AsyncSession, user_id: uuid.UUID, image_ids: list[uuid.UUID]) -> set[uuid.UUID]:
    if not image_ids:
        return set()
    result = await db.execute(
        select(UserFavorite.image_id).where(
            UserFavorite.user_id == user_id,
            UserFavorite.image_id.in_(image_ids),
        )
    )
    return set(result.scalars().all())


def _enrich(rows: list[Image], favorited: set[uuid.UUID]) -> list[ImageRead]:
    return [ImageRead.model_validate(r).model_copy(update={"is_favorited": r.id in favorited}) for r in rows]


@router.post("/upload", response_model=BatchUploadResponse, status_code=status.HTTP_202_ACCEPTED)
async def upload(
    files: list[UploadFile],
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.config import settings

    if len(files) > settings.max_batch_size:
        raise HTTPException(status_code=400, detail=f"Max {settings.max_batch_size} files per request")

    results: list[UploadResult] = []
    accepted = duplicates = errors = 0

    for upload in files:
        original_name = upload.filename or "unknown"

        saved = await save_upload(upload)
        if saved is None:
            results.append(UploadResult(id=None, original_filename=original_name, status="error", message="Unsupported type or file too large"))
            errors += 1
            continue

        path, sha256, file_size = saved

        existing_result = await db.execute(select(Image).where(Image.sha256 == sha256))
        existing = existing_result.scalar_one_or_none()
        if existing is not None:
            if existing.deleted_at is None:
                delete_file(str(path))
                results.append(UploadResult(id=None, original_filename=original_name, status="duplicate", message="Image already exists"))
                duplicates += 1
                continue
            # Restore soft-deleted record instead of inserting a duplicate
            delete_file(str(path))
            existing.deleted_at = None
            existing.original_filename = original_name
            existing.tagging_status = "pending"
            await db.flush()
            await _tag_queue.put(existing.id)
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
        await _tag_queue.put(image.id)
        results.append(UploadResult(id=image.id, original_filename=original_name, status="accepted"))
        accepted += 1

    await db.commit()
    return BatchUploadResponse(accepted=accepted, duplicates=duplicates, errors=errors, results=results)


@router.get("/trash", response_model=ImageListResponse)
async def list_trash(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Image).where(Image.deleted_at.is_not(None))
    if not user.is_admin:
        stmt = stmt.where(Image.uploader_id == user.id)

    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (await db.execute(stmt.order_by(Image.deleted_at.desc()).offset((page - 1) * page_size).limit(page_size))).scalars().all()
    favs = await _favorited_ids(db, user.id, [r.id for r in rows])
    return ImageListResponse(total=total, page=page, page_size=page_size, items=_enrich(rows, favs))


@router.post("/trash/empty", status_code=status.HTTP_204_NO_CONTENT)
async def empty_trash(
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Image).where(Image.deleted_at.is_not(None))
    if not user.is_admin:
        stmt = stmt.where(Image.uploader_id == user.id)
    for image in (await db.execute(stmt)).scalars().all():
        await _purge_image(image, db)
    await db.commit()


@router.get("/favorites", response_model=ImageListResponse)
async def list_favorites(
    tags: Annotated[str | None, Query(description="Comma-separated tags")] = None,
    exclude_tags: Annotated[str | None, Query()] = None,
    mode: TagFilterMode = TagFilterMode.AND,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(Image)
        .join(UserFavorite, and_(UserFavorite.image_id == Image.id, UserFavorite.user_id == user.id))
        .where(Image.deleted_at.is_(None))
    )
    if not user.show_nsfw:
        stmt = stmt.where(Image.is_nsfw == False)

    if tags:
        tag_list = [t.strip() for t in tags.split(",") if t.strip()]
        if tag_list:
            stmt = stmt.where(Image.tags.contains(tag_list) if mode == TagFilterMode.AND else Image.tags.overlap(tag_list))
    if exclude_tags:
        excl = [t.strip() for t in exclude_tags.split(",") if t.strip()]
        if excl:
            stmt = stmt.where(~Image.tags.contains(excl))

    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (await db.execute(stmt.order_by(Image.created_at.desc()).offset((page - 1) * page_size).limit(page_size))).scalars().all()
    return ImageListResponse(
        total=total,
        page=page,
        page_size=page_size,
        items=[ImageRead.model_validate(r).model_copy(update={"is_favorited": True}) for r in rows],
    )


@router.get("/on-this-day", response_model=OnThisDayResponse)
async def on_this_day(
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
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
    favs = await _favorited_ids(db, user.id, [r.id for r in rows])
    enriched = _enrich(rows, favs)

    by_year: dict[int, list[ImageRead]] = defaultdict(list)
    for row, item in zip(rows, enriched):
        by_year[row.created_at.year].append(item)

    return OnThisDayResponse(
        years=[OnThisDayYear(year=y, images=imgs) for y, imgs in sorted(by_year.items(), reverse=True)]
    )


@router.post("/download")
async def download_images(
    body: DownloadRequest,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(Image).where(
            Image.id.in_(body.image_ids),
            Image.deleted_at.is_(None),
            Image.uploader_id == user.id if not user.is_admin else True,
        )
    )).scalars().all()

    if not user.is_admin:
        rows = [r for r in rows if r.uploader_id == user.id]

    if not rows:
        raise HTTPException(status_code=404, detail="No accessible images found")

    buf = zip_images(rows)
    return StreamingResponse(
        content=iter([buf.read()]),
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=images.zip"},
    )


@router.get("", response_model=ImageListResponse)
async def list_images(
    tags: Annotated[str | None, Query(description="Comma-separated tags")] = None,
    exclude_tags: Annotated[str | None, Query()] = None,
    mode: TagFilterMode = TagFilterMode.AND,
    nsfw: NsfwFilter = NsfwFilter.DEFAULT,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    favorited: bool | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Image).where(Image.deleted_at.is_(None))

    if nsfw == NsfwFilter.DEFAULT:
        if not user.show_nsfw:
            stmt = stmt.where(Image.is_nsfw == False)
    elif nsfw == NsfwFilter.ONLY:
        if not user.show_nsfw and not user.is_admin:
            raise HTTPException(status_code=403, detail="Enable NSFW in your profile first")
        stmt = stmt.where(Image.is_nsfw == True)

    if status_filter and status_filter != "any":
        stmt = stmt.where(Image.tagging_status == status_filter)

    if favorited is True:
        stmt = stmt.join(UserFavorite, and_(UserFavorite.image_id == Image.id, UserFavorite.user_id == user.id))

    if tags:
        tag_list = [t.strip() for t in tags.split(",") if t.strip()]
        if tag_list:
            stmt = stmt.where(Image.tags.contains(tag_list) if mode == TagFilterMode.AND else Image.tags.overlap(tag_list))

    if exclude_tags:
        excl_list = [t.strip() for t in exclude_tags.split(",") if t.strip()]
        if excl_list:
            stmt = stmt.where(~Image.tags.contains(excl_list))

    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (await db.execute(stmt.order_by(Image.created_at.desc()).offset((page - 1) * page_size).limit(page_size))).scalars().all()
    favs = await _favorited_ids(db, user.id, [r.id for r in rows])
    return ImageListResponse(total=total, page=page, page_size=page_size, items=_enrich(rows, favs))


@router.get("/{image_id}", response_model=ImageDetail)
async def get_image(
    image_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Image)
        .options(selectinload(Image.image_tags).selectinload(ImageTag.tag))
        .where(Image.id == image_id, Image.deleted_at.is_(None))
    )
    image = result.scalar_one_or_none()
    if image is None:
        raise HTTPException(status_code=404, detail="Not found")
    if image.is_nsfw and not user.show_nsfw and not user.is_admin:
        raise HTTPException(status_code=403, detail="NSFW content hidden")

    fav = await db.execute(select(UserFavorite).where(UserFavorite.user_id == user.id, UserFavorite.image_id == image_id))
    is_favorited = fav.scalar_one_or_none() is not None

    tag_details = [
        TagWithConfidence(
            name=it.tag.name,
            category=it.tag.category,
            category_name=CATEGORY_NAMES.get(it.tag.category, "unknown"),
            confidence=it.confidence,
        )
        for it in sorted(image.image_tags, key=lambda x: x.confidence, reverse=True)
    ]
    base = ImageRead.model_validate(image).model_copy(update={"is_favorited": is_favorited})
    return ImageDetail(**base.model_dump(), tag_details=tag_details)


@router.get("/{image_id}/file")
async def get_image_file(
    image_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Image).where(Image.id == image_id, Image.deleted_at.is_(None)))
    image = result.scalar_one_or_none()
    if image is None:
        raise HTTPException(status_code=404, detail="Not found")
    if image.is_nsfw and not user.show_nsfw and not user.is_admin:
        raise HTTPException(status_code=403, detail="NSFW content hidden")
    return FileResponse(image.filepath, media_type=image.mime_type)


@router.get("/{image_id}/thumbnail")
async def get_image_thumbnail(
    image_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Image).where(Image.id == image_id, Image.deleted_at.is_(None)))
    image = result.scalar_one_or_none()
    if image is None:
        raise HTTPException(status_code=404, detail="Not found")
    if image.is_nsfw and not user.show_nsfw and not user.is_admin:
        raise HTTPException(status_code=403, detail="NSFW content hidden")
    if not image.thumbnail_path:
        raise HTTPException(status_code=404, detail="Thumbnail not available")
    return FileResponse(image.thumbnail_path, media_type="image/webp")


@router.delete("/{image_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_image(
    image_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Image).where(Image.id == image_id, Image.deleted_at.is_(None)))
    image = result.scalar_one_or_none()
    if image is None:
        raise HTTPException(status_code=404, detail="Not found")
    if image.uploader_id != user.id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Forbidden")
    image.deleted_at = datetime.now(timezone.utc)
    await db.commit()


@router.post("/{image_id}/restore", status_code=status.HTTP_204_NO_CONTENT)
async def restore_image(
    image_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Image).where(Image.id == image_id, Image.deleted_at.is_not(None)))
    image = result.scalar_one_or_none()
    if image is None:
        raise HTTPException(status_code=404, detail="Not found in trash")
    if image.uploader_id != user.id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Forbidden")
    image.deleted_at = None
    await db.commit()


@router.delete("/{image_id}/purge", status_code=status.HTTP_204_NO_CONTENT)
async def purge_image(
    image_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Image).where(Image.id == image_id))
    image = result.scalar_one_or_none()
    if image is None:
        raise HTTPException(status_code=404, detail="Not found")
    if image.uploader_id != user.id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Forbidden")
    await _purge_image(image, db)
    await db.commit()


@router.post("/{image_id}/favorite", status_code=status.HTTP_204_NO_CONTENT)
async def favorite_image(
    image_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Image).where(Image.id == image_id, Image.deleted_at.is_(None)))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Not found")

    existing = await db.execute(select(UserFavorite).where(UserFavorite.user_id == user.id, UserFavorite.image_id == image_id))
    if existing.scalar_one_or_none() is None:
        db.add(UserFavorite(user_id=user.id, image_id=image_id))
        await db.commit()


@router.delete("/{image_id}/favorite", status_code=status.HTTP_204_NO_CONTENT)
async def unfavorite_image(
    image_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(UserFavorite).where(UserFavorite.user_id == user.id, UserFavorite.image_id == image_id))
    fav = result.scalar_one_or_none()
    if fav is None:
        raise HTTPException(status_code=404, detail="Not in favorites")
    await db.delete(fav)
    await db.commit()


@router.post("/{image_id}/retag", status_code=status.HTTP_202_ACCEPTED)
async def retag_image(
    image_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Image).where(Image.id == image_id, Image.deleted_at.is_(None)))
    image = result.scalar_one_or_none()
    if image is None:
        raise HTTPException(status_code=404, detail="Not found")
    if image.uploader_id != user.id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Forbidden")
    image.tagging_status = "pending"
    await db.commit()
    await _tag_queue.put(image_id)
    return {"message": "Re-queued for tagging"}


async def _purge_image(image: Image, db: AsyncSession):
    tag_ids = (await db.execute(select(ImageTag.tag_id).where(ImageTag.image_id == image.id))).scalars().all()
    await db.delete(image)
    await db.flush()
    if tag_ids:
        for tag in (await db.execute(select(Tag).where(Tag.id.in_(tag_ids)))).scalars().all():
            tag.image_count = max(0, tag.image_count - 1)
    delete_file(image.filepath)
