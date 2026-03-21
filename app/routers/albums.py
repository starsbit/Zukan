import uuid

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import current_user
from app.models import User
from app.schemas import (
    AddImagesToAlbum,
    AlbumCreate,
    AlbumRead,
    AlbumShareCreate,
    AlbumShareRead,
    AlbumUpdate,
    ImageListResponse,
    TagFilterMode,
)
from app.services import albums as album_service
from app.services.storage import zip_images

router = APIRouter(prefix="/albums", tags=["albums"])
album_access = album_service.album_access


@router.post("", response_model=AlbumRead, status_code=status.HTTP_201_CREATED)
async def create_album(
    body: AlbumCreate,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await album_service.create_album(db, user, body.name, body.description)


@router.get("", response_model=list[AlbumRead])
async def list_albums(
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await album_service.list_albums(db, user)


@router.get("/{album_id}", response_model=AlbumRead)
async def get_album(
    album_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    album = await album_service.get_album_for_user(db, album_id, user)
    return await album_service.album_read(db, album)


@router.patch("/{album_id}", response_model=AlbumRead)
async def update_album(
    album_id: uuid.UUID,
    body: AlbumUpdate,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await album_service.update_album(db, album_id, body, user)


@router.delete("/{album_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_album(
    album_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    await album_service.delete_album(db, album_id, user)


@router.get("/{album_id}/images", response_model=ImageListResponse)
async def list_album_images(
    album_id: uuid.UUID,
    tags: str | None = Query(default=None),
    exclude_tags: str | None = Query(default=None),
    mode: TagFilterMode = TagFilterMode.AND,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await album_service.list_album_images(db, album_id, user, tags, exclude_tags, mode, page, page_size)


@router.post("/{album_id}/images", status_code=status.HTTP_204_NO_CONTENT)
async def add_images_to_album(
    album_id: uuid.UUID,
    body: AddImagesToAlbum,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    await album_service.add_images_to_album(db, album_id, body.image_ids, user)


@router.delete("/{album_id}/images/{image_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_image_from_album(
    album_id: uuid.UUID,
    image_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    await album_service.remove_image_from_album(db, album_id, image_id, user)


@router.post("/{album_id}/share", response_model=AlbumShareRead)
async def share_album(
    album_id: uuid.UUID,
    body: AlbumShareCreate,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await album_service.share_album(db, album_id, body, user)


@router.get("/{album_id}/download")
async def download_album(
    album_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    album, rows = await album_service.get_album_download_images(db, album_id, user)
    buf = zip_images(rows)
    safe_name = album.name.replace('"', "").replace("/", "-")
    return StreamingResponse(
        content=iter([buf.read()]),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.zip"'},
    )


@router.delete("/{album_id}/share/{shared_user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_share(
    album_id: uuid.UUID,
    shared_user_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    await album_service.revoke_share(db, album_id, shared_user_id, user)
