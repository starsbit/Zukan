from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest

from backend.app.models.auth import User
from backend.app.models.media import Media, MediaType, ProcessingStatus, TaggingStatus


class ScalarResult:
    def __init__(self, rows: list[Any] | None = None, one: Any | None = None) -> None:
        self._rows = rows or []
        self._one = one

    def scalars(self):
        return self

    def all(self):
        return self._rows

    def scalar_one(self):
        return self._one

    def scalar_one_or_none(self):
        return self._one


class RowResult:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def all(self):
        return self._rows


class _ScalarResult:
    def __init__(self, value: Any = 0) -> None:
        self._value = value

    def scalar_one(self) -> Any:
        return self._value

    def scalar_one_or_none(self) -> Any:
        return self._value

    def scalar(self) -> Any:
        return self._value

    def scalars(self) -> "_ScalarResult":
        return self

    def all(self) -> list:
        return []


class FakeAsyncSession:
    def __init__(self) -> None:
        self.added: list[Any] = []
        self.deleted: list[Any] = []
        self.commit = AsyncMock()
        self.refresh = AsyncMock()
        self.get = AsyncMock()

    async def execute(self, *args: Any, **kwargs: Any) -> _ScalarResult:
        return _ScalarResult(0)

    def add(self, obj: Any) -> None:
        self.added.append(obj)

    async def delete(self, obj: Any) -> None:
        self.deleted.append(obj)

    async def flush(self) -> None:
        for obj in self.added:
            if hasattr(obj, "id") and getattr(obj, "id") is None:
                setattr(obj, "id", uuid.uuid4())


@pytest.fixture
def fake_db() -> FakeAsyncSession:
    return FakeAsyncSession()


@pytest.fixture
def user() -> User:
    return User(
        id=uuid.uuid4(),
        username="alice",
        email="alice@example.com",
        hashed_password="x",
        is_admin=False,
        show_nsfw=False,
        show_sensitive=False,
        tag_confidence_threshold=0.35,
        version=1,
        storage_quota_mb=10240,
        created_at=datetime.now(timezone.utc),
    )


@pytest.fixture
def admin_user() -> User:
    return User(
        id=uuid.uuid4(),
        username="admin",
        email="admin@example.com",
        hashed_password="x",
        is_admin=True,
        show_nsfw=True,
        show_sensitive=False,
        tag_confidence_threshold=0.35,
        version=1,
        storage_quota_mb=10240,
        created_at=datetime.now(timezone.utc),
    )


@pytest.fixture
def media(user: User) -> Media:
    now = datetime.now(timezone.utc)
    return Media(
        id=uuid.uuid4(),
        uploader_id=user.id,
        filename="image.webp",
        original_filename="image.webp",
        filepath="/tmp/image.webp",
        file_size=123,
        sha256="a" * 64,
        mime_type="image/webp",
        media_type=MediaType.IMAGE,
        width=100,
        height=100,
        duration_seconds=None,
        frame_count=None,
        is_nsfw=False,
        tagging_status=TaggingStatus.PENDING,
        tagging_error=None,
        thumbnail_path=None,
        thumbnail_status=ProcessingStatus.PENDING,
        poster_path=None,
        poster_status=ProcessingStatus.NOT_APPLICABLE,
        captured_at=now,
        created_at=now,
        deleted_at=None,
        version=1,
        media_tags=[],
        entities=[],
        external_refs=[],
    )


@pytest.fixture
def stub_repo() -> SimpleNamespace:
    return SimpleNamespace()
