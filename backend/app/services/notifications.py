from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.errors.error import AppError
from backend.app.models.notifications import Notification
from backend.app.repositories.notifications import NotificationRepository
from backend.app.schemas import NotificationListResponse


class NotificationService:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def list_notifications(
        self,
        user_id: uuid.UUID,
        *,
        page: int = 1,
        page_size: int = 20,
        is_read: bool | None = None,
    ) -> NotificationListResponse:
        repo = NotificationRepository(self._db)
        offset = (page - 1) * page_size
        total = await repo.count_for_user(user_id, is_read=is_read)
        items = await repo.list_for_user(user_id, is_read=is_read, offset=offset, limit=page_size)
        return NotificationListResponse(total=total, page=page, page_size=page_size, items=list(items))

    async def get_notification_for_user(self, notification_id: uuid.UUID, user_id: uuid.UUID) -> Notification:
        notification = await NotificationRepository(self._db).get_by_id_for_user(notification_id, user_id)
        if notification is None:
            raise AppError(status_code=404, code="notification_not_found", detail="Notification not found")
        return notification

    async def mark_read(self, notification_id: uuid.UUID, user_id: uuid.UUID) -> Notification:
        notification = await self.get_notification_for_user(notification_id, user_id)
        notification.is_read = True
        await self._db.commit()
        await self._db.refresh(notification)
        return notification

    async def mark_all_read(self, user_id: uuid.UUID) -> None:
        for notification in await NotificationRepository(self._db).get_unread_for_user(user_id):
            notification.is_read = True
        await self._db.commit()

    async def delete_notification(self, notification_id: uuid.UUID, user_id: uuid.UUID) -> None:
        notification = await self.get_notification_for_user(notification_id, user_id)
        await self._db.delete(notification)
        await self._db.commit()
