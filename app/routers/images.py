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
    ImageMetadataUpdate,
    NsfwFilter,
    OnThisDayResponse,
    TagFilterMode,
)
from app.services import images as image_service
from app.services.storage import zip_images

router = APIRouter(prefix="/images", tags=["images"])


@router.post(
    "/upload",
    response_model=BatchUploadResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Upload Images",
    response_description="Upload result for each submitted file.",
)
async def upload(
    files: list[UploadFile],
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await image_service.build_upload_response(db, user, files)


@router.get(
    "/trash",
    response_model=ImageListResponse,
    summary="List Trashed Images",
    response_description="Paginated list of images currently in the trash.",
)
async def list_trash(
    page: int = Query(default=1, ge=1, description="1-based page number."),
    page_size: int = Query(default=20, ge=1, le=200, description="Maximum number of images to return."),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await image_service.list_trash(db, user, page, page_size)


@router.post("/trash/empty", status_code=status.HTTP_204_NO_CONTENT, summary="Empty Trash")
async def empty_trash(
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    await image_service.empty_trash(db, user)


@router.get(
    "/on-this-day",
    response_model=OnThisDayResponse,
    summary="List On-This-Day Images",
    response_description="Images captured on the same month and day in previous years.",
)
async def on_this_day(
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await image_service.on_this_day(db, user)


@router.post("/download", summary="Download Images", response_description="ZIP archive of the requested images.")
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


@router.get(
    "",
    response_model=ImageListResponse,
    summary="List Images",
    response_description="Paginated list of images matching the provided filters.",
)
async def list_images(
    tags: Annotated[str | None, Query(description="Comma-separated tags to include in the search.")] = None,
    character_name: Annotated[
        str | None,
        Query(description="Case-insensitive partial match against the image's derived character name."),
    ] = None,
    exclude_tags: Annotated[str | None, Query(description="Comma-separated tags that must not be present.")] = None,
    mode: TagFilterMode = Query(default=TagFilterMode.AND, description="How to combine multiple included tags."),
    nsfw: NsfwFilter = Query(default=NsfwFilter.DEFAULT, description="Controls how NSFW images are included."),
    status_filter: Annotated[
        str | None,
        Query(alias="status", description="Optional tagging status filter such as pending, processing, done, failed, or any."),
    ] = None,
    favorited: bool | None = Query(default=None, description="If true, return only images favorited by the current user."),
    page: int = Query(default=1, ge=1, description="1-based page number."),
    page_size: int = Query(default=20, ge=1, le=200, description="Maximum number of images to return."),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await image_service.list_images(
        db,
        user,
        tags,
        character_name,
        exclude_tags,
        mode,
        nsfw,
        status_filter,
        favorited,
        page,
        page_size,
    )


@router.get(
    "/{image_id}",
    response_model=ImageDetail,
    summary="Get Image Detail",
    response_description="Detailed metadata for a single image, including tag confidences.",
)
async def get_image(
    image_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await image_service.get_image_detail(db, image_id, user)


@router.patch(
    "/{image_id}",
    response_model=ImageDetail,
    summary="Update Image Metadata",
    response_description="Updated image metadata after applying manual tag and character name changes.",
)
async def update_image_metadata(
    image_id: uuid.UUID,
    body: ImageMetadataUpdate,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await image_service.update_image_metadata(db, image_id, user, body)


@router.get("/{image_id}/file", summary="Download Original Image")
async def get_image_file(
    image_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    image = await image_service.get_visible_image(db, image_id, user)
    return FileResponse(image.filepath, media_type=image.mime_type)


@router.get("/{image_id}/thumbnail", summary="Download Image Thumbnail")
async def get_image_thumbnail(
    image_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    image = await image_service.get_visible_image(db, image_id, user)
    if not image.thumbnail_path:
        raise HTTPException(status_code=404, detail="Thumbnail not available")
    return FileResponse(image.thumbnail_path, media_type="image/webp")


@router.delete("/{image_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Move Image To Trash")
async def delete_image(
    image_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    await image_service.soft_delete_image(db, image_id, user)


@router.post("/{image_id}/restore", status_code=status.HTTP_204_NO_CONTENT, summary="Restore Image From Trash")
async def restore_image(
    image_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    await image_service.restore_image(db, image_id, user)


@router.delete("/{image_id}/purge", status_code=status.HTTP_204_NO_CONTENT, summary="Permanently Delete Image")
async def purge_image(
    image_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    await image_service.purge_image(db, image_id, user)


@router.post("/{image_id}/favorite", status_code=status.HTTP_204_NO_CONTENT, summary="Favorite Image")
async def favorite_image(
    image_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    await image_service.favorite_image(db, image_id, user)


@router.delete("/{image_id}/favorite", status_code=status.HTTP_204_NO_CONTENT, summary="Remove Image Favorite")
async def unfavorite_image(
    image_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    await image_service.unfavorite_image(db, image_id, user)


@router.post(
    "/{image_id}/retag",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Re-queue Image For Tagging",
    response_description="Confirmation that the image was queued for tagging again.",
)
async def retag_image(
    image_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    await image_service.retag_image(db, image_id, user)
    return {"message": "Re-queued for tagging"}
