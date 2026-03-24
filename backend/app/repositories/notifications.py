import uuid
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models.notifications import AppAnnouncement, Notification


class NotificationRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_by_id(self, notification_id: uuid.UUID) -> Notification | None:
        return (
            await self.db.execute(select(Notification).where(Notification.id == notification_id))
        ).scalar_one_or_none()

    async def get_by_id_for_user(self, notification_id: uuid.UUID, user_id: uuid.UUID) -> Notification | None:
        return (
            await self.db.execute(
                select(Notification).where(
                    Notification.id == notification_id, Notification.user_id == user_id
                )
            )
        ).scalar_one_or_none()

    async def list_for_user(
        self,
        user_id: uuid.UUID,
        *,
        is_read: bool | None = None,
        offset: int,
        limit: int,
    ) -> list[Notification]:
        stmt = select(Notification).where(Notification.user_id == user_id)
        if is_read is not None:
            stmt = stmt.where(Notification.is_read == is_read)
        return (
            await self.db.execute(stmt.order_by(Notification.created_at.desc()).offset(offset).limit(limit))
        ).scalars().all()

    async def count_for_user(self, user_id: uuid.UUID, *, is_read: bool | None = None) -> int:
        stmt = select(func.count()).select_from(Notification).where(Notification.user_id == user_id)
        if is_read is not None:
            stmt = stmt.where(Notification.is_read == is_read)
        return (await self.db.execute(stmt)).scalar_one()

    async def get_unread_for_user(self, user_id: uuid.UUID) -> list[Notification]:
        return (
            await self.db.execute(
                select(Notification).where(
                    Notification.user_id == user_id, Notification.is_read == False  # noqa: E712
                )
            )
        ).scalars().all()


class AppAnnouncementRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_by_id(self, announcement_id: uuid.UUID) -> AppAnnouncement | None:
        return (
            await self.db.execute(select(AppAnnouncement).where(AppAnnouncement.id == announcement_id))
        ).scalar_one_or_none()

    async def list_active(self, now: datetime) -> list[AppAnnouncement]:
        return (
            await self.db.execute(
                select(AppAnnouncement)
                .where(
                    AppAnnouncement.is_active == True,  # noqa: E712
                    (AppAnnouncement.starts_at.is_(None)) | (AppAnnouncement.starts_at <= now),
                    (AppAnnouncement.ends_at.is_(None)) | (AppAnnouncement.ends_at >= now),
                )
                .order_by(AppAnnouncement.created_at.desc())
            )
        ).scalars().all()

    async def list_all(self, *, offset: int, limit: int) -> list[AppAnnouncement]:
        return (
            await self.db.execute(
                select(AppAnnouncement).order_by(AppAnnouncement.created_at.desc()).offset(offset).limit(limit)
            )
        ).scalars().all()

    async def count(self) -> int:
        return (await self.db.execute(select(func.count()).select_from(AppAnnouncement))).scalar_one()
