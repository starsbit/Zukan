from __future__ import annotations

import asyncio
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from backend.app.ml.embedding import EMBEDDING_MODEL_VERSION
from backend.app.services.embeddings import EmbeddingLockUnavailableError, MediaEmbeddingService, _signed_lock_key


class DeadlockDetectedError(Exception):
    pass


class PostgresLikeDb:
    def __init__(self) -> None:
        self.execute = AsyncMock(return_value=SimpleNamespace(scalar_one=lambda: True))
        self.flush = AsyncMock()
        self.rollback = AsyncMock()

    def get_bind(self):
        return SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))


@pytest.mark.asyncio
async def test_embedding_service_rechecks_after_lock_and_releases_it():
    uploader_id = uuid.uuid4()
    media = SimpleNamespace(
        id=uuid.uuid4(),
        uploader_id=uploader_id,
        deleted_at=None,
        filepath="/tmp/image.webp",
        media_type="image",
    )
    existing = SimpleNamespace(model_version=EMBEDDING_MODEL_VERSION)
    backend = SimpleNamespace(compute=AsyncMock(return_value=[0.0] * 512))
    db = PostgresLikeDb()

    service = MediaEmbeddingService(db, backend=backend)  # type: ignore[arg-type]
    service._repo.get_by_media_id = AsyncMock(side_effect=[None, existing])  # type: ignore[method-assign]
    service._repo.upsert = AsyncMock()  # type: ignore[method-assign]

    result = await service.ensure_for_media(media)

    assert result is existing
    assert db.execute.await_count == 2
    _, params = db.execute.await_args_list[0].args
    assert params == {"lock_key": _signed_lock_key(uploader_id)}
    assert "pg_try_advisory_lock" in str(db.execute.await_args_list[0].args[0])
    assert "pg_advisory_unlock" in str(db.execute.await_args_list[1].args[0])
    backend.compute.assert_awaited_once()
    service._repo.upsert.assert_not_awaited()


@pytest.mark.asyncio
async def test_embedding_service_retries_transient_deadlock():
    uploader_id = uuid.uuid4()
    media = SimpleNamespace(
        id=uuid.uuid4(),
        uploader_id=uploader_id,
        deleted_at=None,
        filepath="/tmp/image.webp",
        media_type="image",
    )
    created = SimpleNamespace(model_version=EMBEDDING_MODEL_VERSION)
    backend = SimpleNamespace(compute=AsyncMock(return_value=[0.0] * 512))
    db = PostgresLikeDb()

    service = MediaEmbeddingService(db, backend=backend)  # type: ignore[arg-type]
    service._repo.get_by_media_id = AsyncMock(  # type: ignore[method-assign]
        side_effect=[None, None, None, None, created]
    )
    service._repo.upsert = AsyncMock(  # type: ignore[method-assign]
        side_effect=[DeadlockDetectedError("deadlock detected"), None]
    )

    result = await service.ensure_for_media(media)

    assert result is created
    assert db.rollback.await_count == 2
    assert backend.compute.await_count == 2
    assert service._repo.upsert.await_count == 2


@pytest.mark.asyncio
async def test_embedding_service_retries_busy_lock(monkeypatch):
    uploader_id = uuid.uuid4()
    media = SimpleNamespace(
        id=uuid.uuid4(),
        uploader_id=uploader_id,
        deleted_at=None,
        filepath="/tmp/image.webp",
        media_type="image",
    )
    created = SimpleNamespace(model_version=EMBEDDING_MODEL_VERSION)
    backend = SimpleNamespace(compute=AsyncMock(return_value=[0.0] * 512))
    db = PostgresLikeDb()
    db.execute = AsyncMock(side_effect=[
        SimpleNamespace(scalar_one=lambda: False),
        SimpleNamespace(scalar_one=lambda: True),
        SimpleNamespace(scalar_one=lambda: True),
    ])

    monkeypatch.setattr("backend.app.services.embeddings.asyncio.sleep", AsyncMock())

    service = MediaEmbeddingService(db, backend=backend)  # type: ignore[arg-type]
    service._repo.get_by_media_id = AsyncMock(side_effect=[None, None, None, created])  # type: ignore[method-assign]
    service._repo.upsert = AsyncMock()  # type: ignore[method-assign]

    result = await service.ensure_for_media(media)

    assert result is created
    assert db.rollback.await_count == 1
    assert backend.compute.await_count == 2
    assert service._repo.upsert.await_count == 1


@pytest.mark.asyncio
async def test_embedding_service_raises_when_lock_stays_busy(monkeypatch):
    media = SimpleNamespace(
        id=uuid.uuid4(),
        uploader_id=uuid.uuid4(),
        deleted_at=None,
        filepath="/tmp/image.webp",
        media_type="image",
    )
    backend = SimpleNamespace(compute=AsyncMock(return_value=[0.0] * 512))
    db = PostgresLikeDb()
    db.execute = AsyncMock(return_value=SimpleNamespace(scalar_one=lambda: False))

    monkeypatch.setattr("backend.app.services.embeddings.asyncio.sleep", AsyncMock())

    service = MediaEmbeddingService(db, backend=backend)  # type: ignore[arg-type]
    service._repo.get_by_media_id = AsyncMock(return_value=None)  # type: ignore[method-assign]
    service._repo.upsert = AsyncMock()  # type: ignore[method-assign]

    with pytest.raises(EmbeddingLockUnavailableError):
        await service.ensure_for_media(media)

    assert db.rollback.await_count == 2
    assert backend.compute.await_count == 3
    service._repo.upsert.assert_not_awaited()


@pytest.mark.asyncio
async def test_embedding_service_times_out_slow_compute(monkeypatch):
    async def never_finishes(_filepath, _media_type):
        await asyncio.Future()

    media = SimpleNamespace(
        id=uuid.uuid4(),
        uploader_id=uuid.uuid4(),
        deleted_at=None,
        filepath="/tmp/image.webp",
        media_type="image",
    )
    backend = SimpleNamespace(compute=never_finishes)
    db = PostgresLikeDb()

    monkeypatch.setattr("backend.app.services.embeddings.settings.embedding_compute_timeout_seconds", 0.001)

    service = MediaEmbeddingService(db, backend=backend)  # type: ignore[arg-type]
    service._repo.get_by_media_id = AsyncMock(return_value=None)  # type: ignore[method-assign]
    service._repo.upsert = AsyncMock()  # type: ignore[method-assign]

    with pytest.raises(TimeoutError):
        await service.ensure_for_media(media)

    db.execute.assert_not_awaited()
    service._repo.upsert.assert_not_awaited()
