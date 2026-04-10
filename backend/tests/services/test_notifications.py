from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from backend.app.errors.error import AppError
from backend.app.models.auth import User
from backend.app.models.albums import AlbumShareInvite, AlbumShareInviteStatus, AlbumShareRole
from backend.app.models.notifications import AnnouncementSeverity, AppAnnouncement, Notification, NotificationType
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


@pytest.mark.asyncio
async def test_accept_and_reject_invites(fake_db, user):
    service = NotificationService(fake_db)
    notification = Notification(
        user_id=user.id,
        type=NotificationType.share_invite,
        title="Album invite",
        body="Join album",
        is_read=False,
        data={"invite_id": str(uuid.uuid4()), "invite_status": "pending"},
    )
    notification.id = uuid.uuid4()
    invite = AlbumShareInvite(
        album_id=uuid.uuid4(),
        user_id=user.id,
        role=AlbumShareRole.editor,
        status=AlbumShareInviteStatus.pending,
        invited_by_user_id=uuid.uuid4(),
        notification_id=notification.id,
    )
    invite.id = uuid.UUID(str(notification.data["invite_id"]))

    with patch.object(service, "get_notification_for_user", AsyncMock(return_value=notification)), patch(
        "backend.app.services.notifications.AlbumRepository"
    ) as repo_cls:
        repo = repo_cls.return_value
        repo.get_invite_by_id = AsyncMock(return_value=invite)
        repo.get_share = AsyncMock(return_value=None)

        accepted = await service.accept_invite(notification.id, user.id)
        assert accepted.is_read is True
        assert accepted.data["invite_status"] == "accepted"

        invite.status = AlbumShareInviteStatus.pending
        notification.is_read = False
        notification.data = {"invite_id": str(invite.id), "invite_status": "pending"}
        rejected = await service.reject_invite(notification.id, user.id)

    assert rejected.data["invite_status"] == "rejected"
    assert any(getattr(item, "album_id", None) == invite.album_id for item in fake_db.added)


@pytest.mark.asyncio
async def test_publish_announcement_creates_app_update_notifications_for_all_users(fake_db):
    service = NotificationService(fake_db)
    announcement = AppAnnouncement(
        id=uuid.uuid4(),
        version="2.0.0",
        title="Maintenance",
        message="Nightly deployment window",
        severity=AnnouncementSeverity.warning,
    )
    user_ids = [uuid.uuid4(), uuid.uuid4()]
    fake_db.execute = AsyncMock(return_value=ScalarResult(rows=user_ids))

    published = await service.publish_announcement(announcement)

    assert published == 2
    notifications = [item for item in fake_db.added if isinstance(item, Notification)]
    assert len(notifications) == 2
    assert all(item.type == NotificationType.app_update for item in notifications)
    assert notifications[0].title == "Maintenance"
    assert notifications[0].data["announcement_id"] == str(announcement.id)
    fake_db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_publish_user_notification_creates_single_notification(fake_db, user):
    service = NotificationService(fake_db)

    notification = await service.publish_user_notification(
        user_id=user.id,
        title="Scraped Saber",
        body="Imported 2 images.",
        data={"kind": "import_complete"},
    )

    assert notification.title == "Scraped Saber"
    added = [item for item in fake_db.added if isinstance(item, Notification)]
    assert len(added) == 1
    assert added[0].data["kind"] == "import_complete"


@pytest.mark.asyncio
async def test_publish_admin_notification_creates_notifications_for_all_admins(fake_db):
    service = NotificationService(fake_db)
    admin_ids = [uuid.uuid4(), uuid.uuid4()]
    fake_db.execute = AsyncMock(return_value=ScalarResult(rows=admin_ids))

    published = await service.publish_admin_notification(
        title="Automation alert",
        body="Background sync failed",
        data={"kind": "automation_alert", "category": "sync_error"},
    )

    assert published == 2
    notifications = [item for item in fake_db.added if isinstance(item, Notification)]
    assert len(notifications) == 2
    assert notifications[0].title == "Automation alert"
    assert notifications[0].data["kind"] == "automation_alert"
