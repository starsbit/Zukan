import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.database import get_db
from backend.app.routers.deps import current_user
from backend.app.models.auth import User
from backend.app.schemas import (
    AlbumListResponse,
    AlbumMediaBatchUpdate,
    AlbumCreate,
    AlbumRead,
    AlbumShareCreate,
    AlbumShareRead,
    AlbumUpdate,
    BulkResult,
    ERROR_RESPONSES,
    MediaListResponse,
    TagFilterMode,
)
from backend.app.services import albums as album_service
from backend.app.services.storage import zip_media

router = APIRouter(prefix="/albums", tags=["albums"], responses=ERROR_RESPONSES)
album_access = album_service.album_access


@router.post("", response_model=AlbumRead, status_code=status.HTTP_201_CREATED)
async def create_album(
    body: AlbumCreate,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await album_service.create_album(db, user, body.name, body.description)


@router.get("", response_model=AlbumListResponse)
async def list_albums(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    sort_by: Literal["name", "created_at"] = Query(default="created_at"),
    sort_order: Literal["asc", "desc"] = Query(default="desc"),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await album_service.list_albums(db, user, page=page, page_size=page_size, sort_by=sort_by, sort_order=sort_order)


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


@router.get("/{album_id}/media", response_model=MediaListResponse)
async def list_album_media(
    album_id: uuid.UUID,
    tag: Annotated[list[str] | None, Query(description="Tags that must be present. Repeat for multiple: ?tag=cat&tag=night")] = None,
    exclude_tag: Annotated[list[str] | None, Query(description="Tags that must not be present. Repeat for multiple.")] = None,
    mode: TagFilterMode = TagFilterMode.AND,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await album_service.list_album_media(db, album_id, user, tag, exclude_tag, mode, page, page_size)


@router.put("/{album_id}/media", response_model=BulkResult)
async def add_media_to_album(
    album_id: uuid.UUID,
    body: AlbumMediaBatchUpdate,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    processed, skipped = await album_service.bulk_add_to_album(db, album_id, body.media_ids, user)
    return BulkResult(processed=processed, skipped=skipped)


@router.delete("/{album_id}/media", response_model=BulkResult)
async def remove_media_from_album(
    album_id: uuid.UUID,
    body: AlbumMediaBatchUpdate,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    processed, skipped = await album_service.bulk_remove_from_album(db, album_id, body.media_ids, user)
    return BulkResult(processed=processed, skipped=skipped)


@router.post("/{album_id}/shares", response_model=AlbumShareRead)
async def share_album(
    album_id: uuid.UUID,
    body: AlbumShareCreate,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await album_service.share_album(db, album_id, body, user)


@router.get(
    "/{album_id}/download",
    summary="Download Album Media",
    responses={200: {"content": {"application/zip": {}}, "description": "ZIP archive of all album media."}},
)
async def download_album(
    album_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    album, rows = await album_service.get_album_download_media(db, album_id, user)
    buf = zip_media(rows)
    safe_name = album.name.replace('"', "").replace("/", "-")
    return StreamingResponse(
        content=iter([buf.read()]),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.zip"'},
    )


@router.delete("/{album_id}/shares/{shared_user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_share(
    album_id: uuid.UUID,
    shared_user_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    await album_service.revoke_share(db, album_id, shared_user_id, user)
