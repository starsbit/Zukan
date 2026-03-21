from typing import TypeAlias

from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import User
from backend.schemas import BulkResult, MediaBatchDelete, MediaBatchUpdate
from backend.services import albums as album_service
from backend.services import media as media_service

MediaIdList: TypeAlias = list


async def bulk_delete_media(db: AsyncSession, media_ids: MediaIdList, user: User) -> BulkResult:
    return await media_service.batch_delete_media(db, MediaBatchDelete(media_ids=media_ids), user)


async def bulk_restore_media(db: AsyncSession, media_ids: MediaIdList, user: User) -> BulkResult:
    return await media_service.batch_update_media(db, MediaBatchUpdate(media_ids=media_ids, deleted=False), user)


async def bulk_purge_media(db: AsyncSession, media_ids: MediaIdList, user: User) -> BulkResult:
    return await media_service.batch_purge_media(db, MediaBatchDelete(media_ids=media_ids), user)


async def bulk_favorite_media(db: AsyncSession, media_ids: MediaIdList, user: User) -> BulkResult:
    return await media_service.batch_update_media(db, MediaBatchUpdate(media_ids=media_ids, favorited=True), user)


async def bulk_unfavorite_media(db: AsyncSession, media_ids: MediaIdList, user: User) -> BulkResult:
    return await media_service.batch_update_media(db, MediaBatchUpdate(media_ids=media_ids, favorited=False), user)


async def bulk_add_media_to_album(db: AsyncSession, album_id, media_ids: MediaIdList, user: User) -> BulkResult:
    processed, skipped = await album_service.bulk_add_to_album(db, album_id, media_ids, user)
    return BulkResult(processed=processed, skipped=skipped)


async def bulk_remove_media_from_album(db: AsyncSession, album_id, media_ids: MediaIdList, user: User) -> BulkResult:
    processed, skipped = await album_service.bulk_remove_from_album(db, album_id, media_ids, user)
    return BulkResult(processed=processed, skipped=skipped)
