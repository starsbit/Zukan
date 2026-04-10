from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
import uuid
from unittest.mock import AsyncMock, patch

import httpx

from backend.app.repositories.notifications import AppAnnouncementRepository
from backend.app.services.admin import AdminService
from backend.app.config import settings


def test_admin_stats_contract(api_client, monkeypatch):
    async def _fake_stats(self):
        return {
            "total_users": 5,
            "total_media": 20,
            "total_storage_bytes": 1234,
            "pending_tagging": 1,
            "failed_tagging": 2,
            "trashed_media": 3,
            "storage_by_user": [
                {
                    "user_id": str(uuid.uuid4()),
                    "username": "alice",
                    "media_count": 4,
                    "storage_used_bytes": 1024,
                }
            ],
        }

    monkeypatch.setattr(AdminService, "get_admin_stats", _fake_stats)

    response = api_client.get("/api/v1/admin/stats")

    assert response.status_code == 200
    assert response.json()["total_users"] == 5
    assert response.json()["storage_by_user"][0]["username"] == "alice"


def test_admin_health_contract(api_client, monkeypatch):
    now = datetime.now(timezone.utc).isoformat()

    async def _fake_health(self):
        return {
            "generated_at": now,
            "uptime_seconds": 42.5,
            "cpu_percent": 15.2,
            "memory_rss_bytes": 2048,
            "system_memory_total_bytes": 4096,
            "system_memory_used_bytes": 1024,
            "tagging_queue_depth": 3,
            "samples": [
                {
                    "captured_at": now,
                    "cpu_percent": 10.5,
                    "memory_rss_bytes": 1024,
                }
            ],
        }

    monkeypatch.setattr(AdminService, "get_health", _fake_health)

    response = api_client.get("/api/v1/admin/health")

    assert response.status_code == 200
    assert response.json()["tagging_queue_depth"] == 3


def test_admin_users_list_contract(api_client, monkeypatch):
    now = datetime.now(timezone.utc).isoformat()

    async def _fake_list(self, page, page_size, sort_by, sort_order):
        return {
            "total": 1,
            "page": page,
            "page_size": page_size,
            "items": [
                {
                    "id": str(uuid.uuid4()),
                    "username": "alice",
                    "email": "alice@example.com",
                    "is_admin": False,
                    "show_nsfw": False,
                    "show_sensitive": False,
                    "tag_confidence_threshold": 0.35,
                    "version": 1,
                    "created_at": now,
                    "media_count": 12,
                    "storage_used_mb": 2,
                    "storage_quota_mb": 10240,
                }
            ],
        }

    monkeypatch.setattr(AdminService, "list_users", _fake_list)

    response = api_client.get("/api/v1/admin/users", params={"page": 2, "page_size": 5})

    assert response.status_code == 200
    assert response.json()["page"] == 2
    assert response.json()["items"][0]["media_count"] == 12


def test_admin_user_detail_contract(api_client, monkeypatch):
    user_id = uuid.uuid4()

    async def _fake_detail(self, requested_user_id):
        now = datetime.now(timezone.utc).isoformat()
        return {
            "id": str(requested_user_id),
            "username": "alice",
            "email": "alice@example.com",
            "is_admin": False,
            "show_nsfw": False,
            "show_sensitive": False,
            "tag_confidence_threshold": 0.35,
            "version": 1,
            "created_at": now,
            "media_count": 12,
            "storage_used_mb": 2,
            "storage_quota_mb": 10240,
        }

    monkeypatch.setattr(AdminService, "get_user_detail", _fake_detail)

    response = api_client.get(f"/api/v1/admin/users/{user_id}")

    assert response.status_code == 200
    assert response.json()["media_count"] == 12


def test_admin_update_user_contract(api_client, monkeypatch):
    user_id = uuid.uuid4()

    async def _fake_update(self, actor, requested_user_id, body):
        now = datetime.now(timezone.utc).isoformat()
        return {
            "id": str(requested_user_id),
            "username": body.username or "alice",
            "email": "alice@example.com",
            "is_admin": True,
            "show_nsfw": True,
            "show_sensitive": True,
            "tag_confidence_threshold": 0.9,
            "version": 2,
            "created_at": now,
            "storage_quota_mb": 10240,
            "storage_used_mb": 0,
        }

    monkeypatch.setattr(AdminService, "update_user", _fake_update)

    response = api_client.patch(
        f"/api/v1/admin/users/{user_id}",
        json={"username": "alice-renamed", "is_admin": True, "show_nsfw": True, "tag_confidence_threshold": 0.9, "password": "newpassword123"},
    )

    assert response.status_code == 200
    assert response.json()["is_admin"] is True
    assert response.json()["username"] == "alice-renamed"


