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


async def _favorite_media(client, headers: dict[str, str], media_id: str) -> dict:
    detail = await client.get(f"/api/v1/media/{media_id}", headers=headers)
    assert detail.status_code == 200
    version = detail.json()["version"]
    favorite = await client.patch(
        f"/api/v1/media/{media_id}",
        json={"favorited": True, "version": version},
        headers=headers,
    )
    assert favorite.status_code == 200
    return favorite.json()


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
async def test_journey_favorites_include_public_media_until_visibility_is_removed(journey_client):
    owner_token = await _register_and_login(journey_client, "public-owner", "public-owner@example.com")
    viewer_token = await _register_and_login(journey_client, "public-viewer", "public-viewer@example.com")
    owner_headers = _auth_headers(owner_token)
    viewer_headers = _auth_headers(viewer_token)

    upload = await journey_client.post(
        "/api/v1/media",
        data={"visibility": "public"},
        files=[("files", _image_file_tuple("public-favorite.png", color="blue"))],
        headers=owner_headers,
    )
    assert upload.status_code == 202
    media_id = upload.json()["results"][0]["id"]

    favorite = await _favorite_media(journey_client, viewer_headers, media_id)
    assert favorite["is_favorited"] is True

    search = await journey_client.get("/api/v1/media/search", params={"favorited": "true"}, headers=viewer_headers)
    assert search.status_code == 200
    assert [item["id"] for item in search.json()["items"]] == [media_id]

    timeline = await journey_client.get("/api/v1/media/timeline", params={"favorited": "true"}, headers=viewer_headers)
    assert timeline.status_code == 200
    assert timeline.json()["buckets"][0]["count"] == 1

    detail = await journey_client.get(f"/api/v1/media/{media_id}", headers=viewer_headers)
    assert detail.status_code == 200

    media_file = await journey_client.get(f"/api/v1/media/{media_id}/file", headers=viewer_headers)
    assert media_file.status_code == 200

    owner_detail = await journey_client.get(f"/api/v1/media/{media_id}", headers=owner_headers)
    owner_update = await journey_client.patch(
        f"/api/v1/media/{media_id}",
        json={"visibility": "private", "version": owner_detail.json()["version"]},
        headers=owner_headers,
    )
    assert owner_update.status_code == 200

    hidden_search = await journey_client.get("/api/v1/media/search", params={"favorited": "true"}, headers=viewer_headers)
    assert hidden_search.status_code == 200
    assert hidden_search.json()["items"] == []

    hidden_timeline = await journey_client.get("/api/v1/media/timeline", params={"favorited": "true"}, headers=viewer_headers)
    assert hidden_timeline.status_code == 200
    assert hidden_timeline.json()["buckets"] == []

    hidden_detail = await journey_client.get(f"/api/v1/media/{media_id}", headers=viewer_headers)
    assert hidden_detail.status_code == 404

    hidden_file = await journey_client.get(f"/api/v1/media/{media_id}/file", headers=viewer_headers)
    assert hidden_file.status_code == 404


