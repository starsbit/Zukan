from __future__ import annotations

from datetime import datetime, timezone
import uuid

from backend.app.services.notifications import NotificationService


def test_list_notifications_contract(api_client, monkeypatch):
    async def _fake_list(self, user_id, after, page_size, is_read):
        return {
            "total": 1,
            "next_cursor": None,
            "has_more": False,
            "page_size": page_size,
            "items": [
                {
                    "id": str(uuid.uuid4()),
                    "user_id": str(user_id),
                    "type": "share_invite",
                    "title": "Album invite",
                    "body": "Accept to join as viewer.",
                    "is_read": False,
                    "link_url": "/album/123",
                    "data": {
                        "album_id": "123",
                        "album_name": "Trip",
                        "role": "viewer",
                        "invited_by_user_id": str(uuid.uuid4()),
                        "invited_by_username": "owner",
                        "invite_status": "pending",
                        "invite_id": str(uuid.uuid4()),
                    },
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
            ],
        }

    monkeypatch.setattr(NotificationService, "list_notifications", _fake_list)

    response = api_client.get("/api/v1/me/notifications", params={"page_size": 4, "is_read": False})

    assert response.status_code == 200
    assert response.json()["items"][0]["type"] == "share_invite"
    assert response.json()["items"][0]["data"]["invite_status"] == "pending"


def test_mark_notification_read_contract(api_client, monkeypatch):
    async def _fake_mark(self, notification_id, user_id):
        return {
            "id": str(notification_id),
            "user_id": str(user_id),
            "type": "batch_done",
            "title": "Batch complete",
            "body": "Your upload batch finished",
            "is_read": True,
            "link_url": None,
            "data": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

    monkeypatch.setattr(NotificationService, "mark_read", _fake_mark)

    response = api_client.patch(f"/api/v1/me/notifications/{uuid.uuid4()}/read")

    assert response.status_code == 200
    assert response.json()["is_read"] is True


def test_mark_all_notifications_read_contract(api_client, monkeypatch):
    async def _fake_mark_all(self, user_id):
        return None

    monkeypatch.setattr(NotificationService, "mark_all_read", _fake_mark_all)

    response = api_client.post("/api/v1/me/notifications/read-all")

    assert response.status_code == 204
    assert response.content == b""


def test_delete_notification_contract(api_client, monkeypatch):
    async def _fake_delete(self, notification_id, user_id):
        return None

    monkeypatch.setattr(NotificationService, "delete_notification", _fake_delete)

    response = api_client.delete(f"/api/v1/me/notifications/{uuid.uuid4()}")

    assert response.status_code == 204
    assert response.content == b""


def test_accept_notification_invite_contract(api_client, monkeypatch):
    async def _fake_accept(self, notification_id, user_id):
        return {
            "id": str(notification_id),
            "user_id": str(user_id),
            "type": "share_invite",
            "title": "Album invite",
            "body": "Joined album",
            "is_read": True,
            "link_url": "/album/123",
            "data": {
                "album_id": "123",
                "album_name": "Trip",
                "role": "viewer",
                "invited_by_user_id": str(uuid.uuid4()),
                "invited_by_username": "owner",
                "invite_status": "accepted",
                "invite_id": str(uuid.uuid4()),
            },
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

    monkeypatch.setattr(NotificationService, "accept_invite", _fake_accept)

    response = api_client.post(f"/api/v1/me/notifications/{uuid.uuid4()}/accept")

    assert response.status_code == 200
    assert response.json()["data"]["invite_status"] == "accepted"


def test_reject_notification_invite_contract(api_client, monkeypatch):
    async def _fake_reject(self, notification_id, user_id):
        return {
            "id": str(notification_id),
            "user_id": str(user_id),
            "type": "share_invite",
            "title": "Album invite",
            "body": "Declined album",
            "is_read": True,
            "link_url": "/album/123",
            "data": {
                "album_id": "123",
                "album_name": "Trip",
                "role": "viewer",
                "invited_by_user_id": str(uuid.uuid4()),
                "invited_by_username": "owner",
                "invite_status": "rejected",
                "invite_id": str(uuid.uuid4()),
            },
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

    monkeypatch.setattr(NotificationService, "reject_invite", _fake_reject)

    response = api_client.post(f"/api/v1/me/notifications/{uuid.uuid4()}/reject")

    assert response.status_code == 200
    assert response.json()["data"]["invite_status"] == "rejected"
