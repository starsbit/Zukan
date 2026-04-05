from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models.auth import User
from backend.app.models.media import Media
from backend.app.repositories.media import MediaRepository
from backend.app.schemas import BulkResult, MediaIdsRequest
from backend.app.services.media.query import MediaQueryService

TRASH_RETENTION_DAYS = 30
logger = logging.getLogger(__name__)


class MediaLifecycleService:
    def __init__(self, db: AsyncSession, query: MediaQueryService) -> None:
        self._db = db
        self._query = query

    async def purge_expired_trash(self, now: datetime | None = None) -> int:
        cutoff = (now or datetime.now(timezone.utc)) - timedelta(days=TRASH_RETENTION_DAYS)
        expired = await self._query.get_expired_trash(cutoff)
        logger.info("Purging expired trash candidates count=%s cutoff=%s", len(expired), cutoff.isoformat())
        for media in expired:
            await self.purge_media_record(media)
        if expired:
            await self._db.commit()
        return len(expired)

    async def purge_media_record(self, media: Media) -> None:
        from backend.app.utils.storage import delete_media_files

        await MediaRepository(self._db).delete(media)
        delete_media_files(media.filepath, media.poster_path, media.thumbnail_path)
        logger.info("Purged media record media_id=%s", media.id)

    async def soft_delete_media(self, media_id: uuid.UUID, user: User) -> None:
        media = await self._query.get_owned_or_admin_media(media_id, user, trashed=False)
        media.deleted_at = datetime.now(timezone.utc)
        await self._db.commit()
        logger.info("Soft deleted media user_id=%s media_id=%s", user.id, media_id)

    async def restore_media(self, media_id: uuid.UUID, user: User) -> None:
        media = await self._query.get_owned_or_admin_media(media_id, user, trashed=True)
        media.deleted_at = None
        await self._db.commit()
        logger.info("Restored media user_id=%s media_id=%s", user.id, media_id)

    async def purge_media(self, media_id: uuid.UUID, user: User) -> None:
        media = await self._query.get_owned_or_admin_media(media_id, user, trashed=None)
        await self.purge_media_record(media)
        await self._db.commit()
        logger.info("Permanently deleted media user_id=%s media_id=%s", user.id, media_id)

    async def empty_trash(self, user: User) -> None:
        trashed_media = await self._query.list_trashed_media_for_user(user)
        for media in trashed_media:
            await self.purge_media_record(media)
        await self._db.commit()
        logger.info("Emptied trash user_id=%s purged=%s", user.id, len(trashed_media))

    async def batch_delete_media(self, payload: MediaIdsRequest, user: User) -> BulkResult:
        processed, skipped = await self._batch_update_deleted_state(payload.media_ids, True, user)
        return BulkResult(processed=processed, skipped=skipped)

    async def bulk_delete_media(self, media_ids: list[uuid.UUID], user: User) -> BulkResult:
        processed, skipped = await self._batch_update_deleted_state(media_ids, True, user)
        return BulkResult(processed=processed, skipped=skipped)

    async def bulk_restore_media(self, media_ids: list[uuid.UUID], user: User) -> BulkResult:
        processed, skipped = await self._batch_update_deleted_state(media_ids, False, user)
        return BulkResult(processed=processed, skipped=skipped)

    async def bulk_purge_media(self, media_ids: list[uuid.UUID], user: User) -> BulkResult:
        rows = await self._query.get_media_by_ids(media_ids)
        found_ids = {row.id for row in rows}
        skipped = len(media_ids) - len(found_ids)
        processed = 0
        for media in rows:
            if media.uploader_id == user.id or user.is_admin:
                await self.purge_media_record(media)
                processed += 1
            else:
                skipped += 1
        await self._db.commit()
        logger.info("Bulk purged media user_id=%s processed=%s skipped=%s", user.id, processed, skipped)
        return BulkResult(processed=processed, skipped=skipped)

    async def batch_purge_media(self, payload: MediaIdsRequest, user: User) -> BulkResult:
        rows = await self._query.get_media_by_ids(payload.media_ids)
        found_ids = {row.id for row in rows}
        skipped = len(payload.media_ids) - len(found_ids)
        processed = 0
        for media in rows:
            if media.uploader_id == user.id or user.is_admin:
                await self.purge_media_record(media)
                processed += 1
            else:
                skipped += 1
        await self._db.commit()
        logger.info("Batch purged media user_id=%s processed=%s skipped=%s", user.id, processed, skipped)
        return BulkResult(processed=processed, skipped=skipped)

    async def _batch_update_deleted_state(self, media_ids: list[uuid.UUID], deleted: bool, user: User) -> tuple[int, int]:
        rows = await self._query.get_media_by_ids(media_ids)
        found_ids = {row.id for row in rows}
        skipped = len(media_ids) - len(found_ids)
        processed = 0
        now = datetime.now(timezone.utc)
        for media in rows:
            if media.uploader_id != user.id and not user.is_admin:
                skipped += 1
                continue
            if deleted and media.deleted_at is None:
                media.deleted_at = now
                processed += 1
            elif not deleted and media.deleted_at is not None:
                media.deleted_at = None
                processed += 1
            else:
                skipped += 1
        await self._db.commit()
        logger.info(
            "Bulk deleted-state update user_id=%s deleted=%s processed=%s skipped=%s",
            user.id,
            deleted,
            processed,
            skipped,
        )
        return processed, skipped
