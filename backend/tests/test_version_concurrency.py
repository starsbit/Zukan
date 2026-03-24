"""Tests for optimistic locking (version field) across media, albums, and users."""
import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from backend.app.schemas import AlbumRead, MediaRead, UserRead
from backend.app.models.auth import User
from backend.app.schemas import MediaUpdate
from backend.app.services import media as media_service
from backend.app.schemas import AlbumUpdate
from backend.app.services import albums as album_service


# --- Schema: version is exposed ---

def _base_media_data(**overrides):
    now = datetime.now(timezone.utc)
    data = dict(
        id=uuid.uuid4(),
        uploader_id=uuid.uuid4(),
        filename="test.jpg",
        original_filename="test.jpg",
        metadata={
            "file_size": 1000,
            "width": 100,
            "height": 100,
            "mime_type": "image/jpeg",
            "captured_at": now,
        },
        tags=[],
        is_nsfw=False,
        tagging_status="done",
        thumbnail_status="done",
        version=1,
        created_at=now,
        deleted_at=None,
    )
    data.update(overrides)
    return data


def _base_album_data(**overrides):
    now = datetime.now(timezone.utc)
    data = dict(
        id=uuid.uuid4(),
        owner_id=uuid.uuid4(),
        name="Album",
        description=None,
        cover_media_id=None,
        media_count=0,
        version=1,
        created_at=now,
        updated_at=now,
    )
    data.update(overrides)
    return data


def test_media_read_exposes_version():
    m = MediaRead(**_base_media_data(version=3))
    assert m.version == 3


def test_media_read_version_required():
    data = _base_media_data()
    data.pop("version")
    with pytest.raises(Exception):
        MediaRead(**data)


def test_album_read_exposes_version():
    m = AlbumRead(**_base_album_data(version=7))
    assert m.version == 7


def test_user_read_exposes_version():
    now = datetime.now(timezone.utc)
    m = UserRead(
        id=uuid.uuid4(),
        username="alice",
        email="alice@example.com",
        is_admin=False,
        show_nsfw=False,
        tag_confidence_threshold=0.35,
        version=2,
        created_at=now,
    )
    assert m.version == 2


# --- API: version appears in all PATCH responses ---

def test_media_patch_response_includes_version(api):
    user = api.register_and_login("version-media-patch")
    headers = api.auth_headers(user["access_token"])
    blue = api.upload_media(user["access_token"], "version-blue.png", (0, 0, 255))
    api.wait_for_media_status(str(blue["id"]))

    resp = api.client.get(f"/media/{blue['id']}", headers=headers)
    assert resp.status_code == 200
    before_version = resp.json()["version"]
    assert isinstance(before_version, int)

    patch = api.client.patch(
        f"/media/{blue['id']}",
        headers=headers,
        json={"ocr_text_override": "rei"},
    )
    assert patch.status_code == 200
    assert patch.json()["version"] == before_version + 1


def test_album_patch_response_includes_version(api):
    user = api.register_and_login("version-album-patch")
    headers = api.auth_headers(user["access_token"])

    album = api.client.post("/albums", headers=headers, json={"name": "Version Test"})
    assert album.status_code == 201
    assert album.json()["version"] == 1
    album_id = album.json()["id"]

    patch = api.client.patch(f"/albums/{album_id}", headers=headers, json={"name": "Version Test 2"})
    assert patch.status_code == 200
    assert patch.json()["version"] == 2