@pytest.mark.asyncio
async def test_journey_favorites_follow_shared_album_access_and_reappear_when_restored(journey_client):
    owner_token = await _register_and_login(journey_client, "album-owner", "album-owner@example.com")
    viewer_token = await _register_and_login(journey_client, "album-viewer", "album-viewer@example.com")
    owner_headers = _auth_headers(owner_token)
    viewer_headers = _auth_headers(viewer_token)

    viewer_me = (await journey_client.get("/api/v1/me", headers=viewer_headers)).json()
    viewer_id = viewer_me["id"]
    viewer_username = viewer_me["username"]

    create_album = await journey_client.post(
        "/api/v1/albums",
        json={"name": "Favorites Access", "description": "shared favorites"},
        headers=owner_headers,
    )
    assert create_album.status_code == 201
    album_id = create_album.json()["id"]

    upload = await journey_client.post(
        "/api/v1/media",
        data={"album_id": album_id},
        files=[("files", _image_file_tuple("shared-favorite.png", color="green"))],
        headers=owner_headers,
    )
    assert upload.status_code == 202
    media_id = upload.json()["results"][0]["id"]

    share = await journey_client.post(
        f"/api/v1/albums/{album_id}/shares",
        json={"username": viewer_username, "role": "viewer"},
        headers=owner_headers,
    )
    assert share.status_code in (200, 201)

    notifications = await journey_client.get("/api/v1/me/notifications", headers=viewer_headers)
    invite_id = notifications.json()["items"][0]["id"]
    accept = await journey_client.post(f"/api/v1/me/notifications/{invite_id}/accept", headers=viewer_headers)
    assert accept.status_code == 200

    favorite = await _favorite_media(journey_client, viewer_headers, media_id)
    assert favorite["is_favorited"] is True

    search = await journey_client.get("/api/v1/media/search", params={"favorited": "true"}, headers=viewer_headers)
    assert search.status_code == 200
    assert [item["id"] for item in search.json()["items"]] == [media_id]

    timeline = await journey_client.get("/api/v1/media/timeline", params={"favorited": "true"}, headers=viewer_headers)
    assert timeline.status_code == 200
    assert timeline.json()["buckets"][0]["count"] == 1

    detail = await journey_client.get(f"/api/v1/media/{media_id}", headers=viewer_headers)
    assert detail.status_code == 200

    revoke = await journey_client.delete(f"/api/v1/albums/{album_id}/shares/{viewer_id}", headers=owner_headers)
    assert revoke.status_code == 204

    hidden_search = await journey_client.get("/api/v1/media/search", params={"favorited": "true"}, headers=viewer_headers)
    assert hidden_search.status_code == 200
    assert hidden_search.json()["items"] == []

    hidden_detail = await journey_client.get(f"/api/v1/media/{media_id}", headers=viewer_headers)
    assert hidden_detail.status_code == 404

    reshared = await journey_client.post(
        f"/api/v1/albums/{album_id}/shares",
        json={"username": viewer_username, "role": "viewer"},
        headers=owner_headers,
    )
    assert reshared.status_code in (200, 201)
    notifications = await journey_client.get("/api/v1/me/notifications", headers=viewer_headers)
    invite_id = notifications.json()["items"][0]["id"]
    accept = await journey_client.post(f"/api/v1/me/notifications/{invite_id}/accept", headers=viewer_headers)
    assert accept.status_code == 200

    restored_search = await journey_client.get("/api/v1/media/search", params={"favorited": "true"}, headers=viewer_headers)
    assert restored_search.status_code == 200
    assert [item["id"] for item in restored_search.json()["items"]] == [media_id]

    remove_from_album = await journey_client.request(
        "DELETE",
        f"/api/v1/albums/{album_id}/media",
        json={"media_ids": [media_id]},
        headers=owner_headers,
    )
    assert remove_from_album.status_code == 200
    assert remove_from_album.json()["processed"] == 1

    removed_search = await journey_client.get("/api/v1/media/search", params={"favorited": "true"}, headers=viewer_headers)
    assert removed_search.status_code == 200
    assert removed_search.json()["items"] == []

    add_back = await journey_client.put(
        f"/api/v1/albums/{album_id}/media",
        json={"media_ids": [media_id]},
        headers=owner_headers,
    )
    assert add_back.status_code == 200
    assert add_back.json()["processed"] == 1

    restored_again = await journey_client.get("/api/v1/media/search", params={"favorited": "true"}, headers=viewer_headers)
    assert restored_again.status_code == 200
    assert [item["id"] for item in restored_again.json()["items"]] == [media_id]


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


