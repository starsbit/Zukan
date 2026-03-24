from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.errors.error import AppError
from backend.app.errors.media import media_not_found
from backend.app.models.media_interactions import UserFavorite
from backend.app.repositories.media_interactions import UserFavoriteRepository


class MediaInteractionService:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def get_favorite(self, media_id: uuid.UUID, user_id: uuid.UUID) -> UserFavorite | None:
        return await UserFavoriteRepository(self._db).get(media_id, user_id)

    async def get_favorited_ids(self, user_id: uuid.UUID, media_ids: list[uuid.UUID]) -> set[uuid.UUID]:
        return await UserFavoriteRepository(self._db).get_favorited_ids(user_id, media_ids)

    async def set_favorite_state(self, media_id: uuid.UUID, user_id: uuid.UUID, favorited: bool | None) -> bool:
        existing = await UserFavoriteRepository(self._db).get(media_id, user_id)
        if favorited is True and existing is None:
            self._db.add(UserFavorite(user_id=user_id, media_id=media_id))
            return True
        if favorited is False and existing is not None:
            await self._db.delete(existing)
            return True
        return False

    async def favorite_media(self, media_id: uuid.UUID, user_id: uuid.UUID) -> None:
        await self.set_favorite_state(media_id, user_id, True)
        await self._db.commit()

    async def unfavorite_media(self, media_id: uuid.UUID, user_id: uuid.UUID) -> None:
        favorite = await UserFavoriteRepository(self._db).get(media_id, user_id)
        if favorite is None:
            raise AppError(status_code=404, code=media_not_found, detail="Not in favorites")
        await self._db.delete(favorite)
        await self._db.commit()
