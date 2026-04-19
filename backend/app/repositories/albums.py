import uuid

from sqlalchemy import func, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models.albums import Album, AlbumMedia, AlbumShare, AlbumShareInvite, AlbumShareInviteStatus
from backend.app.models.auth import User
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

    async def get_invite(self, album_id: uuid.UUID, user_id: uuid.UUID) -> AlbumShareInvite | None:
        return (
            await self.db.execute(
                select(AlbumShareInvite).where(AlbumShareInvite.album_id == album_id, AlbumShareInvite.user_id == user_id)
            )
        ).scalar_one_or_none()

    async def get_invite_by_id(self, invite_id: uuid.UUID) -> AlbumShareInvite | None:
        return (
            await self.db.execute(select(AlbumShareInvite).where(AlbumShareInvite.id == invite_id))
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

    async def get_shares_for_user(self, user_id: uuid.UUID, album_ids: list[uuid.UUID]) -> list[AlbumShare]:
        if not album_ids:
            return []

        return (
            await self.db.execute(
                select(AlbumShare).where(
                    AlbumShare.user_id == user_id,
                    AlbumShare.album_id.in_(album_ids),
                )
            )
        ).scalars().all()

    async def get_pending_invites_for_user(self, user_id: uuid.UUID, album_ids: list[uuid.UUID]) -> list[AlbumShareInvite]:
        if not album_ids:
            return []

        return (
            await self.db.execute(
                select(AlbumShareInvite).where(
                    AlbumShareInvite.user_id == user_id,
                    AlbumShareInvite.album_id.in_(album_ids),
                )
            )
        ).scalars().all()

    async def get_shares_for_album(self, album_id: uuid.UUID) -> list[AlbumShare]:
        return (
            await self.db.execute(
                select(AlbumShare).where(AlbumShare.album_id == album_id)
            )
        ).scalars().all()

    async def get_pending_invites_for_album(self, album_id: uuid.UUID) -> list[AlbumShareInvite]:
        return (
            await self.db.execute(
                select(AlbumShareInvite).where(
                    AlbumShareInvite.album_id == album_id,
                    AlbumShareInvite.status == AlbumShareInviteStatus.pending,
                )
            )
        ).scalars().all()

    async def get_album_preview_media_ids(
        self,
        album_ids: list[uuid.UUID],
        *,
        limit_per_album: int = 4,
    ) -> dict[uuid.UUID, list[uuid.UUID]]:
        if not album_ids:
            return {}

        rows = (
            await self.db.execute(
                select(AlbumMedia.album_id, AlbumMedia.media_id)
                .where(AlbumMedia.album_id.in_(album_ids))
                .order_by(AlbumMedia.album_id.asc(), AlbumMedia.position.asc(), AlbumMedia.media_id.asc())
            )
        ).all()

        previews: dict[uuid.UUID, list[uuid.UUID]] = {}
        for album_id, media_id in rows:
            current = previews.setdefault(album_id, [])
            if len(current) < limit_per_album:
                current.append(media_id)

        return previews

    async def get_owner_summaries(self, owner_ids: list[uuid.UUID]) -> dict[uuid.UUID, User]:
        if not owner_ids:
            return {}

        users = (
            await self.db.execute(select(User).where(User.id.in_(owner_ids)))
        ).scalars().all()
        return {user.id: user for user in users}
