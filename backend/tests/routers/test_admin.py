from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
import uuid

from backend.app.repositories.notifications import AppAnnouncementRepository
from backend.app.services.admin import AdminService


def test_admin_stats_contract(api_client, monkeypatch):
    async def _fake_stats(self):
        return {
            "total_users": 5,
            "total_media": 20,
            "total_storage_bytes": 1234,
            "pending_tagging": 1,
            "failed_tagging": 2,
            "trashed_media": 3,
        }

    monkeypatch.setattr(AdminService, "get_admin_stats", _fake_stats)

    response = api_client.get("/api/v1/admin/stats")

    assert response.status_code == 200
    assert response.json()["total_users"] == 5


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
                    "tag_confidence_threshold": 0.35,
                    "version": 1,
                    "created_at": now,
                }
            ],
        }

    monkeypatch.setattr(AdminService, "list_users", _fake_list)

    response = api_client.get("/api/v1/admin/users", params={"page": 2, "page_size": 5})

    assert response.status_code == 200
    assert response.json()["page"] == 2


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
            "tag_confidence_threshold": 0.35,
            "version": 1,
            "created_at": now,
            "media_count": 12,
            "storage_used_bytes": 2048,
        }

    monkeypatch.setattr(AdminService, "get_user_detail", _fake_detail)

    response = api_client.get(f"/api/v1/admin/users/{user_id}")

    assert response.status_code == 200
    assert response.json()["media_count"] == 12


def test_admin_update_user_contract(api_client, monkeypatch):
    user_id = uuid.uuid4()

    async def _fake_update(self, requested_user_id, body):
        now = datetime.now(timezone.utc).isoformat()
        return {
            "id": str(requested_user_id),
            "username": "alice",
            "email": "alice@example.com",
            "is_admin": True,
            "show_nsfw": True,
            "tag_confidence_threshold": 0.9,
            "version": 2,
            "created_at": now,
        }

    monkeypatch.setattr(AdminService, "update_user", _fake_update)

    response = api_client.patch(
        f"/api/v1/admin/users/{user_id}",
        json={"is_admin": True, "show_nsfw": True, "tag_confidence_threshold": 0.9},
    )

    assert response.status_code == 200
    assert response.json()["is_admin"] is True


def test_admin_delete_user_contract(api_client, monkeypatch):
    async def _fake_delete(self, user_id, delete_media):
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
