import uuid
from datetime import datetime
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from backend.app.models.auth import User
from backend.app.models.media import Media, MediaTag


class MediaRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_by_id(self, media_id: uuid.UUID) -> Media | None:
        return (await self.db.execute(select(Media).where(Media.id == media_id))).scalar_one_or_none()

    async def get_by_id_with_relations(
        self, media_id: uuid.UUID, *, deleted: bool | None = None
    ) -> Media | None:
        stmt = (
            select(Media)
            .options(
                selectinload(Media.media_tags).selectinload(MediaTag.tag),
                selectinload(Media.external_refs),
                selectinload(Media.entities),
            )
            .where(Media.id == media_id)
            .execution_options(populate_existing=True)
        )
        if deleted is True:
            stmt = stmt.where(Media.deleted_at.is_not(None))
        elif deleted is False:
            stmt = stmt.where(Media.deleted_at.is_(None))
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def get_by_sha256(self, sha256):
        from sqlalchemy import text

        await self.db.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:hash, 0))"),
            {"hash": sha256},
        )
        return (
            await self.db.execute(
                select(Media)
                .where(Media.sha256 == sha256)
                .order_by(Media.uploaded_at, Media.id)
                .limit(1)
            )
        ).scalar_one_or_none()

    async def get_by_ids(self, media_ids: list[uuid.UUID]) -> list[Media]:
        return (await self.db.execute(select(Media).where(Media.id.in_(media_ids)))).scalars().all()

    def accessible_to_user_clause(self, user):
        from sqlalchemy import true

        return true()

    async def get_accessible_active_ids(
        self, user: User, media_ids: list[uuid.UUID]
    ) -> set[uuid.UUID]:
        if not media_ids:
            return set()
        stmt = select(Media.id).where(
            Media.id.in_(media_ids), Media.deleted_at.is_(None)
        )
        return set((await self.db.execute(stmt)).scalars().all())

    async def is_accessible(
        self, media_id: uuid.UUID, user: User, *, include_deleted: bool = False
    ) -> bool:
        stmt = select(Media.id).where(Media.id == media_id)
        if not include_deleted:
            stmt = stmt.where(Media.deleted_at.is_(None))
        return (await self.db.execute(stmt)).scalar_one_or_none() is not None

    async def get_active_ids(self, media_ids: list[uuid.UUID]) -> set[uuid.UUID]:
        return set(
            (await self.db.execute(select(Media.id).where(Media.id.in_(media_ids), Media.deleted_at.is_(None)))).scalars().all()
        )

    async def get_expired_trash(self, cutoff: datetime) -> list[Media]:
        return (
            await self.db.execute(
                select(Media).where(Media.deleted_at.is_not(None), Media.deleted_at < cutoff)
            )
        ).scalars().all()

    async def get_active_media(self) -> list[Media]:
        return (
            (await self.db.execute(select(Media).where(Media.deleted_at.is_(None))))
            .scalars()
            .all()
        )

    async def find_by_phash(self, phash: str, *, exclude_id: uuid.UUID | None = None) -> list[Media]:
        stmt = select(Media).where(Media.phash == phash, Media.deleted_at.is_(None))
        if exclude_id is not None:
            stmt = stmt.where(Media.id != exclude_id)
        return (await self.db.execute(stmt)).scalars().all()

    async def count_active(self) -> int:
        return (await self.db.execute(select(func.count(Media.id)).where(Media.deleted_at.is_(None)))).scalar_one()

    async def count_trashed(self) -> int:
        return (await self.db.execute(select(func.count(Media.id)).where(Media.deleted_at.is_not(None)))).scalar_one()

    async def count_by_tagging_status(self, status: str) -> int:
        return (
            await self.db.execute(
                select(func.count(Media.id)).where(Media.tagging_status == status, Media.deleted_at.is_(None))
            )
        ).scalar_one()

    async def sum_file_size(self) -> int:
        return (
            await self.db.execute(select(func.coalesce(func.sum(Media.file_size), 0)))
        ).scalar_one()

    async def delete(self, media: Media) -> None:
        await self.db.delete(media)
        await self.db.flush()
