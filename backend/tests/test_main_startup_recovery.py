from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from backend.app.main import _recover_pending_media_jobs, _retry_failed_media_jobs
from backend.app.models.processing import BatchStatus, ItemStatus, ProcessingStep


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
    assert enqueued_ids == [media_1.id, media_2.id, batch_item_2.media_id]


class _RetrySession:
    def __init__(self, media_rows, batch_item_rows, batch_rows):
        self._results = [
            _ScalarResult(media_rows),
            _ScalarResult(batch_item_rows),
            _ScalarResult(batch_rows),
        ]
        self.commit = AsyncMock()

    async def execute(self, stmt):
        if not self._results:
            raise AssertionError(f"Unexpected query: {stmt}")
        return self._results.pop(0)


@pytest.mark.asyncio
async def test_retry_failed_media_jobs_requeues_failed_media_and_resets_upload_items():
    batch_id = uuid.uuid4()
    media_1 = SimpleNamespace(
        id=uuid.uuid4(),
        tagging_status="failed",
        tagging_error="bad",
        tagging_started_at=object(),
        tagging_finished_at=object(),
        retry_count=2,
    )
    media_2 = SimpleNamespace(
        id=uuid.uuid4(),
        tagging_status="failed",
        tagging_error="worse",
        tagging_started_at=object(),
        tagging_finished_at=object(),
        retry_count=0,
    )
    batch_item = SimpleNamespace(
        batch_id=batch_id,
        media_id=media_1.id,
        status=ItemStatus.failed,
        step=None,
        progress_percent=100,
        error="bad",
    )
    batch = SimpleNamespace(
        id=batch_id,
        queued_items=0,
        failed_items=1,
        status=BatchStatus.failed,
        finished_at=object(),
        last_heartbeat_at=None,
    )
    session = _RetrySession(media_rows=[media_1, media_2], batch_item_rows=[batch_item], batch_rows=[batch])
    queue = AsyncMock()

    with patch("backend.app.main.AsyncSessionLocal", return_value=_SessionContext(session)):
        retried = await _retry_failed_media_jobs(queue)

    assert retried == 2
    assert media_1.tagging_status == "pending"
    assert media_1.tagging_error is None
    assert media_1.tagging_started_at is None
    assert media_1.tagging_finished_at is None
    assert media_1.retry_count == 3
    assert media_2.retry_count == 1
    assert batch_item.status == ItemStatus.pending
    assert batch_item.step == ProcessingStep.tag
    assert batch_item.progress_percent == 0
    assert batch_item.error is None
    assert batch.queued_items == 1
    assert batch.failed_items == 0
    assert batch.status == BatchStatus.running
    assert batch.finished_at is None
    assert batch.last_heartbeat_at is not None
    session.commit.assert_awaited_once()
    assert [call.args[0] for call in queue.put.await_args_list] == [media_1.id, media_2.id]
