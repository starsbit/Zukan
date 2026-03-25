from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from backend.app.errors.error import AppError
from backend.app.models.notifications import Notification, NotificationType
from backend.app.services.notifications import NotificationService
from backend.tests.services.conftest import ScalarResult


@pytest.mark.asyncio
async def test_list_notifications_paginates(fake_db, user):
    service = NotificationService(fake_db)
    n1 = Notification(user_id=user.id, type=NotificationType.app_update, title="a", body="b", is_read=False)
    n2 = Notification(user_id=user.id, type=NotificationType.app_update, title="a", body="b", is_read=False)
    n3 = Notification(user_id=user.id, type=NotificationType.app_update, title="a", body="b", is_read=False)
    now = datetime.now(timezone.utc)
    for n in (n1, n2, n3):
        n.id = uuid.uuid4()
        n.created_at = now

    fake_db.execute = AsyncMock(return_value=ScalarResult(rows=[n1, n2, n3]))

    with patch("backend.app.services.notifications.NotificationRepository") as repo_cls:
        repo_cls.return_value.count_for_user = AsyncMock(return_value=3)
        result = await service.list_notifications(user.id, page_size=2)

    assert result.total == 3
    assert result.has_more is True
    assert len(result.items) == 2
    assert result.next_cursor is not None


@pytest.mark.asyncio
async def test_get_notification_for_user_not_found(fake_db, user):
    service = NotificationService(fake_db)

    with patch("backend.app.services.notifications.NotificationRepository") as repo_cls:
        repo_cls.return_value.get_by_id_for_user = AsyncMock(return_value=None)
        with pytest.raises(AppError) as exc:
            await service.get_notification_for_user(uuid.uuid4(), user.id)

    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_mark_read_mark_all_delete(fake_db, user):
    service = NotificationService(fake_db)
    notif = Notification(user_id=user.id, type=NotificationType.app_update, title="x", body="y", is_read=False)

    with patch("backend.app.services.notifications.NotificationRepository") as repo_cls:
        repo = repo_cls.return_value
        repo.get_by_id_for_user = AsyncMock(return_value=notif)
        repo.get_unread_for_user = AsyncMock(return_value=[notif])

        updated = await service.mark_read(uuid.uuid4(), user.id)
        await service.mark_all_read(user.id)
        await service.delete_notification(uuid.uuid4(), user.id)

    assert updated.is_read is True
    assert notif in fake_db.deleted
    assert fake_db.commit.await_count >= 3
