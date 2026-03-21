import asyncio
import uuid

from backend.app.models import Media, User
from backend.app.services import admin as admin_service
from backend.app.services import media as media_service


def test_get_admin_stats_reports_totals(api):
    user = api.register_and_login("admin-service-stats")
    blue = api.upload_media(user["access_token"], "stats-blue.png", (0, 0, 255))
    red = api.upload_media(user["access_token"], "stats-red.png", (255, 0, 0))
    api.wait_for_media_status(str(blue["id"]))
    api.wait_for_media_status(str(red["id"]))

    trashed = api.client.patch(
        f"/media/{red['id']}",
        headers=api.auth_headers(user["access_token"]),
        json={"deleted": True},
    )
    assert trashed.status_code == 200

    async def _exercise(session):
        stats = await admin_service.get_admin_stats(session)
        assert stats.total_users >= 2
        assert stats.total_media >= 1
        assert stats.trashed_media >= 1
        assert stats.total_storage_bytes > 0

    api.run_db(_exercise)


def test_retag_all_media_only_queues_active_media(api):
    user = api.register_and_login("admin-service-retag")
    active = api.upload_media(user["access_token"], "active-blue.png", (0, 0, 255))
    trashed = api.upload_media(user["access_token"], "trashed-green.png", (0, 255, 0))
    api.wait_for_media_status(str(active["id"]))
    api.wait_for_media_status(str(trashed["id"]))
    user_id = uuid.UUID(user["user"]["id"])
    active_id = uuid.UUID(str(active["id"]))
    trashed_id = uuid.UUID(str(trashed["id"]))

    deleted = api.client.patch(
        f"/media/{trashed['id']}",
        headers=api.auth_headers(user["access_token"]),
        json={"deleted": True},
    )
    assert deleted.status_code == 200

    queue = asyncio.Queue()
    media_service.set_tag_queue(queue)

    async def _exercise(session):
        queued = await admin_service.retag_all_media(session, user_id)
        assert queued == 1

        active_media = await session.get(Media, active_id)
        trashed_media = await session.get(Media, trashed_id)
        assert active_media.tagging_status == "pending"
        assert trashed_media.tagging_status == "done"

    api.run_db(_exercise)
    assert queue.get_nowait() == active_id


def test_delete_user_with_delete_media_removes_owned_media(api):
    user = api.register_and_login("admin-service-delete")
    uploaded = api.upload_media(user["access_token"], "delete-owned-image.png", (0, 0, 255))
    api.wait_for_media_status(str(uploaded["id"]))
    user_id = uuid.UUID(user["user"]["id"])
    uploaded_id = uuid.UUID(str(uploaded["id"]))

    async def _exercise(session):
        await admin_service.delete_user(session, user_id, delete_media=True)
        assert await session.get(User, user_id) is None
        assert await session.get(Media, uploaded_id) is None

    api.run_db(_exercise)


def test_admin_service_lists_users_and_updates_user_settings(api):
    user = api.register_and_login("admin-service-detail")
    uploaded = api.upload_media(user["access_token"], "detail-blue.png", (0, 0, 255))
    api.wait_for_media_status(str(uploaded["id"]))

    user_id = uuid.UUID(user["user"]["id"])

    async def _exercise(session):
        from backend.app.schemas import AdminUserUpdate

        users = await admin_service.list_users(session, page=1, page_size=20)
        assert any(item.id == user_id for item in users.items)

        detail = await admin_service.get_user_detail(session, user_id)
        assert detail.id == user_id
        assert detail.media_count >= 1
        assert detail.storage_used_bytes > 0

        updated = await admin_service.update_user(session, user_id, AdminUserUpdate(show_nsfw=True))
        assert updated.show_nsfw is True

    api.run_db(_exercise)
