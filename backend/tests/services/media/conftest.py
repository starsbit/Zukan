from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest

from backend.app.models.auth import User
from backend.app.models.media import Media, MediaType, ProcessingStatus, TaggingStatus


class FakeAsyncSession:
    def __init__(self) -> None:
        self.added: list[Any] = []
        self.deleted: list[Any] = []
        self.commit = AsyncMock()
        self.execute = AsyncMock()
        self.get = AsyncMock()

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
    )


@pytest.fixture
def admin_user() -> User:
    return User(
        id=uuid.uuid4(),
        username="admin",
        email="admin@example.com",
        hashed_password="x",
        is_admin=True,
        show_nsfw=False,
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
def stub_query() -> SimpleNamespace:
    return SimpleNamespace(
        get_active_media=AsyncMock(),
        get_favorite=AsyncMock(),
        get_active_media_ids=AsyncMock(),
        get_existing_favorites=AsyncMock(),
        get_owned_or_admin_media=AsyncMock(),
        get_expired_trash=AsyncMock(),
        list_trashed_media_for_user=AsyncMock(),
        get_media_by_ids=AsyncMock(),
        get_media_by_sha256=AsyncMock(),
        get_media_by_id=AsyncMock(),
        get_media_with_relations=AsyncMock(),
        build_media_detail=AsyncMock(),
        get_media_entities=AsyncMock(),
        get_media_external_refs=AsyncMock(),
        get_upload_batch_item_for_media=AsyncMock(),
        get_import_batch=AsyncMock(),
        get_import_batch_statuses=AsyncMock(),
    )
