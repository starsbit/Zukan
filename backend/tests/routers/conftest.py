from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
import uuid
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
from fastapi import HTTPException

from backend.app.database import get_db
from backend.app.errors.error import AppError
from backend.app.main import (
    app_error_handler,
    http_exception_handler,
    request_validation_error_handler,
    v1_router,
)
from backend.app.routers.deps import admin_user, current_user


class _FakeScalarResult:
    def __init__(self, value=0):
        self._value = value

    def scalar_one(self):
        return self._value

    def scalar_one_or_none(self):
        return self._value

    def scalar(self):
        return self._value

    def scalars(self):
        return self

    def all(self):
        return []


class FakeRouterDB:
    def __init__(self) -> None:
        self.added = []
        self.deleted = []
        self.commit = AsyncMock()
        self.delete = AsyncMock(side_effect=self._delete)
        self.refresh = AsyncMock(side_effect=self._refresh)

    def add(self, obj) -> None:
        self.added.append(obj)

    async def execute(self, _stmt, *args, **kwargs):
        return _FakeScalarResult(0)

    async def _delete(self, obj) -> None:
        self.deleted.append(obj)

    async def _refresh(self, obj) -> None:
        if getattr(obj, "id", None) is None:
            obj.id = uuid.uuid4()
        if getattr(obj, "created_at", None) is None:
            obj.created_at = datetime.now(timezone.utc)
        if getattr(obj, "is_active", None) is None:
            obj.is_active = True


def _build_user(*, is_admin: bool = False) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        username="api-user",
        email="api-user@example.com",
        is_admin=is_admin,
        show_nsfw=False,
        show_sensitive=False,
        tag_confidence_threshold=0.35,
        version=1,
        created_at=datetime.now(timezone.utc),
        storage_quota_mb=10240,
    )


def _build_client(*, authenticated: bool, admin: bool) -> TestClient:
    app = FastAPI()
    app.include_router(v1_router)
    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(RequestValidationError, request_validation_error_handler)
    app.add_exception_handler(HTTPException, http_exception_handler)

    fake_db = FakeRouterDB()

    async def _db_override():
        yield fake_db

    app.dependency_overrides[get_db] = _db_override

    if authenticated:
        user = _build_user(is_admin=False)
        admin_actor = _build_user(is_admin=admin)

        async def _current_user_override():
            return user

        async def _admin_user_override():
            return admin_actor

        app.dependency_overrides[current_user] = _current_user_override
        app.dependency_overrides[admin_user] = _admin_user_override

    return TestClient(app)


@pytest.fixture()
def api_client() -> TestClient:
    with _build_client(authenticated=True, admin=True) as client:
        yield client


@pytest.fixture()
def unauthenticated_client() -> TestClient:
    with _build_client(authenticated=False, admin=False) as client:
        yield client
