from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from backend.app.ml.embedding import EMBEDDING_MODEL_VERSION
from backend.app.services.embeddings import MediaEmbeddingService, _signed_lock_key


class PostgresLikeDb:
    def __init__(self) -> None:
        self.execute = AsyncMock()
        self.flush = AsyncMock()

    def get_bind(self):
        return SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))


@pytest.mark.asyncio
async def test_embedding_service_serializes_writes_and_rechecks_after_lock():
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
    db.execute.assert_awaited_once()
    _, params = db.execute.await_args.args
    assert params == {"lock_key": _signed_lock_key(uploader_id)}
    backend.compute.assert_not_awaited()
    service._repo.upsert.assert_not_awaited()
