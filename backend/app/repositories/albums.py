import uuid

from sqlalchemy import func, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models.albums import Album, AlbumMedia, AlbumShare
from backend.app.models.media import Media


class AlbumRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_by_id(self, album_id: uuid.UUID) -> Album | None:
        return (await self.db.execute(select(Album).where(Album.id == album_id))).scalar_one_or_none()

    async def get_share(self, album_id: uuid.UUID, user_id: uuid.UUID) -> AlbumShare | None:
        return (
            await self.db.execute(
                select(AlbumShare).where(AlbumShare.album_id == album_id, AlbumShare.user_id == user_id)
            )
        ).scalar_one_or_none()

    async def count_media(self, album_id: uuid.UUID) -> int:
        return (
            await self.db.execute(select(func.count(AlbumMedia.media_id)).where(AlbumMedia.album_id == album_id))
        ).scalar_one()

    async def get_max_position(self, album_id: uuid.UUID) -> int:
        return (
            await self.db.execute(
                select(func.coalesce(func.max(AlbumMedia.position), 0)).where(AlbumMedia.album_id == album_id)
            )
        ).scalar_one()

    async def get_existing_media_ids(self, album_id: uuid.UUID) -> set[uuid.UUID]:
        return set(
            (await self.db.execute(select(AlbumMedia.media_id).where(AlbumMedia.album_id == album_id))).scalars().all()
        )

    async def get_album_media_item(self, album_id: uuid.UUID, media_id: uuid.UUID) -> AlbumMedia | None:
        return (
            await self.db.execute(
                select(AlbumMedia).where(AlbumMedia.album_id == album_id, AlbumMedia.media_id == media_id)
            )
        ).scalar_one_or_none()

    async def get_album_media_items(self, album_id: uuid.UUID, media_ids: list[uuid.UUID]) -> list[AlbumMedia]:
        return (
            await self.db.execute(
                select(AlbumMedia).where(AlbumMedia.album_id == album_id, AlbumMedia.media_id.in_(media_ids))
            )
        ).scalars().all()

    async def get_first_media_id(self, album_id: uuid.UUID) -> uuid.UUID | None:
        return (
            await self.db.execute(
                select(AlbumMedia.media_id)
                .where(AlbumMedia.album_id == album_id)
                .order_by(AlbumMedia.position)
                .limit(1)
            )
        ).scalar_one_or_none()

    async def count_accessible(self, user_id: uuid.UUID) -> int:
        stmt = self.accessible_stmt(user_id)
        return (await self.db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()

    def accessible_stmt(self, user_id: uuid.UUID):
        owned = select(Album).where(Album.owner_id == user_id)
        shared = (
            select(Album)
            .join(AlbumShare, AlbumShare.album_id == Album.id)
            .where(AlbumShare.user_id == user_id, Album.owner_id != user_id)
        )
        combined = union_all(owned, shared).subquery()
        return select(Album).where(Album.id.in_(select(combined.c.id)))

    async def list_accessible(self, user_id: uuid.UUID, *, offset: int, limit: int, order_expr) -> list[Album]:
        stmt = self.accessible_stmt(user_id).order_by(order_expr).offset(offset).limit(limit)
        return (await self.db.execute(stmt)).scalars().all()

    async def get_media_for_download(self, album_id: uuid.UUID) -> list[Media]:
        return (
            await self.db.execute(
                select(Media)
                .join(AlbumMedia, AlbumMedia.media_id == Media.id)
                .where(AlbumMedia.album_id == album_id, Media.deleted_at.is_(None))
                .order_by(AlbumMedia.position, AlbumMedia.added_at)
            )
        ).scalars().all()