def test_admin_delete_user_media_contract(api_client, monkeypatch):
    async def _fake_delete_media(self, actor, user_id):
        return 4

    monkeypatch.setattr(AdminService, "delete_user_media", _fake_delete_media)

    response = api_client.delete(f"/api/v1/admin/users/{uuid.uuid4()}/media")

    assert response.status_code == 200
    assert response.json() == {"deleted": 4}


def test_admin_delete_user_contract(api_client, monkeypatch):
    async def _fake_delete(self, actor, user_id, delete_media):
        assert delete_media is True
        return None

    monkeypatch.setattr(AdminService, "delete_user", _fake_delete)

    response = api_client.delete(f"/api/v1/admin/users/{uuid.uuid4()}", params={"delete_media": True})

    assert response.status_code == 204
    assert response.content == b""


def test_admin_retag_contract(api_client, monkeypatch):
    async def _fake_retag(self, user_id):
        return 9

    monkeypatch.setattr(AdminService, "retag_all_media", _fake_retag)

    response = api_client.post(f"/api/v1/admin/users/{uuid.uuid4()}/tagging-jobs")

    assert response.status_code == 202
    assert response.json() == {"queued": 9}


def test_admin_list_announcements_contract(api_client, monkeypatch):
    now = datetime.now(timezone.utc)

    async def _fake_list(self, offset, limit):
        return [
            SimpleNamespace(
                id=uuid.uuid4(),
                version="1.0.0",
                title="Notice",
                message="Planned maintenance",
                severity="info",
                starts_at=None,
                ends_at=None,
                is_active=True,
                created_at=now,
            )
        ]

    monkeypatch.setattr(AppAnnouncementRepository, "list_all", _fake_list)

    response = api_client.get("/api/v1/admin/announcements")

    assert response.status_code == 200
    assert response.json()[0]["title"] == "Notice"


def test_admin_create_announcement_contract(api_client):
    with patch("backend.app.routers.admin.NotificationService") as notification_service_cls:
        notification_service_cls.return_value.publish_announcement = AsyncMock(return_value=3)

        response = api_client.post(
            "/api/v1/admin/announcements",
            json={
                "version": "1.1.0",
                "title": "Upgrade",
                "message": "New backend release",
                "severity": "warning",
                "starts_at": None,
                "ends_at": None,
            },
        )

    assert response.status_code == 201
    payload = response.json()
    assert payload["title"] == "Upgrade"
    assert payload["severity"] == "warning"
    notification_service_cls.return_value.publish_announcement.assert_awaited_once()


def test_admin_create_service_notification_contract(api_client):
    with patch("backend.app.routers.admin.NotificationService") as notification_service_cls:
        notification_service_cls.return_value.publish_admin_notification = AsyncMock(return_value=2)

        response = api_client.post(
            "/api/v1/admin/service-notifications",
            json={
                "title": "Automation alert",
                "body": "Background sync failed",
                "link_url": None,
                "data": {"kind": "automation_alert", "category": "sync_error"},
            },
        )

    assert response.status_code == 201
    assert response.json() == {"notified": 2}
    notification_service_cls.return_value.publish_admin_notification.assert_awaited_once()


def test_admin_app_config_contract(api_client):
    response = api_client.get("/api/v1/admin/app-config")

    assert response.status_code == 200
    payload = response.json()
    assert payload["auth_login_rate_limit_requests"] >= 0
    assert payload["upload_rate_limit_window_seconds"] >= 0


def test_admin_trigger_update_returns_202(api_client):
    with patch("backend.app.routers.admin.trigger_watchtower_update", new=AsyncMock()) as trigger_update_mock:
        response = api_client.post("/api/v1/admin/update")

    assert response.status_code == 202
    assert response.json() == {"message": "Update initiated"}
    trigger_update_mock.assert_awaited_once()


def test_admin_trigger_update_returns_503_when_watchtower_is_unreachable(api_client):
    with patch(
        "backend.app.routers.admin.trigger_watchtower_update",
        new=AsyncMock(side_effect=httpx.ConnectError("boom")),
    ):
        response = api_client.post("/api/v1/admin/update")

    assert response.status_code == 503
    assert "Watchtower updater" in response.json()["detail"]


def test_admin_trigger_update_requires_auth(unauthenticated_client):
    response = unauthenticated_client.post("/api/v1/admin/update")

    assert response.status_code == 401


def test_admin_app_config_patch_updates_runtime_settings(api_client, monkeypatch):
    original_login_limit = settings.auth_login_rate_limit_requests
    original_upload_limit = settings.upload_rate_limit_requests
    monkeypatch.setattr(settings, "auth_login_rate_limit_requests", original_login_limit)
    monkeypatch.setattr(settings, "upload_rate_limit_requests", original_upload_limit)

    response = api_client.patch(
        "/api/v1/admin/app-config",
        json={
            "auth_login_rate_limit_requests": 0,
            "upload_rate_limit_requests": 0,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["auth_login_rate_limit_requests"] == 0
    assert payload["upload_rate_limit_requests"] == 0
