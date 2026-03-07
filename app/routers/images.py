import asyncio
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.deps import current_user
from app.models import Image, ImageTag, Tag, User
from app.schemas import (
    BatchUploadResponse,
    ImageDetail,
    ImageListResponse,
    ImageRead,
    NsfwFilter,
    TagFilterMode,
    TagWithConfidence,
    UploadResult,
    CATEGORY_NAMES,
)
from app.services.storage import delete_file, generate_thumbnail, get_image_dimensions, save_upload

router = APIRouter(prefix="/images", tags=["images"])

_tag_queue: asyncio.Queue = None


def set_tag_queue(q: asyncio.Queue):
    global _tag_queue
    _tag_queue = q


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

        existing = await db.execute(select(Image).where(Image.sha256 == sha256))
        if existing.scalar_one_or_none():
            delete_file(str(path))
            results.append(UploadResult(id=None, original_filename=original_name, status="duplicate", message="Image already exists"))
            duplicates += 1
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

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = (await db.execute(count_stmt)).scalar_one()

    stmt = stmt.order_by(Image.deleted_at.desc()).offset((page - 1) * page_size).limit(page_size)
    rows = (await db.execute(stmt)).scalars().all()

    return ImageListResponse(total=total, page=page, page_size=page_size, items=rows)


@router.post("/trash/empty", status_code=status.HTTP_204_NO_CONTENT)
async def empty_trash(
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Image).where(Image.deleted_at.is_not(None))
    if not user.is_admin:
        stmt = stmt.where(Image.uploader_id == user.id)

    rows = (await db.execute(stmt)).scalars().all()
    for image in rows:
        await _purge_image(image, db)

    await db.commit()


@router.get("", response_model=ImageListResponse)
async def list_images(
    tags: Annotated[str | None, Query(description="Comma-separated tags")] = None,
    exclude_tags: Annotated[str | None, Query()] = None,
    mode: TagFilterMode = TagFilterMode.AND,
    nsfw: NsfwFilter = NsfwFilter.DEFAULT,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
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

    if tags:
        tag_list = [t.strip() for t in tags.split(",") if t.strip()]
        if tag_list:
            if mode == TagFilterMode.AND:
                stmt = stmt.where(Image.tags.contains(tag_list))
            else:
                stmt = stmt.where(Image.tags.overlap(tag_list))

    if exclude_tags:
        excl_list = [t.strip() for t in exclude_tags.split(",") if t.strip()]
        if excl_list:
            stmt = stmt.where(~Image.tags.contains(excl_list))

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = (await db.execute(count_stmt)).scalar_one()

    stmt = stmt.order_by(Image.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    rows = (await db.execute(stmt)).scalars().all()

    return ImageListResponse(total=total, page=page, page_size=page_size, items=rows)


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

    tag_details = [
        TagWithConfidence(
            name=it.tag.name,
            category=it.tag.category,
            category_name=CATEGORY_NAMES.get(it.tag.category, "unknown"),
            confidence=it.confidence,
        )
        for it in sorted(image.image_tags, key=lambda x: x.confidence, reverse=True)
    ]
    return ImageDetail(**ImageRead.model_validate(image).model_dump(), tag_details=tag_details)


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
    tag_ids_result = await db.execute(
        select(ImageTag.tag_id).where(ImageTag.image_id == image.id)
    )
    tag_ids = tag_ids_result.scalars().all()

    await db.delete(image)
    await db.flush()

    if tag_ids:
        tags_result = await db.execute(select(Tag).where(Tag.id.in_(tag_ids)))
        for tag in tags_result.scalars().all():
            tag.image_count = max(0, tag.image_count - 1)

    delete_file(image.filepath)
