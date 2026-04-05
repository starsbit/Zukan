from __future__ import annotations

import logging
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.errors.error import AppError
from backend.app.errors.media import media_not_found
from backend.app.models.auth import User
from backend.app.models.media_interactions import UserFavorite
from backend.app.schemas import BulkResult
from backend.app.services.media.query import MediaQueryService

logger = logging.getLogger(__name__)


class MediaInteractionService:
    def __init__(self, db: AsyncSession, query: MediaQueryService) -> None:
        self._db = db
        self._query = query

    async def favorite_media(self, media_id: uuid.UUID, user: User) -> None:
        await self._set_favorite_state(media_id, user, True)
        await self._db.commit()
        logger.info("Favorited media user_id=%s media_id=%s", user.id, media_id)

    async def unfavorite_media(self, media_id: uuid.UUID, user: User) -> None:
        favorite = await self._query.get_favorite(media_id, user.id)
        if favorite is None:
            logger.warning("Unfavorite rejected because media was not in favorites user_id=%s media_id=%s", user.id, media_id)
            raise AppError(status_code=404, code=media_not_found, detail="Not in favorites")
        await self._db.delete(favorite)
        await self._db.commit()
        logger.info("Unfavorited media user_id=%s media_id=%s", user.id, media_id)

    async def bulk_favorite_media(self, media_ids: list[uuid.UUID], user: User) -> BulkResult:
        processed, skipped = await self._batch_update_favorite_state(media_ids, True, user)
        logger.info("Bulk favorited media user_id=%s processed=%s skipped=%s", user.id, processed, skipped)
        return BulkResult(processed=processed, skipped=skipped)

    async def bulk_unfavorite_media(self, media_ids: list[uuid.UUID], user: User) -> BulkResult:
        processed, skipped = await self._batch_update_favorite_state(media_ids, False, user)
        logger.info("Bulk unfavorited media user_id=%s processed=%s skipped=%s", user.id, processed, skipped)
        return BulkResult(processed=processed, skipped=skipped)

    async def _set_favorite_state(self, media_id: uuid.UUID, user: User, favorited: bool | None) -> bool:
        await self._query.get_favoritable_media(media_id, user)
        existing = await self._query.get_favorite(media_id, user.id)
        if favorited is True and existing is None:
            self._db.add(UserFavorite(user_id=user.id, media_id=media_id))
            return True
        if favorited is False and existing is not None:
            await self._db.delete(existing)
            return True
        return False

    async def _batch_update_favorite_state(self, media_ids: list[uuid.UUID], favorited: bool, user: User) -> tuple[int, int]:
        active_ids = await self._query.get_favoritable_media_ids(media_ids, user)
        existing_favorites = await self._query.get_existing_favorites(user.id, media_ids)
        existing_ids = {f.media_id for f in existing_favorites}
        if favorited:
            to_change = active_ids - existing_ids
            for media_id in to_change:
                self._db.add(UserFavorite(user_id=user.id, media_id=media_id))
        else:
            to_change = existing_ids
            for favorite in existing_favorites:
                await self._db.delete(favorite)
        await self._db.commit()
        return len(to_change), len(media_ids) - len(to_change)
