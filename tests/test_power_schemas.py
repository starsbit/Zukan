import uuid
from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from app.schemas import (
    AdminStatsResponse,
    AdminUserUpdate,
    BulkAlbumRequest,
    BulkImageRequest,
    BulkResult,
    DownloadRequest,
    OnThisDayResponse,
    OnThisDayYear,
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
        file_size=100,
        width=10,
        height=10,
        mime_type="image/jpeg",
        tags=[],
        is_nsfw=False,
        tagging_status="done",
        thumbnail_status="done",
        created_at=now,
        deleted_at=None,
    )
    data.update(overrides)
    return data


# --- BulkImageRequest ---

def test_bulk_image_request_valid():
    ids = [uuid.uuid4(), uuid.uuid4()]
    m = BulkImageRequest(image_ids=ids)
    assert len(m.image_ids) == 2


def test_bulk_image_request_empty_rejected():
    with pytest.raises(ValidationError):
        BulkImageRequest(image_ids=[])


def test_bulk_image_request_max_500():
    with pytest.raises(ValidationError):
        BulkImageRequest(image_ids=[uuid.uuid4() for _ in range(501)])


def test_bulk_image_request_exactly_500():
    m = BulkImageRequest(image_ids=[uuid.uuid4() for _ in range(500)])
    assert len(m.image_ids) == 500


# --- BulkAlbumRequest ---

def test_bulk_album_request_valid():
    m = BulkAlbumRequest(album_id=uuid.uuid4(), image_ids=[uuid.uuid4()])
    assert m.album_id is not None


def test_bulk_album_request_empty_images_rejected():
    with pytest.raises(ValidationError):
        BulkAlbumRequest(album_id=uuid.uuid4(), image_ids=[])


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


# --- OnThisDayYear / OnThisDayResponse ---

def test_on_this_day_year_empty_images():
    m = OnThisDayYear(year=2023, images=[])
    assert m.year == 2023
    assert m.images == []


def test_on_this_day_response_multiple_years():
    m = OnThisDayResponse(years=[
        OnThisDayYear(year=2024, images=[]),
        OnThisDayYear(year=2023, images=[]),
    ])
    assert len(m.years) == 2
    assert m.years[0].year == 2024


def test_on_this_day_response_empty():
    m = OnThisDayResponse(years=[])
    assert m.years == []
