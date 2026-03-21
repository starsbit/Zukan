import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import current_user
from app.models import Album, AlbumImage, AlbumShare, Image, ImageTag, Tag, User, UserFavorite
from app.routers.images import _purge_image
from app.schemas import BulkAlbumRequest, BulkImageRequest, BulkResult

router = APIRouter(prefix="/images/bulk", tags=["bulk"])


@router.post("/delete", response_model=BulkResult)
async def bulk_delete(
    body: BulkImageRequest,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(Image).where(Image.id.in_(body.image_ids), Image.deleted_at.is_(None))
    )).scalars().all()

    found_ids = {r.id for r in rows}
    skipped = len(body.image_ids) - len(found_ids)
    processed = 0
    now = datetime.now(timezone.utc)

    for image in rows:
        if image.uploader_id == user.id or user.is_admin:
            image.deleted_at = now
            processed += 1
        else:
            skipped += 1

    await db.commit()
    return BulkResult(processed=processed, skipped=skipped)


@router.post("/restore", response_model=BulkResult)
async def bulk_restore(
    body: BulkImageRequest,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(Image).where(Image.id.in_(body.image_ids), Image.deleted_at.is_not(None))
    )).scalars().all()

    found_ids = {r.id for r in rows}
    skipped = len(body.image_ids) - len(found_ids)
    processed = 0

    for image in rows:
        if image.uploader_id == user.id or user.is_admin:
            image.deleted_at = None
            processed += 1
        else:
            skipped += 1

    await db.commit()
    return BulkResult(processed=processed, skipped=skipped)


@router.post("/purge", response_model=BulkResult)
async def bulk_purge(
    body: BulkImageRequest,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(Image).where(Image.id.in_(body.image_ids))
    )).scalars().all()

    found_ids = {r.id for r in rows}
    skipped = len(body.image_ids) - len(found_ids)
    processed = 0

    for image in rows:
        if image.uploader_id == user.id or user.is_admin:
            await _purge_image(image, db)
            processed += 1
        else:
            skipped += 1

    await db.commit()
    return BulkResult(processed=processed, skipped=skipped)


@router.post("/favorite", response_model=BulkResult)
async def bulk_favorite(
    body: BulkImageRequest,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    existing_favs = set((await db.execute(
        select(UserFavorite.image_id).where(
            UserFavorite.user_id == user.id,
            UserFavorite.image_id.in_(body.image_ids),
        )
    )).scalars().all())

    valid_ids = set((await db.execute(
        select(Image.id).where(Image.id.in_(body.image_ids), Image.deleted_at.is_(None))
    )).scalars().all())

    to_add = valid_ids - existing_favs
    skipped = len(body.image_ids) - len(to_add)

    for image_id in to_add:
        db.add(UserFavorite(user_id=user.id, image_id=image_id))

    await db.commit()
    return BulkResult(processed=len(to_add), skipped=skipped)


@router.delete("/favorite", response_model=BulkResult)
async def bulk_unfavorite(
    body: BulkImageRequest,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    favs = (await db.execute(
        select(UserFavorite).where(
            UserFavorite.user_id == user.id,
            UserFavorite.image_id.in_(body.image_ids),
        )
    )).scalars().all()

    skipped = len(body.image_ids) - len(favs)
    for fav in favs:
        await db.delete(fav)

    await db.commit()
    return BulkResult(processed=len(favs), skipped=skipped)


async def _get_album_with_edit(db: AsyncSession, album_id: uuid.UUID, user: User) -> Album:
    album = (await db.execute(select(Album).where(Album.id == album_id))).scalar_one_or_none()
    if album is None:
        raise HTTPException(status_code=404, detail="Album not found")
    if album.owner_id == user.id or user.is_admin:
        return album
    share = (await db.execute(
        select(AlbumShare).where(AlbumShare.album_id == album_id, AlbumShare.user_id == user.id)
    )).scalar_one_or_none()
    if share is None or not share.can_edit:
        raise HTTPException(status_code=403, detail="No edit access to album")
    return album


@router.post("/album", response_model=BulkResult)
async def bulk_add_to_album(
    body: BulkAlbumRequest,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    album = await _get_album_with_edit(db, body.album_id, user)

    max_pos = (await db.execute(
        select(func.coalesce(func.max(AlbumImage.position), 0)).where(AlbumImage.album_id == body.album_id)
    )).scalar_one()

    existing_ids = set((await db.execute(
        select(AlbumImage.image_id).where(AlbumImage.album_id == body.album_id)
    )).scalars().all())

    valid_ids = set((await db.execute(
        select(Image.id).where(Image.id.in_(body.image_ids), Image.deleted_at.is_(None))
    )).scalars().all())

    to_add = valid_ids - existing_ids
    skipped = len(body.image_ids) - len(to_add)

    for image_id in to_add:
        max_pos += 1
        db.add(AlbumImage(album_id=body.album_id, image_id=image_id, position=max_pos))

    await db.commit()

    if album.cover_image_id is None and to_add:
        first_id = (await db.execute(
            select(AlbumImage.image_id).where(AlbumImage.album_id == body.album_id).order_by(AlbumImage.position).limit(1)
        )).scalar_one_or_none()
        if first_id:
            album.cover_image_id = first_id
            await db.commit()

    return BulkResult(processed=len(to_add), skipped=skipped)


@router.delete("/album", response_model=BulkResult)
async def bulk_remove_from_album(
    body: BulkAlbumRequest,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    album = await _get_album_with_edit(db, body.album_id, user)

    ais = (await db.execute(
        select(AlbumImage).where(AlbumImage.album_id == body.album_id, AlbumImage.image_id.in_(body.image_ids))
    )).scalars().all()

    skipped = len(body.image_ids) - len(ais)
    removed_ids = {ai.image_id for ai in ais}
    cover_removed = album.cover_image_id in removed_ids

    for ai in ais:
        await db.delete(ai)

    if cover_removed:
        album.cover_image_id = None

    await db.commit()

    if cover_removed:
        first_id = (await db.execute(
            select(AlbumImage.image_id).where(AlbumImage.album_id == body.album_id).order_by(AlbumImage.position).limit(1)
        )).scalar_one_or_none()
        if first_id:
            album.cover_image_id = first_id
            await db.commit()

    return BulkResult(processed=len(ais), skipped=skipped)
