from __future__ import annotations

from contextlib import asynccontextmanager

import pytest

from backend.app.main import API_KEY_AUTH_DESCRIPTION, _augment_openapi_security, _ensure_admin_user


class _FakeResult:
    def __init__(self, value: bool) -> None:
        self._value = value

    def scalar(self) -> bool:
        return self._value


class _FakeDB:
    def __init__(self, has_admin: bool) -> None:
        self.has_admin = has_admin
        self.added = []
        self.committed = False

    async def execute(self, _query):
        return _FakeResult(self.has_admin)

    def add(self, obj) -> None:
        self.added.append(obj)

    async def commit(self) -> None:
        self.committed = True


@asynccontextmanager
async def _session_ctx(fake_db: _FakeDB):
    yield fake_db


@pytest.mark.anyio
async def test_ensure_admin_user_bootstraps_only_when_no_admin_exists(monkeypatch):
    fake_db = _FakeDB(has_admin=False)
    monkeypatch.setattr('backend.app.main.AsyncSessionLocal', lambda: _session_ctx(fake_db))

    await _ensure_admin_user()

    assert len(fake_db.added) == 1
    assert fake_db.added[0].username == 'admin'
    assert fake_db.added[0].is_admin is True
    assert fake_db.committed is True


@pytest.mark.anyio
async def test_ensure_admin_user_does_not_recreate_default_admin_when_custom_admin_exists(monkeypatch):
    fake_db = _FakeDB(has_admin=True)
    monkeypatch.setattr('backend.app.main.AsyncSessionLocal', lambda: _session_ctx(fake_db))

    await _ensure_admin_user()

    assert fake_db.added == []
    assert fake_db.committed is False


def test_augment_openapi_security_describes_api_key_on_existing_bearer_scheme():
    schema = {
        "components": {
            "securitySchemes": {
                "OAuth2PasswordBearer": {
                    "type": "oauth2",
                    "flows": {"password": {"tokenUrl": "/api/v1/auth/login", "scopes": {}}},
                }
            }
        },
        "paths": {
            "/api/v1/me": {
                "get": {"security": [{"OAuth2PasswordBearer": []}]},
            },
            "/api/v1/auth/login": {
                "post": {},
            },
        },
    }

    augmented = _augment_openapi_security(schema)

    assert API_KEY_AUTH_DESCRIPTION in augmented["components"]["securitySchemes"]["OAuth2PasswordBearer"]["description"]
    assert augmented["paths"]["/api/v1/me"]["get"]["security"] == [{"OAuth2PasswordBearer": []}]
    assert "security" not in augmented["paths"]["/api/v1/auth/login"]["post"]
