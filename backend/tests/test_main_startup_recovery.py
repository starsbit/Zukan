from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from backend.app.main import _recover_pending_media_jobs
from backend.app.models.processing import ItemStatus


class _ScalarResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return self._rows


class _Session:
    def __init__(self, media_rows, batch_item_rows):
        self._media_rows = media_rows
        self._batch_item_rows = batch_item_rows
        self.commit = AsyncMock()

    async def execute(self, stmt):
        text = str(stmt)
        if "FROM media" in text:
            return _ScalarResult(self._media_rows)
        if "FROM import_batch_items" in text:
            return _ScalarResult(self._batch_item_rows)
        raise AssertionError(f"Unexpected query: {text}")


class _SessionContext:
    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, exc_type, exc, tb):
        return False


@pytest.mark.asyncio
async def test_recover_pending_media_jobs_requeues_unfinished_work():
    media_1 = SimpleNamespace(id=uuid.uuid4(), tagging_status="processing")
    media_2 = SimpleNamespace(id=uuid.uuid4(), tagging_status="pending")
    # Duplicate media id across sources should only be enqueued once.
    batch_item_1 = SimpleNamespace(media_id=media_1.id, status=ItemStatus.processing)
    batch_item_2 = SimpleNamespace(media_id=uuid.uuid4(), status=ItemStatus.pending)

    session = _Session(media_rows=[media_1, media_2], batch_item_rows=[batch_item_1, batch_item_2])
    queue = AsyncMock()

    with patch("backend.app.main.AsyncSessionLocal", return_value=_SessionContext(session)):
        resumed = await _recover_pending_media_jobs(queue)

    assert resumed == 3
    assert media_1.tagging_status == "pending"
    assert batch_item_1.status == ItemStatus.pending
    session.commit.assert_awaited_once()
    enqueued_ids = [call.args[0] for call in queue.put.await_args_list]
    assert enqueued_ids == [media_1.id, batch_item_2.media_id, media_2.id]
