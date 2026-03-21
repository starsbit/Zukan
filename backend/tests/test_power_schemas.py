import uuid
from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from backend.app.schemas import (
    AlbumMediaBatchUpdate,
    AdminStatsResponse,
    AdminUserUpdate,
    BulkResult,
    DownloadRequest,
    MediaBatchDelete,
    MediaBatchUpdate,
    MediaMetadataFilter,
)


def _now():
    return datetime.now(timezone.utc)


def _media_data(**overrides):
    now = _now()
    data = dict(
        id=uuid.uuid4(),
        uploader_id=uuid.uuid4(),
        filename="a.jpg",
        original_filename="a.jpg",
        metadata={
            "file_size": 100,
            "width": 10,
            "height": 10,
            "mime_type": "image/jpeg",
            "captured_at": now,
        },
        tags=[],
        is_nsfw=False,
        tagging_status="done",
        thumbnail_status="done",
        created_at=now,
        deleted_at=None,
    )
    data.update(overrides)
    return data


# --- MediaBatchUpdate ---

def test_image_batch_update_valid():
    ids = [uuid.uuid4(), uuid.uuid4()]
    m = MediaBatchUpdate(media_ids=ids, deleted=True)
    assert len(m.media_ids) == 2


def test_image_batch_update_empty_rejected():
    with pytest.raises(ValidationError):
        MediaBatchUpdate(media_ids=[], deleted=True)


def test_image_batch_update_requires_mutation():
    with pytest.raises(ValidationError):
        MediaBatchUpdate(media_ids=[uuid.uuid4()])


def test_image_batch_update_max_500():
    with pytest.raises(ValidationError):
        MediaBatchUpdate(media_ids=[uuid.uuid4() for _ in range(501)], favorited=True)


def test_image_batch_update_exactly_500():
    m = MediaBatchUpdate(media_ids=[uuid.uuid4() for _ in range(500)], favorited=False)
    assert len(m.media_ids) == 500


# --- AlbumMediaBatchUpdate / MediaBatchDelete ---

def test_album_image_batch_update_valid():
    m = AlbumMediaBatchUpdate(media_ids=[uuid.uuid4()])
    assert len(m.media_ids) == 1


def test_album_media_batch_update_empty_media_rejected():
    with pytest.raises(ValidationError):
        AlbumMediaBatchUpdate(media_ids=[])


def test_image_batch_delete_valid():
    m = MediaBatchDelete(media_ids=[uuid.uuid4()])
    assert len(m.media_ids) == 1


# --- BulkResult ---

def test_bulk_result_construction():
    m = BulkResult(processed=5, skipped=2)
    assert m.processed == 5
    assert m.skipped == 2


def test_bulk_result_zero_values():
    m = BulkResult(processed=0, skipped=0)
    assert m.processed == 0


# --- DownloadRequest ---

def test_download_request_valid():
    ids = [uuid.uuid4()]
    m = DownloadRequest(media_ids=ids)
    assert len(m.media_ids) == 1


def test_download_request_empty_rejected():
    with pytest.raises(ValidationError):
        DownloadRequest(media_ids=[])


def test_download_request_max_500():
    with pytest.raises(ValidationError):
        DownloadRequest(media_ids=[uuid.uuid4() for _ in range(501)])


# --- AdminUserUpdate ---

def test_admin_user_update_empty():
    body = AdminUserUpdate()
    assert body.model_fields_set == set()


def test_admin_user_update_is_admin_only():
    body = AdminUserUpdate(is_admin=True)
    assert "is_admin" in body.model_fields_set
    assert "show_nsfw" not in body.model_fields_set


def test_admin_user_update_show_nsfw_only():
    body = AdminUserUpdate(show_nsfw=False)
    assert "show_nsfw" in body.model_fields_set
    assert "is_admin" not in body.model_fields_set


def test_admin_user_update_both_fields():
    body = AdminUserUpdate(is_admin=False, show_nsfw=True)
    assert body.model_fields_set == {"is_admin", "show_nsfw"}


# --- AdminStatsResponse ---

def test_admin_stats_response():
    m = AdminStatsResponse(
        total_users=10,
        total_media=500,
        total_storage_bytes=1024 * 1024 * 200,
        pending_tagging=3,
        failed_tagging=1,
        trashed_media=12,
    )
    assert m.total_users == 10
    assert m.trashed_media == 12


def test_image_metadata_filter_allows_partial_date_groups():
    m = MediaMetadataFilter(captured_month=3)
    assert m.captured_month == 3


def test_image_metadata_filter_rejects_invalid_full_date():
    with pytest.raises(ValidationError):
        MediaMetadataFilter(captured_month=2, captured_day=30)