def test_user_patch_response_includes_version(api):
    user = api.register_and_login("version-user-patch")
    headers = api.auth_headers(user["access_token"])

    me = api.client.get("/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["version"] == 1

    patch = api.client.patch("/me", headers=headers, json={"show_nsfw": True})
    assert patch.status_code == 200
    assert patch.json()["version"] == 2


# --- API: version conflict (409) ---

def test_media_patch_version_conflict_returns_409(api):
    user = api.register_and_login("version-conflict-media")
    headers = api.auth_headers(user["access_token"])
    blue = api.upload_media(user["access_token"], "conflict-blue.png", (0, 0, 255))
    api.wait_for_media_status(str(blue["id"]))

    current_version = api.client.get(f"/media/{blue['id']}", headers=headers).json()["version"]

    first = api.client.patch(
        f"/media/{blue['id']}",
        headers=headers,
        json={"ocr_text_override": "rei", "version": current_version},
    )
    assert first.status_code == 200
    assert first.json()["version"] == current_version + 1

    conflict = api.client.patch(
        f"/media/{blue['id']}",
        headers=headers,
        json={"ocr_text_override": "saber", "version": current_version},
    )
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "version_conflict"
    assert conflict.json()["details"]["current_version"] == current_version + 1
    assert conflict.json()["details"]["provided_version"] == current_version


def test_album_patch_version_conflict_returns_409(api):
    user = api.register_and_login("version-conflict-album")
    headers = api.auth_headers(user["access_token"])

    album = api.client.post("/albums", headers=headers, json={"name": "Conflict Album"})
    assert album.status_code == 201
    album_id = album.json()["id"]

    first = api.client.patch(f"/albums/{album_id}", headers=headers, json={"name": "Updated", "version": 1})
    assert first.status_code == 200

    conflict = api.client.patch(f"/albums/{album_id}", headers=headers, json={"name": "Stale", "version": 1})
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "version_conflict"
    assert conflict.json()["details"]["current_version"] == 2
    assert conflict.json()["details"]["provided_version"] == 1


def test_user_patch_version_conflict_returns_409(api):
    user = api.register_and_login("version-conflict-user")
    headers = api.auth_headers(user["access_token"])

    first = api.client.patch("/me", headers=headers, json={"show_nsfw": True, "version": 1})
    assert first.status_code == 200

    conflict = api.client.patch("/me", headers=headers, json={"show_nsfw": False, "version": 1})
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "version_conflict"
    assert conflict.json()["details"]["current_version"] == 2
    assert conflict.json()["details"]["provided_version"] == 1


def test_media_patch_without_version_always_succeeds(api):
    user = api.register_and_login("version-omit-media")
    headers = api.auth_headers(user["access_token"])
    blue = api.upload_media(user["access_token"], "omit-version-blue.png", (0, 0, 255))
    api.wait_for_media_status(str(blue["id"]))

    for _ in range(3):
        patch = api.client.patch(
            f"/media/{blue['id']}",
            headers=headers,
            json={"ocr_text_override": "rei"},
        )
        assert patch.status_code == 200

def test_media_service_version_conflict_raises_http_exception(api):
    user = api.register_and_login("version-service-media")
    blue = api.upload_media(user["access_token"], "svc-version-blue.png", (0, 0, 255))
    api.wait_for_media_status(str(blue["id"]))
    blue_id = uuid.UUID(str(blue["id"]))
    user_id = uuid.UUID(user["user"]["id"])

    async def _exercise(session):
        db_user = await session.get(User, user_id)
        with pytest.raises(HTTPException) as exc:
            await media_service.update_media_metadata(
                session, blue_id, db_user, MediaUpdate(ocr_text_override="rei", version=999)
            )
        assert exc.value.status_code == 409
        assert exc.value.detail["code"] == "version_conflict"
        assert exc.value.detail["details"]["current_version"] == 1
        assert exc.value.detail["details"]["provided_version"] == 999

    api.run_db(_exercise)


def test_album_service_version_conflict_raises_http_exception(api):
    user = api.register_and_login("version-service-album")
    headers = api.auth_headers(user["access_token"])
    album = api.client.post("/albums", headers=headers, json={"name": "Svc Version Album"})
    album_id = uuid.UUID(album.json()["id"])
    user_id = uuid.UUID(user["user"]["id"])

    async def _exercise(session):
        db_user = await session.get(User, user_id)
        with pytest.raises(HTTPException) as exc:
            await album_service.update_album(
                session, album_id, AlbumUpdate(name="Stale", version=999), db_user
            )
        assert exc.value.status_code == 409
        assert exc.value.detail["code"] == "version_conflict"
        assert exc.value.detail["details"]["current_version"] == 1
        assert exc.value.detail["details"]["provided_version"] == 999

    api.run_db(_exercise)
