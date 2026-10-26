from __future__ import annotations
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
import pytest
from backend.app.errors.error import AppError
from backend.app.models.library_classification import LibraryClassificationFeedbackAction
from backend.app.services.admin import AdminService
from backend.tests.services.conftest import RowResult

@pytest.mark.asyncio
async def test_get_admin_stats_returns_repo_counts(fake_db):
    service = AdminService(fake_db)
    with patch('backend.app.services.admin.MediaRepository') as media_repo_cls:
        media_repo = media_repo_cls.return_value
        media_repo.count_active = AsyncMock(return_value=7)
        media_repo.sum_file_size = AsyncMock(return_value=99)
        media_repo.count_by_tagging_status = AsyncMock(side_effect=[2, 1])
        media_repo.count_trashed = AsyncMock(return_value=4)
        stats = await service.get_admin_stats()
    assert stats.total_media == 7
    assert stats.total_storage_bytes == 99
    assert stats.pending_tagging == 2
    assert stats.failed_tagging == 1
    assert stats.trashed_media == 4

@pytest.mark.asyncio
async def test_retag_all_media_marks_pending_and_queues(fake_db, user):
    service = AdminService(fake_db)
    media1 = SimpleNamespace(id=uuid.uuid4(), tagging_status='done')
    media2 = SimpleNamespace(id=uuid.uuid4(), tagging_status='failed')
    queue = SimpleNamespace(put=AsyncMock())
    with patch('backend.app.services.admin.MediaRepository') as media_repo_cls, patch('backend.app.services.admin.get_tag_queue', return_value=queue):
        media_repo_cls.return_value.get_active_media = AsyncMock(return_value=[media1, media2])
        count = await service.retag_all_media()
    assert count == 2
    assert media1.tagging_status == 'pending'
    assert media2.tagging_status == 'pending'
    assert queue.put.await_count == 2

@pytest.mark.asyncio
async def test_get_health_returns_monitor_payload(fake_db):
    service = AdminService(fake_db)
    sample_time = datetime.now(UTC)
    sample = SimpleNamespace(captured_at=sample_time, cpu_percent=12.5, memory_rss_bytes=2048)
    queue = SimpleNamespace(qsize=lambda: 3)

    with patch("backend.app.services.admin.health_monitor") as monitor, patch(
        "backend.app.services.admin.get_tag_queue", return_value=queue
    ):
        monitor.capture_sample.return_value = sample
        monitor.uptime_seconds.return_value = 15.2
        monitor.system_memory.return_value = (8192, 4096)
        monitor.samples.return_value = [sample]

        health = await service.get_health()

    assert health.cpu_percent == 12.5
    assert health.memory_rss_bytes == 2048
    assert health.tagging_queue_depth == 3
    assert health.samples[0].captured_at == sample_time

@pytest.mark.asyncio
async def test_get_library_classification_metrics_summarizes_feedback(fake_db, user):
    service = AdminService(fake_db)
    fake_db.execute = AsyncMock(return_value=RowResult([('prototype', LibraryClassificationFeedbackAction.accepted, 8), ('prototype', LibraryClassificationFeedbackAction.rejected, 2), ('exact_phash', LibraryClassificationFeedbackAction.auto_applied, 3)]))
    metrics = await service.get_library_classification_metrics(model_version='clip_onnx_v1')
    assert metrics.model_version == 'clip_onnx_v1'
    assert metrics.reviewed == 10
    assert metrics.accepted == 8
    assert metrics.rejected == 2
    assert metrics.auto_applied == 3
    assert metrics.acceptance_rate == 0.8
    assert metrics.rejection_rate == 0.2
    assert metrics.by_source[0].source == 'prototype'
    assert metrics.by_source[0].acceptance_rate == 0.8
