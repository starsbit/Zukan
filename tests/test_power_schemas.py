import uuid
from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from app.schemas import (
    AlbumImageBatchUpdate,
    AdminStatsResponse,
    AdminUserUpdate,
    BulkResult,
    DownloadRequest,
    ImageBatchDelete,
    ImageBatchUpdate,
    ImageMetadataFilter,
)


def _now():
    return datetime.now(timezone.utc)


def _image_data(**overrides):
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


# --- ImageBatchUpdate ---

def test_image_batch_update_valid():
    ids = [uuid.uuid4(), uuid.uuid4()]
    m = ImageBatchUpdate(image_ids=ids, deleted=True)
    assert len(m.image_ids) == 2


def test_image_batch_update_empty_rejected():
    with pytest.raises(ValidationError):
        ImageBatchUpdate(image_ids=[], deleted=True)


def test_image_batch_update_requires_mutation():
    with pytest.raises(ValidationError):
        ImageBatchUpdate(image_ids=[uuid.uuid4()])


def test_image_batch_update_max_500():
    with pytest.raises(ValidationError):
        ImageBatchUpdate(image_ids=[uuid.uuid4() for _ in range(501)], favorited=True)


def test_image_batch_update_exactly_500():
    m = ImageBatchUpdate(image_ids=[uuid.uuid4() for _ in range(500)], favorited=False)
    assert len(m.image_ids) == 500


# --- AlbumImageBatchUpdate / ImageBatchDelete ---

def test_album_image_batch_update_valid():
    m = AlbumImageBatchUpdate(image_ids=[uuid.uuid4()])
    assert len(m.image_ids) == 1


def test_album_image_batch_update_empty_images_rejected():
    with pytest.raises(ValidationError):
        AlbumImageBatchUpdate(image_ids=[])


def test_image_batch_delete_valid():
    m = ImageBatchDelete(image_ids=[uuid.uuid4()])
    assert len(m.image_ids) == 1


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
    m = DownloadRequest(image_ids=ids)
    assert len(m.image_ids) == 1


def test_download_request_empty_rejected():
    with pytest.raises(ValidationError):
        DownloadRequest(image_ids=[])


def test_download_request_max_500():
    with pytest.raises(ValidationError):
        DownloadRequest(image_ids=[uuid.uuid4() for _ in range(501)])


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
        total_images=500,
        total_storage_bytes=1024 * 1024 * 200,
        pending_tagging=3,
        failed_tagging=1,
        trashed_images=12,
    )
    assert m.total_users == 10
    assert m.trashed_images == 12


def test_image_metadata_filter_allows_partial_date_groups():
    m = ImageMetadataFilter(captured_month=3)
    assert m.captured_month == 3


def test_image_metadata_filter_rejects_invalid_full_date():
    with pytest.raises(ValidationError):
        ImageMetadataFilter(captured_month=2, captured_day=30)