@pytest.mark.asyncio
async def test_journey_album_not_accessible_until_invite_accepted(journey_client):
    owner_token = await _register_and_login(journey_client, "invite-owner", "invite-owner@example.com")
    viewer_token = await _register_and_login(journey_client, "invite-viewer", "invite-viewer@example.com")
    rejecter_token = await _register_and_login(journey_client, "invite-rejecter", "invite-rejecter@example.com")

    owner_headers = _auth_headers(owner_token)
    viewer_headers = _auth_headers(viewer_token)
    rejecter_headers = _auth_headers(rejecter_token)

    viewer_username = (await journey_client.get("/api/v1/me", headers=viewer_headers)).json()["username"]
    rejecter_username = (await journey_client.get("/api/v1/me", headers=rejecter_headers)).json()["username"]

    create_album = await journey_client.post(
        "/api/v1/albums",
        json={"name": "Invite Test Album"},
        headers=owner_headers,
    )
    assert create_album.status_code == 201
    album_id = create_album.json()["id"]

    # Neither user can see the album before any invite
    assert (await journey_client.get(f"/api/v1/albums/{album_id}", headers=viewer_headers)).status_code == 404
    assert (await journey_client.get(f"/api/v1/albums/{album_id}", headers=rejecter_headers)).status_code == 404

    # Send invites
    invite_viewer = await journey_client.post(
        f"/api/v1/albums/{album_id}/shares",
        json={"username": viewer_username, "role": "viewer"},
        headers=owner_headers,
    )
    assert invite_viewer.status_code in (200, 201)
    assert invite_viewer.json()["status"] == "pending"

    invite_rejecter = await journey_client.post(
        f"/api/v1/albums/{album_id}/shares",
        json={"username": rejecter_username, "role": "viewer"},
        headers=owner_headers,
    )
    assert invite_rejecter.status_code in (200, 201)
    assert invite_rejecter.json()["status"] == "pending"

    # Album still not accessible while invites are pending
    assert (await journey_client.get(f"/api/v1/albums/{album_id}", headers=viewer_headers)).status_code == 404
    assert (await journey_client.get(f"/api/v1/albums/{album_id}", headers=rejecter_headers)).status_code == 404

    # Album does not appear in the list endpoint while invite is pending
    viewer_list = await journey_client.get("/api/v1/albums", headers=viewer_headers)
    assert viewer_list.status_code == 200
    assert not any(item["id"] == album_id for item in viewer_list.json()["items"])

    # Viewer accepts; rejecter rejects
    viewer_notifications = await journey_client.get("/api/v1/me/notifications", headers=viewer_headers)
    viewer_invite_notification_id = viewer_notifications.json()["items"][0]["id"]
    accept = await journey_client.post(
        f"/api/v1/me/notifications/{viewer_invite_notification_id}/accept",
        headers=viewer_headers,
    )
    assert accept.status_code == 200
    assert accept.json()["data"]["invite_status"] == "accepted"

    rejecter_notifications = await journey_client.get("/api/v1/me/notifications", headers=rejecter_headers)
    rejecter_invite_notification_id = rejecter_notifications.json()["items"][0]["id"]
    reject = await journey_client.post(
        f"/api/v1/me/notifications/{rejecter_invite_notification_id}/reject",
        headers=rejecter_headers,
    )
    assert reject.status_code == 200
    assert reject.json()["data"]["invite_status"] == "rejected"

    # Viewer now has access; rejecter does not
    assert (await journey_client.get(f"/api/v1/albums/{album_id}", headers=viewer_headers)).status_code == 200
    assert (await journey_client.get(f"/api/v1/albums/{album_id}", headers=rejecter_headers)).status_code == 404

    # Album appears in the list for the accepted viewer but not the rejecter
    viewer_list_after = await journey_client.get("/api/v1/albums", headers=viewer_headers)
    assert viewer_list_after.status_code == 200
    assert any(item["id"] == album_id for item in viewer_list_after.json()["items"])

    rejecter_list_after = await journey_client.get("/api/v1/albums", headers=rejecter_headers)
    assert rejecter_list_after.status_code == 200
    assert not any(item["id"] == album_id for item in rejecter_list_after.json()["items"])
