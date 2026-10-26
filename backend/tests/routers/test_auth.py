from __future__ import annotations
from datetime import datetime, timezone
import uuid
from backend.app.services.auth import AuthService

def test_login_contract(api_client, monkeypatch):
    async def _fake_login(self, username: str, password: str, remember_me: bool):
        assert username == "rin"
        assert password == "password123"
        assert remember_me is True
        return {
            "access_token": "access-token",
            "refresh_token": "refresh-token",
            "token_type": "bearer",
        }

    monkeypatch.setattr(AuthService, "login_user", _fake_login)

    response = api_client.post(
        "/api/v1/auth/login",
        data={"username": "rin", "password": "password123", "remember_me": "true"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "access_token": "access-token",
        "refresh_token": "refresh-token",
        "token_type": "bearer",
    }

def test_refresh_contract(api_client, monkeypatch):
    async def _fake_refresh(self, refresh_token: str):
        assert refresh_token == "old-refresh"
        return {
            "access_token": "new-access",
            "refresh_token": "new-refresh",
            "token_type": "bearer",
        }

    monkeypatch.setattr(AuthService, "refresh_access_token", _fake_refresh)

    response = api_client.post("/api/v1/auth/refresh", json={"refresh_token": "old-refresh"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["access_token"] == "new-access"
    assert payload["refresh_token"] == "new-refresh"

def test_logout_contract(api_client, monkeypatch):
    async def _fake_logout(self, refresh_token: str):
        assert refresh_token == "refresh-token"
        return None

    monkeypatch.setattr(AuthService, "revoke_refresh_token", _fake_logout)

    response = api_client.post("/api/v1/auth/logout", json={"refresh_token": "refresh-token"})

    assert response.status_code == 204
    assert response.content == b""
