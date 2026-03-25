from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from backend.app.errors.error import AppError
from backend.app.models.auth import User
from backend.app.schemas import AdminUserUpdate
from backend.app.services.admin import AdminService


@pytest.mark.asyncio
async def test_get_admin_stats_returns_repo_counts(fake_db):
    service = AdminService(fake_db)

    with patch("backend.app.services.admin.UserRepository") as user_repo_cls, patch(
        "backend.app.services.admin.MediaRepository"
    ) as media_repo_cls:
        user_repo_cls.return_value.count = AsyncMock(return_value=3)
        media_repo = media_repo_cls.return_value
        media_repo.count_active = AsyncMock(return_value=7)
        media_repo.sum_file_size = AsyncMock(return_value=99)
        media_repo.count_by_tagging_status = AsyncMock(side_effect=[2, 1])
        media_repo.count_trashed = AsyncMock(return_value=4)

        stats = await service.get_admin_stats()

    assert stats.total_users == 3
    assert stats.total_media == 7
    assert stats.total_storage_bytes == 99
    assert stats.pending_tagging == 2
    assert stats.failed_tagging == 1
    assert stats.trashed_media == 4


@pytest.mark.asyncio
async def test_get_user_detail_raises_when_user_missing(fake_db):
    service = AdminService(fake_db)
    user_id = uuid.uuid4()

    with patch("backend.app.services.admin.UserRepository") as user_repo_cls:
        user_repo_cls.return_value.get_by_id = AsyncMock(return_value=None)
        with pytest.raises(AppError) as exc:
            await service.get_user_detail(user_id)

    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_update_user_persists_selected_fields(fake_db, user):
    service = AdminService(fake_db)
    payload = AdminUserUpdate(is_admin=True, show_nsfw=True, tag_confidence_threshold=0.7)

    with patch("backend.app.services.admin.UserRepository") as user_repo_cls:
        user_repo_cls.return_value.get_by_id = AsyncMock(return_value=user)
        updated = await service.update_user(user.id, payload)

    assert updated.is_admin is True
    assert updated.show_nsfw is True
    assert updated.tag_confidence_threshold == 0.7
    fake_db.commit.assert_awaited_once()
    fake_db.refresh.assert_awaited_once_with(user)


@pytest.mark.asyncio
async def test_delete_user_with_media_purge(fake_db, user):
    service = AdminService(fake_db)
    media_rows = [SimpleNamespace(id=uuid.uuid4()), SimpleNamespace(id=uuid.uuid4())]

    with patch("backend.app.services.admin.UserRepository") as user_repo_cls, patch(
        "backend.app.services.admin.MediaRepository"
    ) as media_repo_cls, patch("backend.app.services.admin.MediaLifecycleService") as lifecycle_cls:
        user_repo_cls.return_value.get_by_id = AsyncMock(return_value=user)
        media_repo_cls.return_value.get_by_uploader = AsyncMock(return_value=media_rows)
        lifecycle = lifecycle_cls.return_value
        lifecycle.purge_media_record = AsyncMock()

        await service.delete_user(user.id, delete_media=True)

    assert lifecycle.purge_media_record.await_count == 2
    assert fake_db.deleted == [user]
    fake_db.commit.assert_awaited()


@pytest.mark.asyncio
async def test_retag_all_media_marks_pending_and_queues(fake_db, user):
    service = AdminService(fake_db)
    media1 = SimpleNamespace(id=uuid.uuid4(), tagging_status="done")
    media2 = SimpleNamespace(id=uuid.uuid4(), tagging_status="failed")
    queue = AsyncMock()

    with patch("backend.app.services.admin.MediaRepository") as media_repo_cls, patch(
        "backend.app.services.admin.get_tag_queue", return_value=queue
    ):
        media_repo_cls.return_value.get_active_by_uploader = AsyncMock(return_value=[media1, media2])

        count = await service.retag_all_media(user.id)

    assert count == 2
    assert media1.tagging_status == "pending"
    assert media2.tagging_status == "pending"
    assert queue.put.await_count == 2
