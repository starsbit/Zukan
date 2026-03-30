import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models.media_interactions import UserFavorite


class UserFavoriteRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get(self, media_id: uuid.UUID, user_id: uuid.UUID) -> UserFavorite | None:
        return (
            await self.db.execute(
                select(UserFavorite).where(UserFavorite.user_id == user_id, UserFavorite.media_id == media_id)
            )
        ).scalar_one_or_none()

    async def get_favorited_ids(self, user_id: uuid.UUID, media_ids: list[uuid.UUID]) -> set[uuid.UUID]:
        if not media_ids:
            return set()
        return set(
            (
                await self.db.execute(
                    select(UserFavorite.media_id).where(
                        UserFavorite.user_id == user_id,
                        UserFavorite.media_id.in_(media_ids),
                    )
                )
            ).scalars().all()
        )

    async def get_favorite_counts(self, media_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
        if not media_ids:
            return {}
        rows = (
            await self.db.execute(
                select(UserFavorite.media_id, func.count().label("cnt"))
                .where(UserFavorite.media_id.in_(media_ids))
                .group_by(UserFavorite.media_id)
            )
        ).all()
        return {row.media_id: row.cnt for row in rows}

    async def get_by_user_and_media_ids(self, user_id: uuid.UUID, media_ids: list[uuid.UUID]) -> list[UserFavorite]:
        return (
            await self.db.execute(
                select(UserFavorite).where(
                    UserFavorite.user_id == user_id,
                    UserFavorite.media_id.in_(media_ids),
                )
            )
        ).scalars().all()
