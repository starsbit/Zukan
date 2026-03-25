from __future__ import annotations

from datetime import datetime, timezone
import uuid

from backend.app.services.auth import AuthService


def test_me_contract(api_client):
    response = api_client.get("/api/v1/me")

    assert response.status_code == 200
    payload = response.json()
    assert payload["username"] == "api-user"
    assert payload["email"] == "api-user@example.com"
    assert payload["is_admin"] is False


def test_me_unauthenticated_contract(unauthenticated_client):
    response = unauthenticated_client.get("/api/v1/me")

    assert response.status_code == 401
    assert response.json()["code"] == "not_authenticated"


def test_update_me_contract(api_client, monkeypatch):
    async def _fake_update(self, user, body):
        assert body.show_nsfw is True
        return {
            "id": str(uuid.uuid4()),
            "username": user.username,
            "email": user.email,
            "is_admin": user.is_admin,
            "show_nsfw": True,
            "tag_confidence_threshold": 0.75,
            "version": 2,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

    monkeypatch.setattr(AuthService, "update_current_user", _fake_update)

    response = api_client.patch("/api/v1/me", json={"show_nsfw": True, "version": 1})

    assert response.status_code == 200
    payload = response.json()
    assert payload["show_nsfw"] is True
    assert payload["version"] == 2
