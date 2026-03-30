from __future__ import annotations

import uuid
import io

import pytest
from PIL import Image

from backend.app.models.auth import User
from backend.app.utils.passwords import hash_password


def _image_file_tuple(filename: str = "sample.png", color: str = "red"):
    img = Image.new("RGB", (16, 16), color=color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return (filename, buf.read(), "image/png")


async def _register_and_login(client, username: str, email: str, password: str = "password123") -> str:
    register = await client.post(
        "/api/v1/auth/register",
        json={"username": username, "email": email, "password": password},
    )
    assert register.status_code == 201

    login = await client.post(
        "/api/v1/auth/login",
        data={"username": username, "password": password, "remember_me": "false"},
    )
    assert login.status_code == 200
    return login.json()["access_token"]


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_journey_auth_upload_media_album_and_batchs(journey_client):
    token = await _register_and_login(journey_client, "saber", "saber@starsbit.space")
    headers = _auth_headers(token)

    me = await journey_client.get("/api/v1/me", headers=headers)
    assert me.status_code == 200

    create_album = await journey_client.post(
        "/api/v1/albums",
        json={"name": "Journey Album", "description": "integration"},
        headers=headers,
    )
    assert create_album.status_code == 201
    album_id = create_album.json()["id"]

    upload = await journey_client.post(
        "/api/v1/media",
        data={"album_id": album_id, "tags": ["safe", "city"]},
        files=[("files", _image_file_tuple("journey.png"))],
        headers=headers,
    )
    assert upload.status_code == 202
    upload_payload = upload.json()
    assert upload_payload["accepted"] == 1
    assert upload_payload["errors"] == 0

    batch_id = upload_payload["batch_id"]
    media_id = upload_payload["results"][0]["id"]

    batch = await journey_client.get(f"/api/v1/me/import-batches/{batch_id}", headers=headers)
    assert batch.status_code == 200

    batch_items = await journey_client.get(f"/api/v1/me/import-batches/{batch_id}/items", headers=headers)
    assert batch_items.status_code == 200
    assert batch_items.json()["total"] >= 1

    list_media = await journey_client.get("/api/v1/media", headers=headers)
    assert list_media.status_code == 200
    assert any(item["id"] == media_id for item in list_media.json()["items"])

    media_detail = await journey_client.get(f"/api/v1/media/{media_id}", headers=headers)
    assert media_detail.status_code == 200

    media_file = await journey_client.get(f"/api/v1/media/{media_id}/file", headers=headers)
    assert media_file.status_code == 200

    media_thumb = await journey_client.get(f"/api/v1/media/{media_id}/thumbnail", headers=headers)
    assert media_thumb.status_code == 200

    media_poster = await journey_client.get(f"/api/v1/media/{media_id}/poster", headers=headers)
    assert media_poster.status_code == 404

    search = await journey_client.get("/api/v1/media/search", params={"tag": "safe"}, headers=headers)
    assert search.status_code == 200

    tags = await journey_client.get("/api/v1/tags", headers=headers)
    assert tags.status_code == 200
    assert any(item["name"] == "safe" for item in tags.json()["items"])

    album_media = await journey_client.get(f"/api/v1/albums/{album_id}/media", headers=headers)
    assert album_media.status_code == 200
    assert any(item["id"] == media_id for item in album_media.json()["items"])

    update_conflict = await journey_client.patch(
        f"/api/v1/media/{media_id}",
        json={"favorited": True, "version": 9999},
        headers=headers,
    )
    assert update_conflict.status_code == 409

    version = media_detail.json()["version"]
    update_ok = await journey_client.patch(
        f"/api/v1/media/{media_id}",
        json={"favorited": True, "version": version},
        headers=headers,
    )
    assert update_ok.status_code == 200
    assert update_ok.json()["is_favorited"] is True


@pytest.mark.asyncio
async def test_journey_idempotency_and_duplicate_edge_cases(journey_client):
    token = await _register_and_login(journey_client, "rin", "rin@starsbit.space")
    headers = _auth_headers(token)

    key = "idem-journey-key"
    upload1 = await journey_client.post(
        "/api/v1/media",
        data={"tags": ["safe"]},
        files=[("files", _image_file_tuple("first.png"))],
        headers={**headers, "Idempotency-Key": key},
    )
    assert upload1.status_code == 202

    replay = await journey_client.post(
        "/api/v1/media",
        data={"tags": ["safe"]},
        files=[("files", _image_file_tuple("first.png"))],
        headers={**headers, "Idempotency-Key": key},
    )
    assert replay.status_code == 202
    assert replay.json() == upload1.json()

    conflict = await journey_client.post(
        "/api/v1/media",
        data={"tags": ["unsafe"]},
        files=[("files", _image_file_tuple("first.png"))],
        headers={**headers, "Idempotency-Key": key},
    )
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "idempotency_key_conflict"

    duplicate = await journey_client.post(
        "/api/v1/media",
        data={"tags": ["safe"]},
        files=[("files", _image_file_tuple("dup.png"))],
        headers=headers,
    )
    assert duplicate.status_code == 202
    assert duplicate.json()["duplicates"] >= 1


@pytest.mark.asyncio
async def test_journey_sharing_access_control_and_admin_announcements(journey_client, db_session):
    owner_token = await _register_and_login(journey_client, "sakura-owner", "sakura-owner@starsbit.space")
    viewer_token = await _register_and_login(journey_client, "sakura-viewer", "sakura-viewer@starsbit.space")

    owner_headers = _auth_headers(owner_token)
    viewer_headers = _auth_headers(viewer_token)

    viewer_me = (await journey_client.get("/api/v1/me", headers=viewer_headers)).json()
    viewer_username = viewer_me["username"]

    create_album = await journey_client.post(
        "/api/v1/albums",
        json={"name": "Shared Album", "description": "sharing regression"},
        headers=owner_headers,
    )
    assert create_album.status_code == 201
    album_id = create_album.json()["id"]

    before_share = await journey_client.get(f"/api/v1/albums/{album_id}", headers=viewer_headers)
    assert before_share.status_code == 404

    share = await journey_client.post(
        f"/api/v1/albums/{album_id}/shares",
        json={"username": viewer_username, "role": "viewer"},
        headers=owner_headers,
    )
    assert share.status_code in (200, 201)
    assert share.json()["status"] == "pending"

    after_share = await journey_client.get(f"/api/v1/albums/{album_id}", headers=viewer_headers)
    assert after_share.status_code == 404

    notifications = await journey_client.get("/api/v1/me/notifications", headers=viewer_headers)
    assert notifications.status_code == 200
    invite = notifications.json()["items"][0]
    assert invite["type"] == "share_invite"

    accept = await journey_client.post(
        f"/api/v1/me/notifications/{invite['id']}/accept",
        headers=viewer_headers,
    )
    assert accept.status_code == 200
    assert accept.json()["data"]["invite_status"] == "accepted"

    after_accept = await journey_client.get(f"/api/v1/albums/{album_id}", headers=viewer_headers)
    assert after_accept.status_code == 200

    forbidden_delete = await journey_client.delete(f"/api/v1/albums/{album_id}", headers=viewer_headers)
    assert forbidden_delete.status_code == 403

    admin = User(
        id=uuid.uuid4(),
        username="journey-admin",
        email="journey-admin@starsbit.space",
        hashed_password=hash_password("password123"),
        is_admin=True,
        show_nsfw=False,
        tag_confidence_threshold=0.35,
        version=1,
    )
    db_session.add(admin)
    await db_session.commit()

    admin_login = await journey_client.post(
        "/api/v1/auth/login",
        data={"username": "journey-admin", "password": "password123", "remember_me": "false"},
    )
    assert admin_login.status_code == 200
    admin_headers = _auth_headers(admin_login.json()["access_token"])

    create_announcement = await journey_client.post(
        "/api/v1/admin/announcements",
        json={
            "version": "2.0.0",
            "title": "Maintenance",
            "message": "Nightly deployment window",
            "severity": "warning",
        },
        headers=admin_headers,
    )
    assert create_announcement.status_code == 201

    list_announcements = await journey_client.get("/api/v1/admin/announcements", headers=admin_headers)
    assert list_announcements.status_code == 200
    assert any(item["title"] == "Maintenance" for item in list_announcements.json())


@pytest.mark.asyncio
async def test_journey_search_and_tag_editing_flows(journey_client):
    token = await _register_and_login(journey_client, "rider", "rider@starsbit.space")
    headers = _auth_headers(token)

    upload1 = await journey_client.post(
        "/api/v1/media",
        data={"tags": ["safe", "city"]},
        files=[("files", _image_file_tuple("search-a.png", color="red"))],
        headers=headers,
    )
    assert upload1.status_code == 202
    media1_id = upload1.json()["results"][0]["id"]
    assert media1_id is not None

    upload2 = await journey_client.post(
        "/api/v1/media",
        data={"tags": ["safe", "portrait"]},
        files=[("files", _image_file_tuple("search-b.png", color="blue"))],
        headers=headers,
    )
    assert upload2.status_code == 202
    media2_id = upload2.json()["results"][0]["id"]
    assert media2_id is not None

    by_city = await journey_client.get("/api/v1/media/search", params={"tag": "city"}, headers=headers)
    assert by_city.status_code == 200
    city_ids = {item["id"] for item in by_city.json()["items"]}
    assert media1_id in city_ids
    assert media2_id not in city_ids

    without_city = await journey_client.get("/api/v1/media/search", params={"exclude_tag": "city"}, headers=headers)
    assert without_city.status_code == 200
    without_city_ids = {item["id"] for item in without_city.json()["items"]}
    assert media2_id in without_city_ids

    media1_detail = await journey_client.get(f"/api/v1/media/{media1_id}", headers=headers)
    assert media1_detail.status_code == 200
    media1_version = media1_detail.json()["version"]

    set_character = await journey_client.patch(
        f"/api/v1/media/{media1_id}",
        json={
            "version": media1_version,
            "entities": [{"entity_type": "character", "name": "Saber", "role": "primary"}],
        },
        headers=headers,
    )
    assert set_character.status_code == 200
    assert any(e["name"] == "Saber" for e in set_character.json()["entities"])

    media2_detail = await journey_client.get(f"/api/v1/media/{media2_id}", headers=headers)
    assert media2_detail.status_code == 200
    media2_version = media2_detail.json()["version"]

    replace_tags = await journey_client.patch(
        f"/api/v1/media/{media2_id}",
        json={"version": media2_version, "tags": ["safe", "edited"]},
        headers=headers,
    )
    assert replace_tags.status_code == 200
    assert set(replace_tags.json()["tags"]) == {"safe", "edited"}

    tags_all = await journey_client.get("/api/v1/tags", headers=headers)
    assert tags_all.status_code == 200
    tags_by_name = {item["name"]: item["id"] for item in tags_all.json()["items"]}
    assert "edited" in tags_by_name
    assert "city" in tags_by_name

    remove_edited = await journey_client.post(
        f"/api/v1/tags/{tags_by_name['edited']}/actions/remove-from-media",
        headers=headers,
    )
    assert remove_edited.status_code == 200
    assert remove_edited.json()["updated_media"] >= 1

    media2_after_remove = await journey_client.get(f"/api/v1/media/{media2_id}", headers=headers)
    assert media2_after_remove.status_code == 200
    assert "edited" not in media2_after_remove.json()["tags"]

    clear_character = await journey_client.post(
        "/api/v1/character-names/Saber/actions/remove-from-media",
        headers=headers,
    )
    assert clear_character.status_code == 200
    assert clear_character.json()["updated_media"] >= 1

    media1_after_clear = await journey_client.get(f"/api/v1/media/{media1_id}", headers=headers)
    assert media1_after_clear.status_code == 200
    assert all(e["name"] != "Saber" for e in media1_after_clear.json()["entities"])

    trash_by_city = await journey_client.post(
        f"/api/v1/tags/{tags_by_name['city']}/actions/trash-media",
        headers=headers,
    )
    assert trash_by_city.status_code == 200
    assert trash_by_city.json()["trashed_media"] >= 1

    trashed_media = await journey_client.get("/api/v1/media", params={"state": "trashed"}, headers=headers)
    assert trashed_media.status_code == 200
    assert media1_id in {item["id"] for item in trashed_media.json()["items"]}
