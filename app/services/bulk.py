from datetime import datetime, timezone
from typing import TypeAlias

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Image, User, UserFavorite
from app.schemas import BulkResult
from app.services import albums as album_service
from app.services import images as image_service

ImageIdList: TypeAlias = list


async def bulk_delete_images(db: AsyncSession, image_ids: ImageIdList, user: User) -> BulkResult:
    rows = (await db.execute(select(Image).where(Image.id.in_(image_ids), Image.deleted_at.is_(None)))).scalars().all()

    found_ids = {row.id for row in rows}
    skipped = len(image_ids) - len(found_ids)
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


async def bulk_restore_images(db: AsyncSession, image_ids: ImageIdList, user: User) -> BulkResult:
    rows = (await db.execute(select(Image).where(Image.id.in_(image_ids), Image.deleted_at.is_not(None)))).scalars().all()

    found_ids = {row.id for row in rows}
    skipped = len(image_ids) - len(found_ids)
    processed = 0

    for image in rows:
        if image.uploader_id == user.id or user.is_admin:
            image.deleted_at = None
            processed += 1
        else:
            skipped += 1

    await db.commit()
    return BulkResult(processed=processed, skipped=skipped)


async def bulk_purge_images(db: AsyncSession, image_ids: ImageIdList, user: User) -> BulkResult:
    rows = (await db.execute(select(Image).where(Image.id.in_(image_ids)))).scalars().all()

    found_ids = {row.id for row in rows}
    skipped = len(image_ids) - len(found_ids)
    processed = 0

    for image in rows:
        if image.uploader_id == user.id or user.is_admin:
            await image_service.purge_image_record(image, db)
            processed += 1
        else:
            skipped += 1

    await db.commit()
    return BulkResult(processed=processed, skipped=skipped)


async def bulk_favorite_images(db: AsyncSession, image_ids: ImageIdList, user: User) -> BulkResult:
    existing_favs = set(
        (
            await db.execute(
                select(UserFavorite.image_id).where(
                    UserFavorite.user_id == user.id,
                    UserFavorite.image_id.in_(image_ids),
                )
            )
        ).scalars().all()
    )

    valid_ids = set(
        (await db.execute(select(Image.id).where(Image.id.in_(image_ids), Image.deleted_at.is_(None)))).scalars().all()
    )

    to_add = valid_ids - existing_favs
    skipped = len(image_ids) - len(to_add)

    for image_id in to_add:
        db.add(UserFavorite(user_id=user.id, image_id=image_id))

    await db.commit()
    return BulkResult(processed=len(to_add), skipped=skipped)


async def bulk_unfavorite_images(db: AsyncSession, image_ids: ImageIdList, user: User) -> BulkResult:
    favorites = (
        await db.execute(
            select(UserFavorite).where(
                UserFavorite.user_id == user.id,
                UserFavorite.image_id.in_(image_ids),
            )
        )
    ).scalars().all()

    skipped = len(image_ids) - len(favorites)
    for favorite in favorites:
        await db.delete(favorite)

    await db.commit()
    return BulkResult(processed=len(favorites), skipped=skipped)


async def bulk_add_images_to_album(db: AsyncSession, album_id, image_ids: ImageIdList, user: User) -> BulkResult:
    processed, skipped = await album_service.bulk_add_to_album(db, album_id, image_ids, user)
    return BulkResult(processed=processed, skipped=skipped)


async def bulk_remove_images_from_album(db: AsyncSession, album_id, image_ids: ImageIdList, user: User) -> BulkResult:
    processed, skipped = await album_service.bulk_remove_from_album(db, album_id, image_ids, user)
    return BulkResult(processed=processed, skipped=skipped)
