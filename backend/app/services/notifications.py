from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.errors.error import AppError
from backend.app.models.auth import User
from backend.app.models.albums import AlbumShare, AlbumShareInviteStatus
from backend.app.models.notifications import AppAnnouncement, Notification, NotificationType
from backend.app.repositories.albums import AlbumRepository
from backend.app.repositories.notifications import NotificationRepository
from backend.app.schemas import NotificationListResponse
from backend.app.utils.pagination import apply_cursor_where_expr, decode_cursor_typed, encode_cursor

logger = logging.getLogger(__name__)


class NotificationService:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def publish_user_notification(
        self,
        *,
        user_id: uuid.UUID,
        title: str,
        body: str,
        notification_type: NotificationType = NotificationType.app_update,
        link_url: str | None = None,
        data: dict | None = None,
    ) -> Notification:
        notification = Notification(
            user_id=user_id,
            type=notification_type,
            title=title,
            body=body,
            is_read=False,
            link_url=link_url,
            data=data,
        )
        self._db.add(notification)
        await self._db.commit()
        await self._db.refresh(notification)
        logger.info(
            "Published notification user_id=%s type=%s title=%s kind=%s",
            user_id,
            notification.type.value,
            title,
            (data or {}).get("kind"),
        )
        return notification

    async def publish_announcement(self, announcement: AppAnnouncement) -> int:
        user_ids = (
            await self._db.execute(select(User.id))
        ).scalars().all()

        for user_id in user_ids:
            severity = announcement.severity.value if announcement.severity is not None else "info"
            self._db.add(
                Notification(
                    user_id=user_id,
                    type=NotificationType.app_update,
                    title=announcement.title,
                    body=announcement.message,
                    is_read=False,
                    link_url=None,
                    data={
                        "announcement_id": str(announcement.id),
                        "severity": severity,
                        "version": announcement.version,
                        "starts_at": announcement.starts_at.isoformat() if announcement.starts_at else None,
                        "ends_at": announcement.ends_at.isoformat() if announcement.ends_at else None,
                    },
                )
            )

        await self._db.commit()
        return len(user_ids)

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

    async def accept_invite(self, notification_id: uuid.UUID, user_id: uuid.UUID) -> Notification:
        notification = await self.get_notification_for_user(notification_id, user_id)
        invite = await self._get_pending_invite_from_notification(notification, user_id)

        share = await AlbumRepository(self._db).get_share(invite.album_id, user_id)
        if share is None:
            share = AlbumShare(
                album_id=invite.album_id,
                user_id=user_id,
                role=invite.role,
                shared_by_user_id=invite.invited_by_user_id,
            )
            self._db.add(share)
        else:
            share.role = invite.role
            share.shared_by_user_id = invite.invited_by_user_id

        invite.status = AlbumShareInviteStatus.accepted
        invite.responded_at = datetime.now(timezone.utc)
        notification.is_read = True
        notification.data = {
            **(notification.data or {}),
            "invite_status": AlbumShareInviteStatus.accepted.value,
        }
        await self._db.commit()
        await self._db.refresh(notification)
        return notification

    async def reject_invite(self, notification_id: uuid.UUID, user_id: uuid.UUID) -> Notification:
        notification = await self.get_notification_for_user(notification_id, user_id)
        invite = await self._get_pending_invite_from_notification(notification, user_id)

        invite.status = AlbumShareInviteStatus.rejected
        invite.responded_at = datetime.now(timezone.utc)
        notification.is_read = True
        notification.data = {
            **(notification.data or {}),
            "invite_status": AlbumShareInviteStatus.rejected.value,
        }
        await self._db.commit()
        await self._db.refresh(notification)
        return notification

    async def _get_pending_invite_from_notification(self, notification: Notification, user_id: uuid.UUID):
        if notification.type != NotificationType.share_invite:
            raise AppError(status_code=422, code="notification_not_actionable", detail="Notification cannot be acted on")

        payload = notification.data or {}
        invite_id = payload.get("invite_id")
        if not invite_id:
            raise AppError(status_code=422, code="notification_not_actionable", detail="Notification invite payload is missing")

        try:
            invite_uuid = uuid.UUID(str(invite_id))
        except ValueError as exc:
            raise AppError(status_code=422, code="notification_not_actionable", detail="Notification invite payload is invalid") from exc

        invite = await AlbumRepository(self._db).get_invite_by_id(invite_uuid)
        if invite is None or invite.user_id != user_id or invite.notification_id != notification.id:
            raise AppError(status_code=404, code="invite_not_found", detail="Invite not found")
        if invite.status != AlbumShareInviteStatus.pending:
            raise AppError(status_code=409, code="invite_not_pending", detail="Invite has already been resolved")
        return invite
