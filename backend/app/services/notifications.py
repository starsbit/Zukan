from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.errors.error import AppError
from backend.app.models.notifications import Notification
from backend.app.repositories.notifications import NotificationRepository
from backend.app.schemas import NotificationListResponse
from backend.app.utils.pagination import apply_cursor_where_expr, decode_cursor_typed, encode_cursor


class NotificationService:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def list_notifications(
        self,
        user_id: uuid.UUID,
        *,
        after: str | None = None,
        page_size: int = 20,
        is_read: bool | None = None,
    ) -> NotificationListResponse:
        repo = NotificationRepository(self._db)
        total = await repo.count_for_user(user_id, is_read=is_read)
        stmt = select(Notification).where(Notification.user_id == user_id)
        if is_read is not None:
            stmt = stmt.where(Notification.is_read == is_read)

        if after:
            decoded = decode_cursor_typed(after, "datetime")
            if decoded is not None:
                cursor_val, cursor_id = decoded
                stmt = apply_cursor_where_expr(
                    stmt,
                    sort_expr=Notification.created_at,
                    id_expr=Notification.id,
                    sort_order="desc",
                    cursor_val=cursor_val,
                    cursor_id=cursor_id,
                )

        rows = (await self._db.execute(stmt.order_by(Notification.created_at.desc(), Notification.id.desc()).limit(page_size + 1))).scalars().all()
        has_more = len(rows) > page_size
        rows = rows[:page_size]

        next_cursor = None
        if has_more and rows:
            last = rows[-1]
            next_cursor = encode_cursor(last.created_at, last.id)

        return NotificationListResponse(
            total=total,
            next_cursor=next_cursor,
            has_more=has_more,
            page_size=page_size,
            items=list(rows),
        )

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
