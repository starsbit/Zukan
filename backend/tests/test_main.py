from __future__ import annotations

from contextlib import asynccontextmanager

import pytest

from backend.app.main import (
    API_KEY_AUTH_DESCRIPTION,
    OPENAPI_SERVERS,
    _MlStartupState,
    _augment_openapi_security,
    _ensure_admin_user,
    _initialize_ml_services,
    ml_startup_state,
)
from backend.app.logging_config import configure_logging


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


def test_openapi_servers_default_to_current_origin_first():
    assert OPENAPI_SERVERS[0]["url"] == "/"


@pytest.mark.anyio
async def test_ml_startup_state_wait_returns_after_ready():
    state = _MlStartupState()

    state.mark_ready()

    await state.wait_until_ready()


@pytest.mark.anyio
async def test_ml_startup_state_wait_raises_after_failure():
    state = _MlStartupState()
    error = RuntimeError("tagger failed")

    state.mark_failed(error)

    with pytest.raises(RuntimeError, match="ML services failed to initialize") as exc_info:
        await state.wait_until_ready()

    assert exc_info.value.__cause__ is error


@pytest.mark.anyio
async def test_initialize_ml_services_marks_state_ready(monkeypatch):
    calls: list[str] = []
    ml_startup_state.reset()

    async def fake_to_thread(func, *args, **kwargs):
        calls.append(func.__name__)
        return func(*args, **kwargs)

    monkeypatch.setattr("backend.app.main.asyncio.to_thread", fake_to_thread)
    monkeypatch.setattr("backend.app.main.tagger.load", lambda: calls.append("tagger.load"))
    monkeypatch.setattr("backend.app.main.ocr_backend.load", lambda: calls.append("ocr_backend.load"))

    await _initialize_ml_services()
    await ml_startup_state.wait_until_ready()

    assert calls == ["<lambda>", "tagger.load", "<lambda>", "ocr_backend.load"]
    ml_startup_state.reset()


@pytest.mark.anyio
async def test_initialize_ml_services_marks_state_failed(monkeypatch):
    failure = RuntimeError("download failed")
    ml_startup_state.reset()

    async def fake_to_thread(func, *args, **kwargs):
        return func(*args, **kwargs)

    monkeypatch.setattr("backend.app.main.asyncio.to_thread", fake_to_thread)

    def fail_load():
        raise failure

    monkeypatch.setattr("backend.app.main.tagger.load", fail_load)

    await _initialize_ml_services()

    with pytest.raises(RuntimeError, match="ML services failed to initialize") as exc_info:
        await ml_startup_state.wait_until_ready()

    assert exc_info.value.__cause__ is failure
    ml_startup_state.reset()


def test_configure_logging_wires_backend_and_uvicorn_loggers_to_console():
    configure_logging("warning")

    backend_logger = __import__("logging").getLogger("backend")
    uvicorn_access_logger = __import__("logging").getLogger("uvicorn.access")

    assert backend_logger.level == __import__("logging").WARNING
    assert backend_logger.propagate is False
    assert backend_logger.handlers
    assert uvicorn_access_logger.level == __import__("logging").WARNING
    assert uvicorn_access_logger.propagate is False
    assert uvicorn_access_logger.handlers
