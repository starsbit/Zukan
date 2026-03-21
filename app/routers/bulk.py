from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import current_user
from app.models import User
from app.schemas import BulkAlbumRequest, BulkImageRequest, BulkResult
from app.services import bulk as bulk_service

router = APIRouter(prefix="/images/bulk", tags=["bulk"])


@router.post("/delete", response_model=BulkResult)
async def bulk_delete(
    body: BulkImageRequest,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await bulk_service.bulk_delete_images(db, body.image_ids, user)


@router.post("/restore", response_model=BulkResult)
async def bulk_restore(
    body: BulkImageRequest,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await bulk_service.bulk_restore_images(db, body.image_ids, user)


@router.post("/purge", response_model=BulkResult)
async def bulk_purge(
    body: BulkImageRequest,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await bulk_service.bulk_purge_images(db, body.image_ids, user)


@router.post("/favorite", response_model=BulkResult)
async def bulk_favorite(
    body: BulkImageRequest,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await bulk_service.bulk_favorite_images(db, body.image_ids, user)


@router.delete("/favorite", response_model=BulkResult)
async def bulk_unfavorite(
    body: BulkImageRequest,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await bulk_service.bulk_unfavorite_images(db, body.image_ids, user)

@router.post("/album", response_model=BulkResult)
async def bulk_add_to_album(
    body: BulkAlbumRequest,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await bulk_service.bulk_add_images_to_album(db, body.album_id, body.image_ids, user)


@router.delete("/album", response_model=BulkResult)
async def bulk_remove_from_album(
    body: BulkAlbumRequest,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await bulk_service.bulk_remove_images_from_album(db, body.album_id, body.image_ids, user)
