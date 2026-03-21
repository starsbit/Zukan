import io
import uuid
import zipfile
from datetime import datetime, timezone

from tests.api_test_support import png_bytes


def assert_auth_endpoints(api):
    auth = api.register_and_login("alice")
    headers = api.auth_headers(auth["access_token"])

    duplicate_username = api.client.post("/auth/register", json={
        "username": "alice",
        "email": "alice-2@example.com",
        "password": "password123",
    })
    assert duplicate_username.status_code == 400

    duplicate_email = api.client.post("/auth/register", json={
        "username": "alice-2",
        "email": "alice@example.com",
        "password": "password123",
    })
    assert duplicate_email.status_code == 400

    me = api.client.get("/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["username"] == "alice"
    assert me.json()["show_nsfw"] is False

    updated = api.client.patch("/auth/me", headers=headers, json={
        "show_nsfw": True,
        "password": "newpassword123",
    })
    assert updated.status_code == 200
    assert updated.json()["show_nsfw"] is True

    old_login = api.client.post("/auth/login", json={"username": "alice", "password": "password123"})
    assert old_login.status_code == 401

    login = api.client.post("/auth/login", json={"username": "alice", "password": "newpassword123"})
    assert login.status_code == 200
    login_json = login.json()

    refreshed = api.client.post("/auth/refresh", json={"refresh_token": login_json["refresh_token"]})
    assert refreshed.status_code == 200
    assert refreshed.json()["token_type"] == "bearer"
    assert refreshed.json()["access_token"]

    logged_out = api.client.post("/auth/logout", json={"refresh_token": auth["refresh_token"]})
    assert logged_out.status_code == 204

    refresh_after_logout = api.client.post("/auth/refresh", json={"refresh_token": auth["refresh_token"]})
    assert refresh_after_logout.status_code == 401

    invalid_logout = api.client.post("/auth/logout", json={"refresh_token": "not-a-real-token"})
    assert invalid_logout.status_code == 204


def assert_image_tag_search_and_favorite_endpoints(api):
    owner = api.register_and_login("owner")

    blue = api.upload_image(owner["access_token"], "blue-sky.png", (0, 0, 255))
    red = api.upload_image(owner["access_token"], "red-rose.png", (255, 0, 0))

    api.wait_for_image_status(str(blue["id"]))
    api.wait_for_image_status(str(red["id"]))

    nsfw_forbidden = api.client.get(
        "/images",
        headers=api.auth_headers(owner["access_token"]),
        params={"nsfw": "only"},
    )
    assert nsfw_forbidden.status_code == 403

    default_list = api.client.get("/images", headers=api.auth_headers(owner["access_token"]))
    assert default_list.status_code == 200
    assert [item["id"] for item in default_list.json()["items"]] == [str(blue["id"])]

    api.client.patch("/auth/me", headers=api.auth_headers(owner["access_token"]), json={"show_nsfw": True})

    nsfw_only = api.client.get("/images", headers=api.auth_headers(owner["access_token"]), params={"nsfw": "only"})
    assert nsfw_only.status_code == 200
    assert [item["id"] for item in nsfw_only.json()["items"]] == [str(red["id"])]

    by_tag = api.client.get("/images", headers=api.auth_headers(owner["access_token"]), params={
        "tags": "sky",
        "status": "done",
    })
    assert by_tag.status_code == 200
    assert by_tag.json()["total"] == 1

    by_or_tag = api.client.get("/images", headers=api.auth_headers(owner["access_token"]), params={
        "tags": "rose,sky",
        "mode": "or",
    })
    assert by_or_tag.status_code == 200
    assert by_or_tag.json()["total"] == 2

    excluded = api.client.get("/images", headers=api.auth_headers(owner["access_token"]), params={
        "exclude_tags": "rose",
        "nsfw": "include",
    })
    assert excluded.status_code == 200
    assert [item["id"] for item in excluded.json()["items"]] == [str(blue["id"])]

    detail = api.client.get(f"/images/{blue['id']}", headers=api.auth_headers(owner["access_token"]))
    assert detail.status_code == 200
    assert detail.json()["is_favorited"] is False
    assert [tag["name"] for tag in detail.json()["tag_details"]] == ["rating:general", "sky", "blue"]

    image_file = api.client.get(f"/images/{blue['id']}/file", headers=api.auth_headers(owner["access_token"]))
    assert image_file.status_code == 200
    assert image_file.headers["content-type"] == "image/png"

    thumbnail = api.client.get(f"/images/{blue['id']}/thumbnail", headers=api.auth_headers(owner["access_token"]))
    assert thumbnail.status_code == 200
    assert thumbnail.headers["content-type"] == "image/webp"

    favorite = api.client.post(f"/images/{blue['id']}/favorite", headers=api.auth_headers(owner["access_token"]))
    assert favorite.status_code == 204

    favorites = api.client.get("/images/favorites", headers=api.auth_headers(owner["access_token"]))
    assert favorites.status_code == 200
    assert favorites.json()["items"][0]["id"] == str(blue["id"])

    favorites_by_tag = api.client.get(
        "/images/favorites",
        headers=api.auth_headers(owner["access_token"]),
        params={"tags": "sky"},
    )
    assert favorites_by_tag.status_code == 200
    assert favorites_by_tag.json()["total"] == 1

    favorited_filter = api.client.get("/images", headers=api.auth_headers(owner["access_token"]), params={"favorited": "true"})
    assert favorited_filter.status_code == 200
    assert favorited_filter.json()["total"] == 1

    unfavorite = api.client.delete(f"/images/{blue['id']}/favorite", headers=api.auth_headers(owner["access_token"]))
    assert unfavorite.status_code == 204

    missing_favorite = api.client.delete(f"/images/{blue['id']}/favorite", headers=api.auth_headers(owner["access_token"]))
    assert missing_favorite.status_code == 404

    tags = api.client.get("/tags", headers=api.auth_headers(owner["access_token"]))
    assert tags.status_code == 200
    assert {tag["name"] for tag in tags.json()} >= {"sky", "rose"}

    rating_tags = api.client.get("/tags", headers=api.auth_headers(owner["access_token"]), params={"category": 9})
    assert rating_tags.status_code == 200
    assert {tag["name"] for tag in rating_tags.json()} == {"rating:general", "rating:questionable"}

    tag_search = api.client.get("/tags/search", headers=api.auth_headers(owner["access_token"]), params={"q": "sk"})
    assert tag_search.status_code == 200
    assert [tag["name"] for tag in tag_search.json()] == ["sky"]

    retag = api.client.post(f"/images/{blue['id']}/retag", headers=api.auth_headers(owner["access_token"]))
    assert retag.status_code == 202
    api.wait_for_image_status(str(blue["id"]))


def assert_image_lifecycle_download_and_on_this_day_endpoints(api):
    user = api.register_and_login("collector")
    headers = api.auth_headers(user["access_token"])

    first = api.upload_image(user["access_token"], "first.png", (0, 0, 255))
    second = api.upload_image(user["access_token"], "second.png", (0, 255, 0))
    api.wait_for_image_status(str(first["id"]))
    api.wait_for_image_status(str(second["id"]))

    download = api.client.post("/images/download", headers=headers, json={"image_ids": [str(first["id"]), str(second["id"])]})
    assert download.status_code == 200
    with zipfile.ZipFile(io.BytesIO(download.content)) as zf:
        assert set(zf.namelist()) == {"first.png", "second.png"}

    assert api.client.delete(f"/images/{first['id']}", headers=headers).status_code == 204
    trash = api.client.get("/images/trash", headers=headers)
    assert trash.status_code == 200
    assert trash.json()["items"][0]["id"] == str(first["id"])

    assert api.client.post(f"/images/{first['id']}/restore", headers=headers).status_code == 204

    now = datetime.now(timezone.utc)
    old_date = now.replace(year=now.year - 1)
    api.set_image_created_at(str(first["id"]), old_date)
    on_this_day = api.client.get("/images/on-this-day", headers=headers)
    assert on_this_day.status_code == 200
    assert on_this_day.json()["years"][0]["year"] == old_date.year

    assert api.client.delete(f"/images/{second['id']}", headers=headers).status_code == 204
    restored_upload = api.client.post(
        "/images/upload",
        headers=headers,
        files=[("files", ("second.png", png_bytes((0, 255, 0)), "image/png"))],
    )
    restored_json = restored_upload.json()
    assert restored_upload.status_code == 202
    assert restored_json["results"][0]["id"] == str(second["id"])
    api.wait_for_image_status(str(second["id"]))

    assert api.client.delete(f"/images/{first['id']}", headers=headers).status_code == 204
    assert api.client.post("/images/trash/empty", headers=headers).status_code == 204
    assert api.fetch_image_row(uuid.UUID(str(first["id"]))) is None

    assert api.client.delete(f"/images/{second['id']}/purge", headers=headers).status_code == 204
    assert api.fetch_image_row(uuid.UUID(str(second["id"]))) is None


def assert_image_upload_edge_cases(api):
    user = api.register_and_login("upload-user")
    headers = api.auth_headers(user["access_token"])

    accepted = api.client.post(
        "/images/upload",
        headers=headers,
        files=[("files", ("duplicate.png", png_bytes((0, 0, 255)), "image/png"))],
    )
    assert accepted.status_code == 202
    accepted_result = accepted.json()["results"][0]
    api.wait_for_image_status(str(accepted_result["id"]))

    duplicate = api.client.post(
        "/images/upload",
        headers=headers,
        files=[("files", ("duplicate-copy.png", png_bytes((0, 0, 255)), "image/png"))],
    )
    assert duplicate.status_code == 202
    duplicate_result = duplicate.json()
    assert duplicate_result["accepted"] == 0
    assert duplicate_result["duplicates"] == 1
    assert duplicate_result["results"][0]["status"] == "duplicate"

    invalid = api.client.post(
        "/images/upload",
        headers=headers,
        files=[("files", ("notes.txt", b"not an image", "text/plain"))],
    )
    assert invalid.status_code == 202
    invalid_result = invalid.json()
    assert invalid_result["accepted"] == 0
    assert invalid_result["errors"] == 1
    assert invalid_result["results"][0]["status"] == "error"

    download_missing = api.client.post(
        "/images/download",
        headers=headers,
        json={"image_ids": [str(uuid.uuid4())]},
    )
    assert download_missing.status_code == 404


def assert_album_endpoints(api):
    owner = api.register_and_login("album-owner")
    viewer = api.register_and_login("album-viewer")

    first = api.upload_image(owner["access_token"], "album-blue.png", (0, 0, 255))
    second = api.upload_image(owner["access_token"], "album-green.png", (0, 255, 0))
    api.wait_for_image_status(str(first["id"]))
    api.wait_for_image_status(str(second["id"]))

    created = api.client.post("/albums", headers=api.auth_headers(owner["access_token"]), json={
        "name": "Road Trip",
        "description": "Spring photos",
    })
    assert created.status_code == 201
    album = created.json()

    assert api.client.post(
        f"/albums/{album['id']}/images",
        headers=api.auth_headers(owner["access_token"]),
        json={"image_ids": [str(first["id"]), str(second["id"])]},
    ).status_code == 204

    listed = api.client.get("/albums", headers=api.auth_headers(owner["access_token"]))
    assert listed.status_code == 200
    assert listed.json()[0]["image_count"] == 2

    fetched = api.client.get(f"/albums/{album['id']}", headers=api.auth_headers(owner["access_token"]))
    assert fetched.status_code == 200
    assert fetched.json()["cover_image_id"] == str(first["id"])

    filtered_images = api.client.get(
        f"/albums/{album['id']}/images",
        headers=api.auth_headers(owner["access_token"]),
        params={"tags": "sky"},
    )
    assert filtered_images.status_code == 200
    assert [item["id"] for item in filtered_images.json()["items"]] == [str(first["id"])]

    updated = api.client.patch(
        f"/albums/{album['id']}",
        headers=api.auth_headers(owner["access_token"]),
        json={"name": "Edited Trip", "description": "Updated", "cover_image_id": str(second["id"])},
    )
    assert updated.status_code == 200
    assert updated.json()["cover_image_id"] == str(second["id"])

    share_read_only = api.client.post(
        f"/albums/{album['id']}/share",
        headers=api.auth_headers(owner["access_token"]),
        json={"user_id": viewer["user"]["id"], "can_edit": False},
    )
    assert share_read_only.status_code == 200

    shared_albums = api.client.get("/albums", headers=api.auth_headers(viewer["access_token"]))
    assert shared_albums.status_code == 200
    assert [item["id"] for item in shared_albums.json()] == [album["id"]]

    assert api.client.get(f"/albums/{album['id']}", headers=api.auth_headers(viewer["access_token"])).status_code == 200
    assert api.client.delete(
        f"/albums/{album['id']}/images/{first['id']}",
        headers=api.auth_headers(viewer["access_token"]),
    ).status_code == 403

    share_edit = api.client.post(
        f"/albums/{album['id']}/share",
        headers=api.auth_headers(owner["access_token"]),
        json={"user_id": viewer["user"]["id"], "can_edit": True},
    )
    assert share_edit.status_code == 200

    assert api.client.delete(
        f"/albums/{album['id']}/images/{first['id']}",
        headers=api.auth_headers(viewer["access_token"]),
    ).status_code == 204

    download = api.client.get(f"/albums/{album['id']}/download", headers=api.auth_headers(owner["access_token"]))
    assert download.status_code == 200
    with zipfile.ZipFile(io.BytesIO(download.content)) as zf:
        assert zf.namelist() == ["album-green.png"]

    assert api.client.delete(
        f"/albums/{album['id']}/share/{viewer['user']['id']}",
        headers=api.auth_headers(owner["access_token"]),
    ).status_code == 204

    no_longer_shared = api.client.get(f"/albums/{album['id']}", headers=api.auth_headers(viewer["access_token"]))
    assert no_longer_shared.status_code == 404

    assert api.client.delete(f"/albums/{album['id']}", headers=api.auth_headers(owner["access_token"])).status_code == 204


def assert_album_edge_cases(api):
    owner = api.register_and_login("album-owner-2")
    viewer = api.register_and_login("album-viewer-2")
    image = api.upload_image(owner["access_token"], "album-only.png", (0, 0, 255))
    api.wait_for_image_status(str(image["id"]))

    empty_album = api.client.post(
        "/albums",
        headers=api.auth_headers(owner["access_token"]),
        json={"name": 'Trips / "Quotes"'},
    )
    assert empty_album.status_code == 201
    empty_album_id = empty_album.json()["id"]

    empty_download = api.client.get(
        f"/albums/{empty_album_id}/download",
        headers=api.auth_headers(owner["access_token"]),
    )
    assert empty_download.status_code == 404

    share_with_self = api.client.post(
        f"/albums/{empty_album_id}/share",
        headers=api.auth_headers(owner["access_token"]),
        json={"user_id": owner["user"]["id"], "can_edit": True},
    )
    assert share_with_self.status_code == 400

    add_image = api.client.post(
        f"/albums/{empty_album_id}/images",
        headers=api.auth_headers(owner["access_token"]),
        json={"image_ids": [str(image["id"])]},
    )
    assert add_image.status_code == 204

    invalid_cover = api.client.patch(
        f"/albums/{empty_album_id}",
        headers=api.auth_headers(owner["access_token"]),
        json={"cover_image_id": str(uuid.uuid4())},
    )
    assert invalid_cover.status_code == 400

    share_read_only = api.client.post(
        f"/albums/{empty_album_id}/share",
        headers=api.auth_headers(owner["access_token"]),
        json={"user_id": viewer["user"]["id"], "can_edit": False},
    )
    assert share_read_only.status_code == 200

    bulk_add_as_reader = api.client.post(
        "/images/bulk/album",
        headers=api.auth_headers(viewer["access_token"]),
        json={"album_id": empty_album_id, "image_ids": [str(image["id"])]},
    )
    assert bulk_add_as_reader.status_code == 403


def assert_bulk_endpoints(api):
    owner = api.register_and_login("bulk-owner")
    other = api.register_and_login("bulk-other")

    first = api.upload_image(owner["access_token"], "bulk-blue.png", (0, 0, 255))
    second = api.upload_image(owner["access_token"], "bulk-green.png", (0, 255, 0))
    third = api.upload_image(other["access_token"], "bulk-other.png", (255, 0, 0))
    api.wait_for_image_status(str(first["id"]))
    api.wait_for_image_status(str(second["id"]))
    api.wait_for_image_status(str(third["id"]))

    album = api.client.post("/albums", headers=api.auth_headers(owner["access_token"]), json={"name": "Bulk Album"})
    assert album.status_code == 201
    album_id = album.json()["id"]

    assert api.client.post("/images/bulk/favorite", headers=api.auth_headers(owner["access_token"]), json={
        "image_ids": [str(first["id"]), str(second["id"])],
    }).json() == {"processed": 2, "skipped": 0}

    assert api.client.request(
        "DELETE",
        "/images/bulk/favorite",
        headers=api.auth_headers(owner["access_token"]),
        json={"image_ids": [str(first["id"]), str(uuid.uuid4())]},
    ).json() == {"processed": 1, "skipped": 1}

    assert api.client.post("/images/bulk/album", headers=api.auth_headers(owner["access_token"]), json={
        "album_id": album_id,
        "image_ids": [str(first["id"]), str(second["id"])],
    }).json() == {"processed": 2, "skipped": 0}

    assert api.client.request(
        "DELETE",
        "/images/bulk/album",
        headers=api.auth_headers(owner["access_token"]),
        json={"album_id": album_id, "image_ids": [str(first["id"]), str(uuid.uuid4())]},
    ).json() == {"processed": 1, "skipped": 1}

    assert api.client.post("/images/bulk/delete", headers=api.auth_headers(owner["access_token"]), json={
        "image_ids": [str(second["id"]), str(third["id"])],
    }).json() == {"processed": 1, "skipped": 1}

    assert api.client.post("/images/bulk/restore", headers=api.auth_headers(owner["access_token"]), json={
        "image_ids": [str(second["id"]), str(third["id"])],
    }).json() == {"processed": 1, "skipped": 1}

    assert api.client.post("/images/bulk/purge", headers=api.auth_headers(owner["access_token"]), json={
        "image_ids": [str(second["id"]), str(third["id"])],
    }).json() == {"processed": 1, "skipped": 1}

    assert api.fetch_image_row(uuid.UUID(str(second["id"]))) is None
    assert api.fetch_image_row(uuid.UUID(str(third["id"]))) is not None


def assert_admin_endpoints(api):
    target = api.register_and_login("admin-target")
    image = api.upload_image(target["access_token"], "admin-blue.png", (0, 0, 255))
    api.wait_for_image_status(str(image["id"]))

    admin_login = api.client.post("/auth/login", json={"username": "admin", "password": "admin"})
    assert admin_login.status_code == 200
    admin_headers = api.auth_headers(admin_login.json()["access_token"])

    stats = api.client.get("/admin/stats", headers=admin_headers)
    assert stats.status_code == 200
    assert stats.json()["total_users"] >= 2
    assert stats.json()["total_images"] >= 1

    users = api.client.get("/admin/users", headers=admin_headers, params={"page_size": 200})
    assert users.status_code == 200
    assert any(user["username"] == "admin-target" for user in users.json()["items"])

    detail = api.client.get(f"/admin/users/{target['user']['id']}", headers=admin_headers)
    assert detail.status_code == 200
    assert detail.json()["image_count"] == 1
    assert detail.json()["storage_used_bytes"] > 0

    updated = api.client.patch(
        f"/admin/users/{target['user']['id']}",
        headers=admin_headers,
        json={"is_admin": True, "show_nsfw": True},
    )
    assert updated.status_code == 200
    assert updated.json()["is_admin"] is True

    retag = api.client.post(f"/admin/users/{target['user']['id']}/retag-all", headers=admin_headers)
    assert retag.status_code == 202
    assert retag.json()["queued"] == 1
    api.wait_for_image_status(str(image["id"]))

    deleted = api.client.delete(
        f"/admin/users/{target['user']['id']}",
        headers=admin_headers,
        params={"delete_images": "true"},
    )
    assert deleted.status_code == 204
    assert api.fetch_image_row(uuid.UUID(str(image["id"]))) is None


def assert_admin_permissions(api):
    user = api.register_and_login("plain-user")
    forbidden = api.client.get("/admin/stats", headers=api.auth_headers(user["access_token"]))
    assert forbidden.status_code == 403
