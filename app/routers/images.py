import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import current_user
from app.models import User
from app.schemas import (
    BatchUploadResponse,
    DownloadRequest,
    ImageDetail,
    ImageListResponse,
    NsfwFilter,
    OnThisDayResponse,
    TagFilterMode,
)
from app.services import images as image_service
from app.services.storage import zip_images

router = APIRouter(prefix="/images", tags=["images"])


@router.post("/upload", response_model=BatchUploadResponse, status_code=status.HTTP_202_ACCEPTED)
async def upload(
    files: list[UploadFile],
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await image_service.build_upload_response(db, user, files)


@router.get("/trash", response_model=ImageListResponse)
async def list_trash(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await image_service.list_trash(db, user, page, page_size)


@router.post("/trash/empty", status_code=status.HTTP_204_NO_CONTENT)
async def empty_trash(
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    await image_service.empty_trash(db, user)


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
    return await image_service.list_favorites(db, user, tags, exclude_tags, mode, page, page_size)


@router.get("/on-this-day", response_model=OnThisDayResponse)
async def on_this_day(
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await image_service.on_this_day(db, user)


@router.post("/download")
async def download_images(
    body: DownloadRequest,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await image_service.get_downloadable_images(db, user, body.image_ids)
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
    return await image_service.list_images(
        db,
        user,
        tags,
        exclude_tags,
        mode,
        nsfw,
        status_filter,
        favorited,
        page,
        page_size,
    )


@router.get("/{image_id}", response_model=ImageDetail)
async def get_image(
    image_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await image_service.get_image_detail(db, image_id, user)


@router.get("/{image_id}/file")
async def get_image_file(
    image_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    image = await image_service.get_visible_image(db, image_id, user)
    return FileResponse(image.filepath, media_type=image.mime_type)


@router.get("/{image_id}/thumbnail")
async def get_image_thumbnail(
    image_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    image = await image_service.get_visible_image(db, image_id, user)
    if not image.thumbnail_path:
        raise HTTPException(status_code=404, detail="Thumbnail not available")
    return FileResponse(image.thumbnail_path, media_type="image/webp")


@router.delete("/{image_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_image(
    image_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    await image_service.soft_delete_image(db, image_id, user)


@router.post("/{image_id}/restore", status_code=status.HTTP_204_NO_CONTENT)
async def restore_image(
    image_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    await image_service.restore_image(db, image_id, user)


@router.delete("/{image_id}/purge", status_code=status.HTTP_204_NO_CONTENT)
async def purge_image(
    image_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    await image_service.purge_image(db, image_id, user)


@router.post("/{image_id}/favorite", status_code=status.HTTP_204_NO_CONTENT)
async def favorite_image(
    image_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    await image_service.favorite_image(db, image_id, user)


@router.delete("/{image_id}/favorite", status_code=status.HTTP_204_NO_CONTENT)
async def unfavorite_image(
    image_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    await image_service.unfavorite_image(db, image_id, user)


@router.post("/{image_id}/retag", status_code=status.HTTP_202_ACCEPTED)
async def retag_image(
    image_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    await image_service.retag_image(db, image_id, user)
    return {"message": "Re-queued for tagging"}
