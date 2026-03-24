import uuid
from datetime import datetime, timedelta, timezone

from backend.app.config import settings
from backend.app.services.auth import verify_password
from backend.tests.api_test_support import gif_bytes, mov_bytes, mp4_bytes, png_bytes, webm_bytes
from backend.app.models.auth import User
from backend.app.models.media import Media


def _login(api, username: str, password: str = "password123") -> dict:
    response = api.client.post("/auth/login", data={"username": username, "password": password})
    assert response.status_code == 200, response.text
    return response.json()


def _logout(api, refresh_token: str):
    response = api.client.post("/auth/logout", json={"refresh_token": refresh_token})
    assert response.status_code == 204, response.text


def test_login_preflight_allows_loopback_frontend_origin(api):
    response = api.client.options(
        "/auth/login",
        headers={
            "Origin": "http://127.0.0.1:4200",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:4200"


def test_upload_config_exposes_current_limits(api):
    user = api.register_and_login("upload-config-user")
    response = api.client.get("/config/upload", headers=api.auth_headers(user["access_token"]))

    assert response.status_code == 200
    payload = response.json()
    assert payload["max_batch_size"] == settings.max_batch_size
    assert payload["max_upload_size_mb"] == settings.max_upload_size_mb


def test_register_hashes_password_in_database(api):
    password = "plain-password123"
    response = api.client.post(
        "/auth/register",
        json={
            "username": "hashed-api-user",
            "email": "hashed-api-user@example.com",
            "password": password,
        },
    )

    assert response.status_code == 201, response.text

    async def _fetch_user(session):
        return await session.get(User, uuid.UUID(response.json()["id"]))

    stored_user = api.run_db(_fetch_user)
    assert stored_user is not None
    assert stored_user.hashed_password != password
    assert verify_password(password, stored_user.hashed_password) is True


def test_register_rejects_duplicate_username_and_email_via_api(api):
    first = api.client.post(
        "/auth/register",
        json={
            "username": "unique-guard-user",
            "email": "unique-guard-user@example.com",
            "password": "password123",
        },
    )
    assert first.status_code == 201, first.text

    duplicate_username = api.client.post(
        "/auth/register",
        json={
            "username": "unique-guard-user",
            "email": "another@example.com",
            "password": "password123",
        },
    )
    assert duplicate_username.status_code == 409
    assert duplicate_username.json()["detail"] == "Username already taken"

    duplicate_email = api.client.post(
        "/auth/register",
        json={
            "username": "different-unique-guard-user",
            "email": "unique-guard-user@example.com",
            "password": "password123",
        },
    )
    assert duplicate_email.status_code == 409
    assert duplicate_email.json()["detail"] == "Email already registered"


def test_password_update_rehashes_password_and_invalidates_old_login(api):
    created = api.register_and_login("password-update-user")
    user_id = uuid.UUID(created["user"]["id"])

    async def _fetch_hash(session):
        user = await session.get(User, user_id)
        return user.hashed_password

    old_hash = api.run_db(_fetch_hash)

    update = api.client.patch(
        "/me",
        headers=api.auth_headers(created["access_token"]),
        json={"password": "new-password123"},
    )
    assert update.status_code == 200, update.text

    new_hash = api.run_db(_fetch_hash)
    assert new_hash != old_hash
    assert new_hash != "new-password123"
    assert verify_password("new-password123", new_hash) is True

    old_login = api.client.post(
        "/auth/login",
        data={"username": "password-update-user", "password": "password123"},
    )
    assert old_login.status_code == 401

    new_login = api.client.post(
        "/auth/login",
        data={"username": "password-update-user", "password": "new-password123"},
    )
    assert new_login.status_code == 200, new_login.text


def test_user_journey_upload_auto_tag_and_discover_media(api):
    registered = api.register_and_login("journey-discovery")
    _logout(api, registered["refresh_token"])

    logged_in = _login(api, "journey-discovery")
    headers = api.auth_headers(logged_in["access_token"])

    blue = api.upload_media(logged_in["access_token"], "journey-blue.png", (0, 0, 255))
    green = api.upload_media(logged_in["access_token"], "journey-green.png", (0, 255, 0))
    red = api.upload_media(logged_in["access_token"], "journey-red.png", (255, 0, 0))
    api.wait_for_media_status(str(blue["id"]))
    api.wait_for_media_status(str(green["id"]))
    api.wait_for_media_status(str(red["id"]))

    visible_library = api.client.get("/media", headers=headers)
    assert visible_library.status_code == 200
    assert visible_library.json()["total"] == 2

    sky_search = api.client.get("/media", headers=headers, params={"tag": "sky"})
    assert sky_search.status_code == 200
    assert [item["id"] for item in sky_search.json()["items"]] == [str(blue["id"])]

    character_search = api.client.get("/media", headers=headers, params={"character_name": "rei"})
    assert character_search.status_code == 200
    assert [item["id"] for item in character_search.json()["items"]] == [str(blue["id"])]

    combined_search = api.client.get(
        "/media",
        headers=headers,
        params={"tag": "sky", "character_name": "ayanami"},
    )
    assert combined_search.status_code == 200
    assert [item["id"] for item in combined_search.json()["items"]] == [str(blue["id"])]

    combined_miss = api.client.get(
        "/media",
        headers=headers,
        params={"tag": "forest", "character_name": "ayanami"},
    )
    assert combined_miss.status_code == 200
    assert combined_miss.json()["items"] == []

    manual_edit = api.client.patch(
        f"/media/{blue['id']}",
        headers=headers,
        json={"tags": ["pilot", "rating:general"], "entities": [{"entity_type": "character", "name": "ikari_shinji"}]},
    )
    assert manual_edit.status_code == 200
    assert set(manual_edit.json()["tags"]) == {"pilot", "rating:general"}
    assert any(e["name"] == "ikari_shinji" and e["entity_type"] == "character" for e in manual_edit.json()["entities"])
    assert manual_edit.json()["metadata"]["captured_at"]

    manual_timestamp = api.client.patch(
        f"/media/{blue['id']}",
        headers=headers,
        json={"metadata": {"captured_at": "2020-03-21T10:30:00Z"}},
    )
    assert manual_timestamp.status_code == 200
    assert manual_timestamp.json()["metadata"]["captured_at"] == "2020-03-21T10:30:00Z"

    corrected_search = api.client.get(
        "/media",
        headers=headers,
        params={"tag": "pilot", "character_name": "shinji"},
    )
    assert corrected_search.status_code == 200
    assert [item["id"] for item in corrected_search.json()["items"]] == [str(blue["id"])]

    stale_search = api.client.get("/media", headers=headers, params={"tag": "sky"})
    assert stale_search.status_code == 200
    assert stale_search.json()["items"] == []

    forest_search = api.client.get("/media", headers=headers, params={"tag": "forest"})
    assert forest_search.status_code == 200
    assert [item["id"] for item in forest_search.json()["items"]] == [str(green["id"])]

    tag_prefix = api.client.get("/tags", headers=headers, params={"q": "bl"})
    assert tag_prefix.status_code == 200
    assert tag_prefix.json()["items"] == []

    rating_tags = api.client.get("/tags", headers=headers, params={"category": 9})
    assert rating_tags.status_code == 200
    assert {item["name"] for item in rating_tags.json()["items"]} == {"rating:general", "rating:questionable"}

    show_nsfw = api.client.patch("/me", headers=headers, json={"show_nsfw": True})
    assert show_nsfw.status_code == 200

    nsfw_search = api.client.get("/media", headers=headers, params={"tag": "rose", "nsfw": "include"})
    assert nsfw_search.status_code == 200
    assert [item["id"] for item in nsfw_search.json()["items"]] == [str(red["id"])]

    clear_entities = api.client.patch(
        f"/media/{blue['id']}",
        headers=headers,
        json={"entities": []},
    )
    assert clear_entities.status_code == 200
    assert clear_entities.json()["entities"] == []

    refreshed = api.client.post("/auth/refresh", json={"refresh_token": logged_in["refresh_token"]})
    assert refreshed.status_code == 200

    _logout(api, logged_in["refresh_token"])
    refresh_after_logout = api.client.post("/auth/refresh", json={"refresh_token": logged_in["refresh_token"]})
    assert refresh_after_logout.status_code == 401


def test_user_journey_upload_and_discover_mixed_media(api):
    logged_in = _login(api, api.register_and_login("journey-mixed")["user"]["username"])
    headers = api.auth_headers(logged_in["access_token"])

    gif_item = api.upload_media_bytes(
        logged_in["access_token"],
        "journey-animated.gif",
        gif_bytes([(0, 0, 255), (255, 0, 0), (0, 255, 0)]),
        "image/gif",
    )
    mp4_item = api.upload_media_bytes(
        logged_in["access_token"],
        "journey-video.mp4",
        mp4_bytes([(0, 0, 255), (255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 0, 0)]),
        "video/mp4",
    )
    webm_item = api.upload_media_bytes(
        logged_in["access_token"],
        "journey-video.webm",
        webm_bytes([(0, 255, 0), (0, 0, 255), (0, 255, 0), (0, 0, 255), (0, 255, 0)]),
        "video/webm",
    )
    mov_item = api.upload_media_bytes(
        logged_in["access_token"],
        "journey-video.mov",
        mov_bytes([(255, 0, 0), (0, 0, 255), (255, 0, 0), (0, 0, 255), (255, 0, 0)]),
        "video/quicktime",
    )

    for item in (gif_item, mp4_item, webm_item, mov_item):
        api.wait_for_media_status(str(item["id"]))

    enabled = api.client.patch("/me", headers=headers, json={"show_nsfw": True})
    assert enabled.status_code == 200

    library = api.client.get("/media", headers=headers, params={"nsfw": "include"})
    assert library.status_code == 200
    assert {item["id"] for item in library.json()["items"]} >= {
        str(gif_item["id"]),
        str(mp4_item["id"]),
        str(webm_item["id"]),
        str(mov_item["id"]),
    }

    gif_detail = api.client.get(f"/media/{gif_item['id']}", headers=headers)
    mp4_detail = api.client.get(f"/media/{mp4_item['id']}", headers=headers)
    assert gif_detail.status_code == 200
    assert mp4_detail.status_code == 200
    assert gif_detail.json()["media_type"] == "gif"
    assert mp4_detail.json()["media_type"] == "video"
    assert "sky" in gif_detail.json()["tags"]
    assert "rose" in mp4_detail.json()["tags"]
    assert mp4_detail.json()["metadata"]["duration_seconds"] is not None

    assert api.client.get(f"/media/{gif_item['id']}/thumbnail", headers=headers).status_code == 200
    assert api.client.get(f"/media/{mp4_item['id']}/thumbnail", headers=headers).status_code == 200


def test_user_journey_create_filter_and_delete_album(api):
    logged_in = _login(api, api.register_and_login("journey-albums")["user"]["username"])
    headers = api.auth_headers(logged_in["access_token"])

    blue = api.upload_media(logged_in["access_token"], "journey-album-blue.png", (0, 0, 255))
    green = api.upload_media(logged_in["access_token"], "journey-album-green.png", (0, 255, 0))
    red = api.upload_media(logged_in["access_token"], "journey-album-red.png", (255, 0, 0))
    api.wait_for_media_status(str(blue["id"]))
    api.wait_for_media_status(str(green["id"]))
    api.wait_for_media_status(str(red["id"]))

    created = api.client.post("/albums", headers=headers, json={"name": "Journey Album"})
    assert created.status_code == 201
    album_id = created.json()["id"]

    add_media = api.client.put(
        f"/albums/{album_id}/media",
        headers=headers,
        json={"media_ids": [str(blue["id"]), str(green["id"])]},
    )
    assert add_media.status_code == 200
    assert add_media.json() == {"processed": 2, "skipped": 0}

    album_media = api.client.get(f"/albums/{album_id}/media", headers=headers)
    assert album_media.status_code == 200
    assert {item["id"] for item in album_media.json()["items"]} == {str(blue["id"]), str(green["id"])}

    album_search = api.client.get("/media", headers=headers, params={"album_id": album_id})
    assert album_search.status_code == 200
    assert {item["id"] for item in album_search.json()["items"]} == {str(blue["id"]), str(green["id"])}

    mixed_filter_search = api.client.get(
        "/media",
        headers=headers,
        params={"album_id": album_id, "tag": "sky", "status": "done"},
    )
    assert mixed_filter_search.status_code == 200
    assert [item["id"] for item in mixed_filter_search.json()["items"]] == [str(blue["id"])]

    renamed = api.client.patch(f"/albums/{album_id}", headers=headers, json={"name": "Journey Album Renamed"})
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Journey Album Renamed"

    deleted = api.client.delete(f"/albums/{album_id}", headers=headers)
    assert deleted.status_code == 204

    deleted_detail = api.client.get(f"/albums/{album_id}", headers=headers)
    assert deleted_detail.status_code == 404

    deleted_album_search = api.client.get("/media", headers=headers, params={"album_id": album_id})
    assert deleted_album_search.status_code == 404


def test_user_journey_manage_tags_and_character_names(api):
    logged_in = _login(api, api.register_and_login("journey-tag-management")["user"]["username"])
    headers = api.auth_headers(logged_in["access_token"])

    blue = api.upload_media(logged_in["access_token"], "journey-tag-blue.png", (0, 0, 255))
    green = api.upload_media(logged_in["access_token"], "journey-tag-green.png", (0, 255, 0))
    for item in (blue, green):
        api.wait_for_media_status(str(item["id"]))

    trash_by_character = api.client.post("/character-names/ayanami_rei/actions/trash-media", headers=headers)
    assert trash_by_character.status_code == 200
    assert trash_by_character.json()["matched_media"] == 1
    assert trash_by_character.json()["trashed_media"] == 1

    forest_tags = api.client.get("/tags", headers=headers, params={"q": "forest"})
    assert forest_tags.status_code == 200
    forest_tag_id = forest_tags.json()["items"][0]["id"]
    trash_by_tag = api.client.post(f"/tags/{forest_tag_id}/actions/trash-media", headers=headers)
    assert trash_by_tag.status_code == 200
    assert trash_by_tag.json()["matched_media"] == 1
    assert trash_by_tag.json()["trashed_media"] == 1

    trash = api.client.get("/media", headers=headers, params={"state": "trashed", "nsfw": "include"})
    assert trash.status_code == 200
    assert {item["id"] for item in trash.json()["items"]} == {str(blue["id"]), str(green["id"])}

    delete_character = api.client.post("/character-names/ayanami_rei/actions/remove-from-media", headers=headers)
    assert delete_character.status_code == 200
    assert delete_character.json()["matched_media"] == 1
    assert delete_character.json()["updated_media"] == 1

    character_search = api.client.get("/media", headers=headers, params={"character_name": "ayanami", "state": "trashed"})
    assert character_search.status_code == 200
    assert character_search.json()["items"] == []

    character_suggestions = api.client.get("/media/character-suggestions", headers=headers, params={"q": "aya"})
    assert character_suggestions.status_code == 200
    assert character_suggestions.json() == []

    forest_tags2 = api.client.get("/tags", headers=headers, params={"q": "forest"})
    assert forest_tags2.status_code == 200
    forest_tag_id2 = forest_tags2.json()["items"][0]["id"]
    delete_tag = api.client.post(f"/tags/{forest_tag_id2}/actions/remove-from-media", headers=headers)
    assert delete_tag.status_code == 200
    assert delete_tag.json()["matched_media"] == 1
    assert delete_tag.json()["updated_media"] == 1
    assert delete_tag.json()["deleted_tag"] is True

    forest_search = api.client.get("/media", headers=headers, params={"tag": "forest", "state": "trashed"})
    assert forest_search.status_code == 200
    assert forest_search.json()["items"] == []

    forest_tags = api.client.get("/tags", headers=headers, params={"q": "fo"})
    assert forest_tags.status_code == 200
    assert forest_tags.json()["items"] == []


def test_user_journey_query_trash_and_purge_uploaded_media(api):
    logged_in = _login(api, api.register_and_login("journey-trash-purge")["user"]["username"])
    headers = api.auth_headers(logged_in["access_token"])

    enable_nsfw = api.client.patch("/me", headers=headers, json={"show_nsfw": True})
    assert enable_nsfw.status_code == 200

    blue_image = api.upload_media(logged_in["access_token"], "journey-blue-image.png", (0, 0, 255))
    green_image = api.upload_media(logged_in["access_token"], "journey-green-image.png", (0, 255, 0))
    red_video = api.upload_media_bytes(
        logged_in["access_token"],
        "journey-red-video.mp4",
        mp4_bytes([(255, 0, 0)] * 5),
        "video/mp4",
    )
    blue_video = api.upload_media_bytes(
        logged_in["access_token"],
        "journey-blue-video.mov",
        mov_bytes([(0, 0, 255)] * 5),
        "video/quicktime",
    )

    for item in (blue_image, green_image, red_video, blue_video):
        api.wait_for_media_status(str(item["id"]))

    captured_at = datetime(2026, 3, 21, 12, 0, tzinfo=timezone.utc)
    for item in (blue_image, green_image, red_video, blue_video):
        api.set_media_captured_at(str(item["id"]), captured_at)

    library = api.client.get("/media", headers=headers, params={"nsfw": "include", "status": "done"})
    assert library.status_code == 200
    assert {item["id"] for item in library.json()["items"]} == {
        str(blue_image["id"]),
        str(green_image["id"]),
        str(red_video["id"]),
        str(blue_video["id"]),
    }

    sky_search = api.client.get("/media", headers=headers, params={"tag": "sky"})
    assert sky_search.status_code == 200
    assert {item["id"] for item in sky_search.json()["items"]} == {str(blue_image["id"]), str(blue_video["id"])}

    character_search = api.client.get("/media", headers=headers, params={"character_name": "rei"})
    assert character_search.status_code == 200
    assert {item["id"] for item in character_search.json()["items"]} == {str(blue_image["id"]), str(blue_video["id"])}

    mixed_search = api.client.get(
        "/media",
        headers=headers,
        params={"tag": ["sky", "rose"], "mode": "or", "exclude_tag": "forest", "nsfw": "include"},
    )
    assert mixed_search.status_code == 200
    assert {item["id"] for item in mixed_search.json()["items"]} == {
        str(blue_image["id"]),
        str(red_video["id"]),
        str(blue_video["id"]),
    }

    red_video_detail = api.client.get(f"/media/{red_video['id']}", headers=headers)
    assert red_video_detail.status_code == 200
    assert red_video_detail.json()["media_type"] == "video"
    assert "rose" in red_video_detail.json()["tags"]
    assert red_video_detail.json()["metadata"]["duration_seconds"] is not None

    blue_image_detail = api.client.get(f"/media/{blue_image['id']}", headers=headers)
    assert blue_image_detail.status_code == 200
    assert blue_image_detail.json()["media_type"] == "image"
    assert any(e["name"] == "ayanami_rei" and e["entity_type"] == "character" for e in blue_image_detail.json()["entities"])

    video_only = api.client.get("/media", headers=headers, params={"media_type": "video", "nsfw": "include"})
    assert video_only.status_code == 200
    assert {item["id"] for item in video_only.json()["items"]} == {str(red_video["id"]), str(blue_video["id"])}

    image_and_video = api.client.get("/media", headers=headers, params={"media_type": ["image", "video"], "nsfw": "include"})
    assert image_and_video.status_code == 200
    assert {item["id"] for item in image_and_video.json()["items"]} == {
        str(blue_image["id"]),
        str(green_image["id"]),
        str(red_video["id"]),
        str(blue_video["id"]),
    }

    done_and_failed = api.client.get("/media", headers=headers, params={"status": "done,failed", "nsfw": "include"})
    assert done_and_failed.status_code == 200
    assert {item["id"] for item in done_and_failed.json()["items"]} == {
        str(blue_image["id"]),
        str(green_image["id"]),
        str(red_video["id"]),
        str(blue_video["id"]),
    }

    after_cutoff = api.client.get("/media", headers=headers, params={"captured_after": "2026-03-21T00:00:00Z", "nsfw": "include"})
    assert after_cutoff.status_code == 200
    assert {item["id"] for item in after_cutoff.json()["items"]} == {
        str(blue_image["id"]),
        str(green_image["id"]),
        str(red_video["id"]),
        str(blue_video["id"]),
    }

    before_cutoff = api.client.get("/media", headers=headers, params={"captured_before": "2026-03-21T23:59:59Z", "nsfw": "include"})
    assert before_cutoff.status_code == 200
    assert {item["id"] for item in before_cutoff.json()["items"]} == {
        str(blue_image["id"]),
        str(green_image["id"]),
        str(red_video["id"]),
        str(blue_video["id"]),
    }

    character_suggestions = api.client.get("/media/character-suggestions", headers=headers, params={"q": "aya"})
    assert character_suggestions.status_code == 200
    assert character_suggestions.json()[0]["name"] == "ayanami_rei"
    assert character_suggestions.json()[0]["media_count"] == 2

    move_to_trash = api.client.patch(
        "/media",
        headers=headers,
        json={"media_ids": [str(green_image["id"]), str(red_video["id"])], "deleted": True},
    )
    assert move_to_trash.status_code == 200
    assert move_to_trash.json() == {"processed": 2, "skipped": 0}

    active_after_delete = api.client.get("/media", headers=headers, params={"nsfw": "include"})
    assert active_after_delete.status_code == 200
    assert {item["id"] for item in active_after_delete.json()["items"]} == {str(blue_image["id"]), str(blue_video["id"])}

    trash = api.client.get("/media", headers=headers, params={"state": "trashed"})
    assert trash.status_code == 200
    assert {item["id"] for item in trash.json()["items"]} == {str(green_image["id"]), str(red_video["id"])}

    trashed_green_file = api.client.get(f"/media/{green_image['id']}/file", headers=headers)
    assert trashed_green_file.status_code == 200
    trashed_green_thumbnail = api.client.get(f"/media/{green_image['id']}/thumbnail", headers=headers)
    assert trashed_green_thumbnail.status_code == 200

    trash_query = api.client.get(
        "/media",
        headers=headers,
        params={"state": "trashed", "tag": "rose", "nsfw": "include"},
    )
    assert trash_query.status_code == 200
    assert [item["id"] for item in trash_query.json()["items"]] == [str(red_video["id"])]

    restore_green = api.client.patch(f"/media/{green_image['id']}", headers=headers, json={"deleted": False})
    assert restore_green.status_code == 200
    assert restore_green.json()["deleted_at"] is None

    active_after_restore = api.client.get("/media", headers=headers, params={"nsfw": "include"})
    assert active_after_restore.status_code == 200
    assert {item["id"] for item in active_after_restore.json()["items"]} == {
        str(blue_image["id"]),
        str(green_image["id"]),
        str(blue_video["id"]),
    }

    trash_after_restore = api.client.get("/media", headers=headers, params={"state": "trashed", "nsfw": "include"})
    assert trash_after_restore.status_code == 200
    assert [item["id"] for item in trash_after_restore.json()["items"]] == [str(red_video["id"])]

    empty_trash = api.client.post("/media/actions/empty-trash", headers=headers)
    assert empty_trash.status_code == 204

    trash_after_purge = api.client.get("/media", headers=headers, params={"state": "trashed"})
    assert trash_after_purge.status_code == 200
    assert trash_after_purge.json()["items"] == []

    missing_red_detail = api.client.get(f"/media/{red_video['id']}", headers=headers)
    assert missing_red_detail.status_code == 404
    restored_green_detail = api.client.get(f"/media/{green_image['id']}", headers=headers)
    assert restored_green_detail.status_code == 200
    missing_red_file = api.client.get(f"/media/{red_video['id']}/file", headers=headers)
    assert missing_red_file.status_code == 404
    missing_red_thumbnail = api.client.get(f"/media/{red_video['id']}/thumbnail", headers=headers)
    assert missing_red_thumbnail.status_code == 404

    rose_after_purge = api.client.get("/media", headers=headers, params={"tag": "rose", "nsfw": "include"})
    assert rose_after_purge.status_code == 200
    assert rose_after_purge.json()["items"] == []

    sky_after_purge = api.client.get("/media", headers=headers, params={"tag": "sky"})
    assert sky_after_purge.status_code == 200
    assert {item["id"] for item in sky_after_purge.json()["items"]} == {str(blue_image["id"]), str(blue_video["id"])}

    assert api.fetch_media_row(uuid.UUID(str(green_image["id"]))) is not None
    assert api.fetch_media_row(uuid.UUID(str(red_video["id"]))) is None


def test_reupload_after_emptying_trash_clears_duplicate_detection(api):
    logged_in = _login(api, api.register_and_login("journey-reupload-after-purge")["user"]["username"])
    headers = api.auth_headers(logged_in["access_token"])

    initial_upload = api.client.post(
        "/media",
        headers=headers,
        files=[
            ("files", ("reupload-a.png", png_bytes((0, 0, 255)), "image/png")),
            ("files", ("reupload-b.png", png_bytes((0, 255, 0)), "image/png")),
            ("files", ("reupload-c.png", png_bytes((255, 0, 0)), "image/png")),
        ],
    )
    assert initial_upload.status_code == 202
    initial_payload = initial_upload.json()
    assert initial_payload["accepted"] == 3
    assert initial_payload["duplicates"] == 0
    assert initial_payload["errors"] == 0

    media_ids = [result["id"] for result in initial_payload["results"]]
    for media_id in media_ids:
        api.wait_for_media_status(str(media_id))

    duplicate_upload = api.client.post(
        "/media",
        headers=headers,
        files=[
            ("files", ("reupload-a-copy.png", png_bytes((0, 0, 255)), "image/png")),
            ("files", ("reupload-b-copy.png", png_bytes((0, 255, 0)), "image/png")),
            ("files", ("reupload-c-copy.png", png_bytes((255, 0, 0)), "image/png")),
        ],
    )
    assert duplicate_upload.status_code == 202
    duplicate_payload = duplicate_upload.json()
    assert duplicate_payload["accepted"] == 0
    assert duplicate_payload["duplicates"] == 3
    assert duplicate_payload["errors"] == 0
    assert [result["status"] for result in duplicate_payload["results"]] == ["duplicate", "duplicate", "duplicate"]

    move_to_trash = api.client.patch(
        "/media",
        headers=headers,
        json={"media_ids": media_ids, "deleted": True},
    )
    assert move_to_trash.status_code == 200
    assert move_to_trash.json() == {"processed": 3, "skipped": 0}

    empty_trash = api.client.post("/media/actions/empty-trash", headers=headers)
    assert empty_trash.status_code == 204

    reupload = api.client.post(
        "/media",
        headers=headers,
        files=[
            ("files", ("reupload-a-again.png", png_bytes((0, 0, 255)), "image/png")),
            ("files", ("reupload-b-again.png", png_bytes((0, 255, 0)), "image/png")),
            ("files", ("reupload-c-again.png", png_bytes((255, 0, 0)), "image/png")),
        ],
    )
    assert reupload.status_code == 202
    reupload_payload = reupload.json()
    assert reupload_payload["accepted"] == 3
    assert reupload_payload["duplicates"] == 0
    assert reupload_payload["errors"] == 0
    assert [result["status"] for result in reupload_payload["results"]] == ["accepted", "accepted", "accepted"]


def test_expired_trash_is_auto_purged_before_listing_and_reupload(api):
    logged_in = _login(api, api.register_and_login("journey-expired-trash")["user"]["username"])
    headers = api.auth_headers(logged_in["access_token"])

    uploaded = api.upload_media(logged_in["access_token"], "expired-trash.png", (0, 0, 255))
    api.wait_for_media_status(str(uploaded["id"]))

    trashed = api.client.patch(
        f"/media/{uploaded['id']}",
        headers=headers,
        json={"deleted": True},
    )
    assert trashed.status_code == 200

    async def _age_trash(session):
        media = await session.get(Media, uuid.UUID(str(uploaded["id"])))
        media.deleted_at = datetime.now(timezone.utc) - timedelta(days=31)
        await session.commit()

    api.run_db(_age_trash)

    trash = api.client.get("/media", headers=headers, params={"state": "trashed"})
    assert trash.status_code == 200
    assert trash.json()["items"] == []
    assert api.fetch_media_row(uuid.UUID(str(uploaded["id"]))) is None

    reupload = api.client.post(
        "/media",
        headers=headers,
        files=[("files", ("expired-trash-reupload.png", png_bytes((0, 0, 255)), "image/png"))],
    )
    assert reupload.status_code == 202
    reupload_payload = reupload.json()
    assert reupload_payload["accepted"] == 1
    assert reupload_payload["duplicates"] == 0
    assert reupload_payload["errors"] == 0
    assert reupload_payload["results"][0]["status"] == "accepted"


def test_user_journey_full_personal_library_workflow(api):
    registered = api.register_and_login("journey-library")
    _logout(api, registered["refresh_token"])

    logged_in = _login(api, "journey-library")
    headers = api.auth_headers(logged_in["access_token"])

    first = api.upload_media(logged_in["access_token"], "keep-blue.png", (0, 0, 255))
    second = api.upload_media(logged_in["access_token"], "archive-green.png", (0, 255, 0))
    third = api.upload_media(logged_in["access_token"], "discard-red.png", (255, 0, 0))
    api.wait_for_media_status(str(first["id"]))
    api.wait_for_media_status(str(second["id"]))
    api.wait_for_media_status(str(third["id"]))

    album = api.client.post("/albums", headers=headers, json={"name": "Reference Set"})
    assert album.status_code == 201
    album_id = album.json()["id"]

    add_media = api.client.put(
        f"/albums/{album_id}/media",
        headers=headers,
        json={"media_ids": [str(first["id"]), str(second["id"]), str(third["id"])]},
    )
    assert add_media.status_code == 200
    assert add_media.json() == {"processed": 3, "skipped": 0}

    favorite = api.client.patch(f"/media/{first['id']}", headers=headers, json={"favorited": True})
    assert favorite.status_code == 200

    favorite_view = api.client.get("/media", headers=headers, params={"favorited": "true"})
    assert favorite_view.status_code == 200
    assert [item["id"] for item in favorite_view.json()["items"]] == [str(first["id"])]

    bulk_delete = api.client.patch(
        "/media",
        headers=headers,
        json={"media_ids": [str(second["id"]), str(third["id"])], "deleted": True},
    )
    assert bulk_delete.status_code == 200
    assert bulk_delete.json() == {"processed": 2, "skipped": 0}

    album_after_delete = api.client.get(f"/albums/{album_id}/media", headers=headers)
    assert album_after_delete.status_code == 200
    assert [item["id"] for item in album_after_delete.json()["items"]] == [str(first["id"])]

    trash = api.client.get("/media", headers=headers, params={"state": "trashed"})
    assert trash.status_code == 200
    assert {item["id"] for item in trash.json()["items"]} == {str(second["id"]), str(third["id"])}

    bulk_restore = api.client.patch(
        "/media",
        headers=headers,
        json={"media_ids": [str(second["id"]), str(third["id"])], "deleted": False},
    )
    assert bulk_restore.status_code == 200
    assert bulk_restore.json() == {"processed": 2, "skipped": 0}

    restored_album = api.client.get(f"/albums/{album_id}/media", headers=headers)
    assert restored_album.status_code == 200
    assert {item["id"] for item in restored_album.json()["items"]} == {
        str(first["id"]),
        str(second["id"]),
    }

    bulk_unfavorite = api.client.patch(
        "/media",
        headers=headers,
        json={"media_ids": [str(first["id"])], "favorited": False},
    )
    assert bulk_unfavorite.status_code == 200
    assert bulk_unfavorite.json() == {"processed": 1, "skipped": 0}

    download = api.client.get(f"/albums/{album_id}/download", headers=headers)
    assert download.status_code == 200
    assert download.headers["content-type"] == "application/zip"

    retag = api.client.post(f"/media/{first['id']}/tagging-jobs", headers=headers)
    assert retag.status_code == 202
    api.wait_for_media_status(str(first["id"]))

    now = api.fetch_media_row(first["id"]).captured_at
    api.set_media_captured_at(str(first["id"]), now.replace(year=now.year - 1))
    on_this_day = api.client.get(
        "/media",
        headers=headers,
        params={"captured_month": now.month, "captured_day": now.day, "captured_before_year": now.year + 1},
    )
    assert on_this_day.status_code == 200
    assert on_this_day.json()["items"]

    delete = api.client.request(
        "DELETE",
        "/media",
        headers=headers,
        json={"media_ids": [str(third["id"])]},
    )
    assert delete.status_code == 200
    assert delete.json() == {"processed": 1, "skipped": 0}

    trash_after_delete = api.client.get("/media", headers=headers, params={"state": "trashed"})
    assert trash_after_delete.status_code == 200
    assert [item["id"] for item in trash_after_delete.json()["items"]] == [str(third["id"])]

    empty_trash = api.client.post("/media/actions/empty-trash", headers=headers)
    assert empty_trash.status_code == 204
    assert api.fetch_media_row(uuid.UUID(str(third["id"]))) is None

    remove_from_album = api.client.request(
        "DELETE",
        f"/albums/{album_id}/media",
        headers=headers,
        json={"media_ids": [str(second["id"])]},
    )
    assert remove_from_album.status_code == 200
    assert remove_from_album.json() == {"processed": 1, "skipped": 0}

    delete_album = api.client.delete(f"/albums/{album_id}", headers=headers)
    assert delete_album.status_code == 204

    _logout(api, logged_in["refresh_token"])
    refresh_after_logout = api.client.post("/auth/refresh", json={"refresh_token": logged_in["refresh_token"]})
    assert refresh_after_logout.status_code == 401


def test_user_journey_collaboration_workflow(api):
    owner = api.register_and_login("journey-owner")
    collaborator = api.register_and_login("journey-viewer")
    _logout(api, owner["refresh_token"])
    _logout(api, collaborator["refresh_token"])

    owner_login = _login(api, "journey-owner")
    collaborator_login = _login(api, "journey-viewer")
    owner_headers = api.auth_headers(owner_login["access_token"])
    viewer_headers = api.auth_headers(collaborator_login["access_token"])

    first = api.upload_media(owner_login["access_token"], "shared-sky.png", (0, 0, 255))
    second = api.upload_media(owner_login["access_token"], "shared-forest.png", (0, 255, 0))
    api.wait_for_media_status(str(first["id"]))
    api.wait_for_media_status(str(second["id"]))

    album = api.client.post("/albums", headers=owner_headers, json={"name": "Shared Finds"})
    assert album.status_code == 201
    album_id = album.json()["id"]

    add_image = api.client.put(
        f"/albums/{album_id}/media",
        headers=owner_headers,
        json={"media_ids": [str(first["id"]), str(second["id"])]},
    )
    assert add_image.status_code == 200
    assert add_image.json() == {"processed": 2, "skipped": 0}

    share = api.client.post(
        f"/albums/{album_id}/shares",
        headers=owner_headers,
        json={"user_id": collaborator["user"]["id"], "role": "viewer"},
    )
    assert share.status_code == 201

    viewer_album_list = api.client.get("/albums", headers=viewer_headers)
    assert viewer_album_list.status_code == 200
    assert [item["id"] for item in viewer_album_list.json()["items"]] == [album_id]

    viewer_album_media = api.client.get(f"/albums/{album_id}/media", headers=viewer_headers)
    assert viewer_album_media.status_code == 200
    assert {item["id"] for item in viewer_album_media.json()["items"]} == {str(first["id"]), str(second["id"])}

    no_edit_yet = api.client.request(
        "DELETE",
        f"/albums/{album_id}/media",
        headers=viewer_headers,
        json={"media_ids": [str(first["id"])]},
    )
    assert no_edit_yet.status_code == 403

    upgrade_share = api.client.post(
        f"/albums/{album_id}/shares",
        headers=owner_headers,
        json={"user_id": collaborator["user"]["id"], "role": "editor"},
    )
    assert upgrade_share.status_code == 200

    bulk_remove = api.client.request(
        "DELETE",
        f"/albums/{album_id}/media",
        headers=viewer_headers,
        json={"media_ids": [str(second["id"])]},
    )
    assert bulk_remove.status_code == 200
    assert bulk_remove.json() == {"processed": 1, "skipped": 0}

    owner_favorite = api.client.patch(f"/media/{first['id']}", headers=owner_headers, json={"favorited": True})
    assert owner_favorite.status_code == 200

    collaborator_favorite = api.client.patch(
        f"/media/{first['id']}",
        headers=viewer_headers,
        json={"favorited": True},
    )
    assert collaborator_favorite.status_code == 200

    retag = api.client.post(f"/media/{first['id']}/tagging-jobs", headers=owner_headers)
    assert retag.status_code == 202
    api.wait_for_media_status(str(first["id"]))

    rediscovered = api.client.get("/media", headers=owner_headers, params={"tag": "sky"})
    assert rediscovered.status_code == 200
    assert [item["id"] for item in rediscovered.json()["items"]] == [str(first["id"])]

    revoke = api.client.delete(
        f"/albums/{album_id}/shares/{collaborator['user']['id']}",
        headers=owner_headers,
    )
    assert revoke.status_code == 204

    viewer_after_revoke = api.client.get(f"/albums/{album_id}", headers=viewer_headers)
    assert viewer_after_revoke.status_code == 404

    _logout(api, collaborator_login["refresh_token"])
    _logout(api, owner_login["refresh_token"])


def test_user_journey_admin_moderation_workflow(api):
    target = api.register_and_login("journey-target")
    _logout(api, target["refresh_token"])

    target_login = _login(api, "journey-target")
    target_headers = api.auth_headers(target_login["access_token"])
    uploaded = api.upload_media(target_login["access_token"], "admin-review.png", (0, 0, 255))
    api.wait_for_media_status(str(uploaded["id"]))
    _logout(api, target_login["refresh_token"])

    admin_login = _login(api, "admin", "admin")
    admin_headers = api.auth_headers(admin_login["access_token"])

    stats = api.client.get("/admin/stats", headers=admin_headers)
    assert stats.status_code == 200
    assert stats.json()["total_users"] >= 2

    users = api.client.get("/admin/users", headers=admin_headers, params={"page_size": 200})
    assert users.status_code == 200
    assert any(item["username"] == "journey-target" for item in users.json()["items"])

    detail = api.client.get(f"/admin/users/{target['user']['id']}", headers=admin_headers)
    assert detail.status_code == 200
    assert detail.json()["media_count"] == 1

    update = api.client.patch(
        f"/admin/users/{target['user']['id']}",
        headers=admin_headers,
        json={"show_nsfw": True},
    )
    assert update.status_code == 200
    assert update.json()["show_nsfw"] is True

    retag_all = api.client.post(
        f"/admin/users/{target['user']['id']}/tagging-jobs",
        headers=admin_headers,
    )
    assert retag_all.status_code == 202
    assert retag_all.json()["queued"] == 1
    api.wait_for_media_status(str(uploaded["id"]))

    trash_as_admin = api.client.patch(f"/media/{uploaded['id']}", headers=admin_headers, json={"deleted": True})
    assert trash_as_admin.status_code == 200

    trash_list = api.client.get("/media", headers=admin_headers, params={"state": "trashed"})
    assert trash_list.status_code == 200
    assert [item["id"] for item in trash_list.json()["items"]] == [str(uploaded["id"])]

    restore = api.client.patch(f"/media/{uploaded['id']}", headers=admin_headers, json={"deleted": False})
    assert restore.status_code == 200

    delete_user = api.client.delete(
        f"/admin/users/{target['user']['id']}",
        headers=admin_headers,
        params={"delete_media": "true"},
    )
    assert delete_user.status_code == 204

    missing_after_delete = api.client.get(f"/admin/users/{target['user']['id']}", headers=admin_headers)
    assert missing_after_delete.status_code == 404

    _logout(api, admin_login["refresh_token"])


def test_ocr_text_endpoint_set_and_search(api):
    user = api.register_and_login("ocr-api-user")
    headers = api.auth_headers(user["access_token"])

    blue = api.upload_media(user["access_token"], "ocr-api-blue.png", (0, 0, 255))
    green = api.upload_media(user["access_token"], "ocr-api-green.png", (0, 255, 0))
    api.wait_for_media_status(str(blue["id"]))
    api.wait_for_media_status(str(green["id"]))

    patch = api.client.patch(
        f"/media/{blue['id']}",
        headers=headers,
        json={"ocr_text_override": "Invoice total: $42.00"},
    )
    assert patch.status_code == 200
    assert patch.json()["ocr_text_override"] == "Invoice total: $42.00"

    detail = api.client.get(f"/media/{blue['id']}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["ocr_text_override"] == "Invoice total: $42.00"

    hit = api.client.get("/media", headers=headers, params={"ocr_text": "invoice"})
    assert hit.status_code == 200
    ids = [item["id"] for item in hit.json()["items"]]
    assert str(blue["id"]) in ids
    assert str(green["id"]) not in ids

    no_match = api.client.get("/media", headers=headers, params={"ocr_text": "nonexistent phrase xyz"})
    assert no_match.status_code == 200
    assert no_match.json()["items"] == []

    clear = api.client.patch(
        f"/media/{blue['id']}",
        headers=headers,
        json={"ocr_text_override": None},
    )
    assert clear.status_code == 200
    assert clear.json()["ocr_text_override"] is None

    after_clear = api.client.get("/media", headers=headers, params={"ocr_text": "invoice"})
    assert after_clear.status_code == 200
    assert after_clear.json()["items"] == []
