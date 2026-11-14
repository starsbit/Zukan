from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select

from backend.app.config import settings
from backend.app.demo import demo_read_only_middleware, is_blocked_in_demo
from backend.app.errors.error import AppError
from backend.app.models.embeddings import MediaEmbedding  # noqa: F401
from backend.app.models.media import Media
from backend.app.repositories import media_filters
from backend.app.routers import auth as auth_router
from backend.app.schemas import NsfwFilter, SensitiveFilter, TokenResponse
from backend.app.services.auth import AuthService
from backend.app.utils.media_classification import hidden_in_demo, hides_nsfw, hides_sensitive


@pytest.fixture
def demo_mode(monkeypatch):
    monkeypatch.setattr(settings, "demo_mode", True)


@pytest.mark.parametrize(
    ("method", "path", "blocked"),
    [
        ("GET", "/api/v1/media/search", False),
        ("GET", "/api/v1/media/abc/file", False),
        ("HEAD", "/api/v1/media/abc/thumbnail", False),
        ("OPTIONS", "/api/v1/media", False),
        ("POST", "/api/v1/auth/demo", False),
        ("POST", "/api/v1/auth/refresh", False),
        ("POST", "/api/v1/auth/logout/", False),
        ("POST", "/api/v1/auth/login", True),
        ("POST", "/api/v1/auth/setup", True),
        ("POST", "/api/v1/media", True),
        ("POST", "/api/v1/media/download", True),
        ("PATCH", "/api/v1/me", True),
        ("PUT", "/api/v1/me/avatar", True),
        ("DELETE", "/api/v1/media/abc", True),
        ("GET", "/api/v1/albums/abc/download", True),
        ("GET", "/api/v1/auth/oidc/start", True),
        ("GET", "/api/v1/media/abc/library-classification-suggestions", True),
        ("GET", "/api/v1/me/import-batches", False),
    ],
)
def test_is_blocked_in_demo(method, path, blocked):
    assert is_blocked_in_demo(method, path) is blocked


def test_force_refresh_reads_are_blocked():
    path = "/api/v1/me/import-batches/abc/review-items"
    assert is_blocked_in_demo("GET", path, {"force_refresh": "true"})
    assert not is_blocked_in_demo("GET", path, {"force_refresh": "false"})


def test_middleware_rejects_writes_with_error_payload():
    app = FastAPI()
    app.middleware("http")(demo_read_only_middleware)

    @app.get("/api/v1/media")
    async def read():
        return {"ok": True}

    @app.post("/api/v1/media")
    async def write():
        return {"ok": True}

    client = TestClient(app)
    assert client.get("/api/v1/media").json() == {"ok": True}
    response = client.post("/api/v1/media", headers={"x-request-id": "rid"})
    assert response.status_code == 403
    assert response.json()["code"] == "demo_read_only"
    assert response.json()["request_id"] == "rid"


def _compiled(stmt) -> str:
    return str(stmt.compile(compile_kwargs={"literal_binds": True}))


def test_list_filters_ignore_include_in_demo(demo_mode):
    user = SimpleNamespace(show_nsfw=True, show_sensitive=True)
    stmt = media_filters.apply_nsfw_list_filter(select(Media.id), user, NsfwFilter.INCLUDE)
    stmt = media_filters.apply_sensitive_list_filter(stmt, user, SensitiveFilter.ONLY)
    sql = _compiled(stmt)
    assert "coalesce(media.is_nsfw_override, media.is_nsfw) IS false" in sql
    assert "coalesce(media.is_sensitive_override, media.is_sensitive) IS false" in sql
    assert "IS true" not in sql


def test_list_filters_respect_include_outside_demo():
    user = SimpleNamespace(show_nsfw=False, show_sensitive=False)
    stmt = media_filters.apply_nsfw_list_filter(select(Media.id), user, NsfwFilter.INCLUDE)
    assert "WHERE" not in _compiled(stmt)


def test_hide_helpers(demo_mode):
    user = SimpleNamespace(show_nsfw=True, show_sensitive=True)
    assert hides_nsfw(user) and hides_sensitive(user)
    assert hidden_in_demo(SimpleNamespace(is_nsfw=True, is_nsfw_override=None))
    assert hidden_in_demo(SimpleNamespace(is_nsfw=False, is_nsfw_override=None, is_sensitive=True))
    assert not hidden_in_demo(SimpleNamespace(is_nsfw=True, is_nsfw_override=False))


def test_hide_helpers_outside_demo():
    user = SimpleNamespace(show_nsfw=True, show_sensitive=False)
    assert not hides_nsfw(user)
    assert hides_sensitive(user)
    assert not hidden_in_demo(SimpleNamespace(is_nsfw=True))


class _ScalarDB:
    def __init__(self, value):
        self._value = value

    async def scalar(self, _stmt):
        return self._value


@pytest.mark.anyio
async def test_demo_login_disabled_outside_demo():
    with pytest.raises(AppError) as exc:
        await auth_router.demo_login(SimpleNamespace(set_cookie=lambda *a, **k: None), _ScalarDB(None))
    assert exc.value.status_code == 404


@pytest.mark.anyio
async def test_demo_login_requires_owner(demo_mode):
    with pytest.raises(AppError) as exc:
        await auth_router.demo_login(SimpleNamespace(set_cookie=lambda *a, **k: None), _ScalarDB(None))
    assert exc.value.status_code == 503


@pytest.mark.anyio
async def test_demo_login_issues_owner_session(demo_mode, monkeypatch):
    owner = SimpleNamespace(id="owner")
    issued = []

    async def _issue(self, user, remember_me=False):
        issued.append(user)
        return TokenResponse(access_token="at", refresh_token="rt")

    monkeypatch.setattr(AuthService, "issue_session", _issue)
    cookies = []
    response = SimpleNamespace(set_cookie=lambda *a, **k: cookies.append(a))
    tokens = await auth_router.demo_login(response, _ScalarDB(owner))
    assert tokens.access_token == "at"
    assert issued == [owner]
    assert cookies
