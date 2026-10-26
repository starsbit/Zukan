from __future__ import annotations
from datetime import datetime, timedelta, timezone
import pytest
from backend.app.models.notifications import AppAnnouncement, Notification, NotificationType
from backend.app.repositories.notifications import AppAnnouncementRepository, NotificationRepository

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
