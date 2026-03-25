from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from backend.app.models.notifications import AppAnnouncement, Notification, NotificationType
from backend.app.repositories.notifications import AppAnnouncementRepository, NotificationRepository


@pytest.mark.asyncio
async def test_notification_repository_filters(db_session, make_user):
    user = await make_user()
    other = await make_user()

    n1 = Notification(user_id=user.id, type=NotificationType.app_update, title="a", body="a", is_read=False)
    n2 = Notification(user_id=user.id, type=NotificationType.batch_done, title="b", body="b", is_read=True)
    n3 = Notification(user_id=other.id, type=NotificationType.batch_failed, title="c", body="c", is_read=False)
    db_session.add_all([n1, n2, n3])
    await db_session.flush()

    repo = NotificationRepository(db_session)
    assert await repo.get_by_id(n1.id) is not None
    assert await repo.get_by_id_for_user(n1.id, user.id) is not None
    assert await repo.get_by_id_for_user(n1.id, other.id) is None
    assert len(await repo.list_for_user(user.id, offset=0, limit=10)) == 2
    assert len(await repo.list_for_user(user.id, is_read=False, offset=0, limit=10)) == 1
    assert await repo.count_for_user(user.id) == 2
    assert await repo.count_for_user(user.id, is_read=False) == 1
    unread = await repo.get_unread_for_user(user.id)
    assert [n.id for n in unread] == [n1.id]


@pytest.mark.asyncio
async def test_app_announcement_repository_queries(db_session):
    now = datetime.now(timezone.utc)
    a1 = AppAnnouncement(title="active", message="x", is_active=True, starts_at=now - timedelta(days=1), ends_at=now + timedelta(days=1))
    a2 = AppAnnouncement(title="inactive", message="x", is_active=False, starts_at=None, ends_at=None)
    db_session.add_all([a1, a2])
    await db_session.flush()

    repo = AppAnnouncementRepository(db_session)
    assert (await repo.get_by_id(a1.id)).id == a1.id
    active = await repo.list_active(now)
    assert [a.id for a in active] == [a1.id]
    assert len(await repo.list_all(offset=0, limit=10)) == 2
    assert await repo.count() == 2
