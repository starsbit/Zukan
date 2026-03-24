import uuid
from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from backend.app.routers.albums import album_access
from backend.app.schemas import AlbumCreate, AlbumRead, AlbumShareCreate, AlbumUpdate, MediaIdsRequest


def _now():
    return datetime.now(timezone.utc)


def _base_album_data(**overrides):
    now = _now()
    data = dict(
        id=uuid.uuid4(),
        owner_id=uuid.uuid4(),
        name="My Album",
        description=None,
        cover_media_id=None,
        media_count=0,
        version=1,
        created_at=now,
        updated_at=now,
    )
    data.update(overrides)
    return data


# --- AlbumCreate ---

def test_album_create_valid():
    m = AlbumCreate(name="Vacation")
    assert m.name == "Vacation"
    assert m.description is None


def test_album_create_with_description():
    m = AlbumCreate(name="Vacation", description="Summer 2025")
    assert m.description == "Summer 2025"


def test_album_create_name_too_short():
    with pytest.raises(ValidationError):
        AlbumCreate(name="")


def test_album_create_name_too_long():
    with pytest.raises(ValidationError):
        AlbumCreate(name="x" * 256)


# --- AlbumRead ---

def test_album_read_media_count_defaults_zero():
    m = AlbumRead(**_base_album_data())
    assert m.media_count == 0


def test_album_read_model_copy_sets_media_count():
    m = AlbumRead(**_base_album_data())
    enriched = m.model_copy(update={"media_count": 42})
    assert enriched.media_count == 42
    assert m.media_count == 0


def test_album_read_cover_image_nullable():
    m = AlbumRead(**_base_album_data(cover_media_id=None))
    assert m.cover_media_id is None


def test_album_read_description_nullable():
    m = AlbumRead(**_base_album_data(description=None))
    assert m.description is None


# --- AlbumUpdate / model_fields_set ---

def test_album_update_empty_changes_nothing():
    body = AlbumUpdate()
    assert body.model_fields_set == set()


def test_album_update_only_name():
    body = AlbumUpdate(name="New Name")
    assert "name" in body.model_fields_set
    assert "description" not in body.model_fields_set
    assert "cover_media_id" not in body.model_fields_set


def test_album_update_null_description_in_fields_set():
    body = AlbumUpdate.model_validate({"description": None})
    assert "description" in body.model_fields_set
    assert body.description is None


def test_album_update_null_cover_image_in_fields_set():
    body = AlbumUpdate.model_validate({"cover_media_id": None})
    assert "cover_media_id" in body.model_fields_set
    assert body.cover_media_id is None


# --- AlbumShareCreate ---

def test_album_share_create_role_defaults_viewer():
    m = AlbumShareCreate(user_id=uuid.uuid4())
    assert m.role == "viewer"


def test_album_share_create_role_editor():
    m = AlbumShareCreate(user_id=uuid.uuid4(), role="editor")
    assert m.role == "editor"


# --- MediaIdsRequest ---

def test_add_media_requires_at_least_one():
    with pytest.raises(ValidationError):
        MediaIdsRequest(media_ids=[])


def test_add_media_valid():
    ids = [uuid.uuid4(), uuid.uuid4()]
    m = MediaIdsRequest(media_ids=ids)
    assert len(m.media_ids) == 2


# --- album_access pure function ---

def test_album_access_owner_has_full_access():
    owner_id = uid = uuid.uuid4()
    can_read, can_edit = album_access(owner_id, uid, is_admin=False, share_role=None)
    assert can_read is True
    assert can_edit is True


def test_album_access_admin_has_full_access():
    can_read, can_edit = album_access(uuid.uuid4(), uuid.uuid4(), is_admin=True, share_role=None)
    assert can_read is True
    assert can_edit is True


def test_album_access_no_share_no_access():
    can_read, can_edit = album_access(uuid.uuid4(), uuid.uuid4(), is_admin=False, share_role=None)
    assert can_read is False
    assert can_edit is False


def test_album_access_shared_read_only():
    can_read, can_edit = album_access(uuid.uuid4(), uuid.uuid4(), is_admin=False, share_role="viewer")
    assert can_read is True
    assert can_edit is False


def test_album_access_shared_with_edit():
    can_read, can_edit = album_access(uuid.uuid4(), uuid.uuid4(), is_admin=False, share_role="editor")
    assert can_read is True
    assert can_edit is True
