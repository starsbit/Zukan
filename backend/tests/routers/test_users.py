from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
import uuid
from unittest.mock import AsyncMock

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient

from backend.app.database import get_db
from backend.app.errors.error import AppError
from backend.app.main import app_error_handler, http_exception_handler, request_validation_error_handler, v1_router
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


def test_get_api_key_status_contract(api_client, monkeypatch):
    async def _fake_status(self, user_id):
        return {
            "has_key": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "last_used_at": None,
        }

    monkeypatch.setattr(AuthService, "get_api_key_status", _fake_status)

    response = api_client.get("/api/v1/me/api-key")

    assert response.status_code == 200
    payload = response.json()
    assert payload["has_key"] is True
    assert payload["last_used_at"] is None


def test_create_api_key_contract(api_client, monkeypatch):
    async def _fake_create(self, user_id):
        return {
            "api_key": "zk_router_created_key",
            "has_key": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "last_used_at": None,
        }

    monkeypatch.setattr(AuthService, "create_api_key", _fake_create)

    response = api_client.post("/api/v1/me/api-key")

    assert response.status_code == 200
    payload = response.json()
    assert payload["api_key"] == "zk_router_created_key"
    assert payload["has_key"] is True


def test_me_accepts_api_key_bearer_auth(monkeypatch):
    app = FastAPI()
    app.include_router(v1_router)
    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(RequestValidationError, request_validation_error_handler)
    app.add_exception_handler(HTTPException, http_exception_handler)

    async def _db_override():
        yield SimpleNamespace()

    app.dependency_overrides[get_db] = _db_override

    async def _fake_get_user_by_id(self, user_id):
        return None

    async def _fake_get_user_by_api_key(self, raw_key):
        if raw_key != "zk_valid_key":
            return None
        return SimpleNamespace(
            id=uuid.uuid4(),
            username="api-user",
            email="api-user@example.com",
            is_admin=False,
            show_nsfw=False,
            tag_confidence_threshold=0.35,
            version=1,
            created_at=datetime.now(timezone.utc),
        )

    monkeypatch.setattr(AuthService, "get_user_by_id", _fake_get_user_by_id)
    monkeypatch.setattr(AuthService, "get_user_by_api_key", _fake_get_user_by_api_key)

    with TestClient(app) as client:
        response = client.get("/api/v1/me", headers={"Authorization": "Bearer zk_valid_key"})

    assert response.status_code == 200
    assert response.json()["username"] == "api-user"


def test_me_rejects_invalid_api_key(monkeypatch):
    app = FastAPI()
    app.include_router(v1_router)
    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(RequestValidationError, request_validation_error_handler)
    app.add_exception_handler(HTTPException, http_exception_handler)

    async def _db_override():
        yield SimpleNamespace()

    app.dependency_overrides[get_db] = _db_override

    async def _fake_get_user_by_id(self, user_id):
        return None

    async def _fake_get_user_by_api_key(self, raw_key):
        return None

    monkeypatch.setattr(AuthService, "get_user_by_id", _fake_get_user_by_id)
    monkeypatch.setattr(AuthService, "get_user_by_api_key", _fake_get_user_by_api_key)

    with TestClient(app) as client:
        response = client.get("/api/v1/me", headers={"Authorization": "Bearer zk_invalid_key"})

    assert response.status_code == 401
    assert response.json()["code"] == "invalid_token"
