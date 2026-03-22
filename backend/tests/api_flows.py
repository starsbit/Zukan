import io
import uuid
import zipfile
from datetime import datetime, timezone

from backend.tests.api_test_support import gif_bytes, jpeg_bytes, mov_bytes, mp4_bytes, png_bytes, webm_bytes


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

    me = api.client.get("/users/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["username"] == "alice"
    assert me.json()["show_nsfw"] is False

    updated = api.client.patch("/users/me", headers=headers, json={
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
    assert refreshed.json()["refresh_token"]

    second_refresh = api.client.post("/auth/refresh", json={"refresh_token": refreshed.json()["refresh_token"]})
    assert second_refresh.status_code == 200
    assert second_refresh.json()["access_token"]
    assert second_refresh.json()["refresh_token"]

    remembered_login = api.client.post("/auth/login", json={
        "username": "alice",
        "password": "newpassword123",
        "remember_me": True,
    })
    assert remembered_login.status_code == 200
    remembered_json = remembered_login.json()
    remembered_refresh = api.client.post("/auth/refresh", json={"refresh_token": remembered_json["refresh_token"]})
    assert remembered_refresh.status_code == 200
    assert remembered_refresh.json()["refresh_token"]

    logged_out = api.client.post("/auth/logout", json={"refresh_token": auth["refresh_token"]})
    assert logged_out.status_code == 204

    refresh_after_logout = api.client.post("/auth/refresh", json={"refresh_token": auth["refresh_token"]})
    assert refresh_after_logout.status_code == 401

    invalid_logout = api.client.post("/auth/logout", json={"refresh_token": "not-a-real-token"})
    assert invalid_logout.status_code == 204


def assert_docs_require_authorization(api):
    user = api.register_and_login("docs-user")
    rc = api.raw_client

    docs = rc.get("/docs")
    assert docs.status_code == 401
    assert docs.headers["www-authenticate"] == "Basic"

    wrong_docs = rc.get("/docs", auth=api.basic_auth("docs-user", "wrongpass123"))
    assert wrong_docs.status_code == 401

    redoc_without_auth = rc.get("/redoc")
    assert redoc_without_auth.status_code == 401
    assert redoc_without_auth.headers["www-authenticate"] == "Basic"

    wrong_redoc = rc.get("/redoc", auth=api.basic_auth("docs-user", "wrongpass123"))
    assert wrong_redoc.status_code == 401

    redirect_without_auth = rc.get("/docs/oauth2-redirect")
    assert redirect_without_auth.status_code == 401
    assert redirect_without_auth.headers["www-authenticate"] == "Basic"

    wrong_redirect = rc.get("/docs/oauth2-redirect", auth=api.basic_auth("docs-user", "wrongpass123"))
    assert wrong_redirect.status_code == 401

    openapi_without_auth = rc.get("/openapi.json")
    assert openapi_without_auth.status_code == 401
    assert openapi_without_auth.headers["www-authenticate"] == "Basic"

    wrong_openapi = rc.get("/openapi.json", auth=api.basic_auth("docs-user", "wrongpass123"))
    assert wrong_openapi.status_code == 401

    openapi = rc.get("/openapi.json", auth=api.basic_auth("docs-user", "password123"))
    assert openapi.status_code == 200
    assert openapi.json()["info"]["title"] == "Zukan"

    swagger = rc.get("/docs", auth=api.basic_auth("docs-user", "password123"))
    assert swagger.status_code == 200
    assert "Swagger UI" in swagger.text

    swagger_authenticated_me = api.client.get("/users/me", headers=api.auth_headers(user["access_token"]))
    assert swagger_authenticated_me.status_code == 200
    assert swagger_authenticated_me.json()["username"] == user["user"]["username"]

    redoc = rc.get("/redoc", auth=api.basic_auth("docs-user", "password123"))
    assert redoc.status_code == 200
    assert "ReDoc" in redoc.text

    redirect = rc.get("/docs/oauth2-redirect", auth=api.basic_auth("docs-user", "password123"))
    assert redirect.status_code == 200
    assert "oauth2" in redirect.text.lower()


def assert_media_tag_search_and_favorite_endpoints(api):
    owner = api.register_and_login("owner")

    blue = api.upload_media(owner["access_token"], "blue-sky.png", (0, 0, 255))
    red = api.upload_media(owner["access_token"], "red-rose.png", (255, 0, 0))

    api.wait_for_media_status(str(blue["id"]))
    api.wait_for_media_status(str(red["id"]))

    nsfw_forbidden = api.client.get(
        "/media",
        headers=api.auth_headers(owner["access_token"]),
        params={"nsfw": "only"},
    )
    assert nsfw_forbidden.status_code == 403

    default_list = api.client.get("/media", headers=api.auth_headers(owner["access_token"]))
    assert default_list.status_code == 200
    assert [item["id"] for item in default_list.json()["items"]] == [str(blue["id"])]

    api.client.patch("/users/me", headers=api.auth_headers(owner["access_token"]), json={"show_nsfw": True})

    nsfw_only = api.client.get("/media", headers=api.auth_headers(owner["access_token"]), params={"nsfw": "only"})
    assert nsfw_only.status_code == 200
    assert [item["id"] for item in nsfw_only.json()["items"]] == [str(red["id"])]

    by_tag = api.client.get("/media", headers=api.auth_headers(owner["access_token"]), params={
        "tag": "sky",
        "status": "done",
    })
    assert by_tag.status_code == 200
    assert by_tag.json()["total"] == 1
    assert by_tag.json()["items"][0]["character_name"] == "ayanami_rei"

    by_metadata_group = api.client.get(
        "/media",
        headers=api.auth_headers(owner["access_token"]),
        params={"captured_month": 3},
    )
    assert by_metadata_group.status_code == 200

    by_character_name = api.client.get(
        "/media",
        headers=api.auth_headers(owner["access_token"]),
        params={"character_name": "rei"},
    )
    assert by_character_name.status_code == 200
    assert by_character_name.json()["total"] == 1

    by_tag_and_character_name = api.client.get(
        "/media",
        headers=api.auth_headers(owner["access_token"]),
        params={"tag": "sky", "character_name": "ayanami"},
    )
    assert by_tag_and_character_name.status_code == 200
    assert by_tag_and_character_name.json()["total"] == 1

    no_tag_and_character_match = api.client.get(
        "/media",
        headers=api.auth_headers(owner["access_token"]),
        params={"tag": "rose", "character_name": "ayanami"},
    )
    assert no_tag_and_character_match.status_code == 200
    assert no_tag_and_character_match.json()["total"] == 0

    by_or_tag = api.client.get("/media", headers=api.auth_headers(owner["access_token"]), params={
        "tag": ["rose", "sky"],
        "mode": "or",
    })
    assert by_or_tag.status_code == 200
    assert by_or_tag.json()["total"] == 2

    excluded = api.client.get("/media", headers=api.auth_headers(owner["access_token"]), params={
        "exclude_tag": "rose",
        "nsfw": "include",
    })
    assert excluded.status_code == 200
    assert [item["id"] for item in excluded.json()["items"]] == [str(blue["id"])]

    detail = api.client.get(f"/media/{blue['id']}", headers=api.auth_headers(owner["access_token"]))
    assert detail.status_code == 200
    assert detail.json()["is_favorited"] is False
    assert detail.json()["character_name"] == "ayanami_rei"
    assert [tag["name"] for tag in detail.json()["tag_details"]] == ["rating:general", "ayanami_rei", "sky", "blue"]

    image_file = api.client.get(f"/media/{blue['id']}/file", headers=api.auth_headers(owner["access_token"]))
    assert image_file.status_code == 200
    assert image_file.headers["content-type"] == "image/png"

    thumbnail = api.client.get(f"/media/{blue['id']}/thumbnail", headers=api.auth_headers(owner["access_token"]))
    assert thumbnail.status_code == 200
    assert thumbnail.headers["content-type"] == "image/webp"

    favorite = api.client.patch(
        f"/media/{blue['id']}",
        headers=api.auth_headers(owner["access_token"]),
        json={"favorited": True},
    )
    assert favorite.status_code == 200

    favorites = api.client.get(
        "/media",
        headers=api.auth_headers(owner["access_token"]),
        params={"favorited": "true"},
    )
    assert favorites.status_code == 200
    assert favorites.json()["items"][0]["id"] == str(blue["id"])

    favorites_by_tag = api.client.get(
        "/media",
        headers=api.auth_headers(owner["access_token"]),
        params={"favorited": "true", "tag": "sky"},
    )
    assert favorites_by_tag.status_code == 200
    assert favorites_by_tag.json()["total"] == 1

    favorited_filter = api.client.get("/media", headers=api.auth_headers(owner["access_token"]), params={"favorited": "true"})
    assert favorited_filter.status_code == 200
    assert favorited_filter.json()["total"] == 1

    unfavorite = api.client.patch(
        f"/media/{blue['id']}",
        headers=api.auth_headers(owner["access_token"]),
        json={"favorited": False},
    )
    assert unfavorite.status_code == 200

    missing_favorite = api.client.patch(
        f"/media/{blue['id']}",
        headers=api.auth_headers(owner["access_token"]),
        json={"favorited": False},
    )
    assert missing_favorite.status_code == 200

    tags = api.client.get("/tags", headers=api.auth_headers(owner["access_token"]))
    assert tags.status_code == 200
    assert {tag["name"] for tag in tags.json()["items"]} >= {"sky", "rose"}

    rating_tags = api.client.get("/tags", headers=api.auth_headers(owner["access_token"]), params={"category": 9})
    assert rating_tags.status_code == 200
    assert {tag["name"] for tag in rating_tags.json()["items"]} == {"rating:general", "rating:questionable"}

    tag_search = api.client.get("/tags", headers=api.auth_headers(owner["access_token"]), params={"q": "sk"})
    assert tag_search.status_code == 200
    assert [tag["name"] for tag in tag_search.json()["items"]] == ["sky"]

    manual_edit = api.client.patch(
        f"/media/{blue['id']}",
        headers=api.auth_headers(owner["access_token"]),
        json={"tags": ["pilot", "rating:general"], "character_name": "ikari_shinji"},
    )
    assert manual_edit.status_code == 200
    assert manual_edit.json()["character_name"] == "ikari_shinji"
    assert manual_edit.json()["tags"] == ["pilot", "rating:general"]

    corrected = api.client.get(
        "/media",
        headers=api.auth_headers(owner["access_token"]),
        params={"tag": "pilot", "character_name": "shinji"},
    )
    assert corrected.status_code == 200
    assert corrected.json()["total"] == 1

    old_search = api.client.get(
        "/media",
        headers=api.auth_headers(owner["access_token"]),
        params={"tag": "sky"},
    )
    assert old_search.status_code == 200
    assert old_search.json()["total"] == 0

    corrected_detail = api.client.get(f"/media/{blue['id']}", headers=api.auth_headers(owner["access_token"]))
    assert corrected_detail.status_code == 200
    assert corrected_detail.json()["character_name"] == "ikari_shinji"
    assert {tag["name"] for tag in corrected_detail.json()["tag_details"]} == {"pilot", "rating:general"}

    retag = api.client.post(f"/media/{blue['id']}/tagging-jobs", headers=api.auth_headers(owner["access_token"]))
    assert retag.status_code == 202
    api.wait_for_media_status(str(blue["id"]))


def assert_custom_tag_save_and_search_regression(api):
    user = api.register_and_login("custom-tag-regression")
    headers = api.auth_headers(user["access_token"])

    media = api.upload_media(user["access_token"], "custom-tag-regression.png", (0, 100, 200))
    api.wait_for_media_status(str(media["id"]))

    saved = api.client.patch(
        f"/media/{media['id']}",
        headers=headers,
        json={"tags": ["my_custom_label", "another_label"]},
    )
    assert saved.status_code == 200
    assert set(saved.json()["tags"]) == {"my_custom_label", "another_label"}

    single_tag = api.client.get("/media", headers=headers, params={"tag": "my_custom_label"})
    assert single_tag.status_code == 200
    assert single_tag.json()["total"] == 1
    assert single_tag.json()["items"][0]["id"] == str(media["id"])

    multi_tag = api.client.get("/media", headers=headers, params={"tag": ["my_custom_label", "another_label"]})
    assert multi_tag.status_code == 200
    assert multi_tag.json()["total"] == 1

    and_miss = api.client.get("/media", headers=headers, params={"tag": ["my_custom_label", "not_present"]})
    assert and_miss.status_code == 200
    assert and_miss.json()["total"] == 0

    or_hit = api.client.get("/media", headers=headers, params={"tag": ["my_custom_label", "not_present"], "mode": "or"})
    assert or_hit.status_code == 200
    assert or_hit.json()["total"] == 1

    exclude_miss = api.client.get("/media", headers=headers, params={"exclude_tag": "my_custom_label"})
    assert exclude_miss.status_code == 200
    assert exclude_miss.json()["total"] == 0

    stale = api.client.get("/media", headers=headers, params={"tag": "sky"})
    assert stale.status_code == 200
    assert stale.json()["total"] == 0


def assert_media_lifecycle_download_and_on_this_day_endpoints(api):
    user = api.register_and_login("collector")
    headers = api.auth_headers(user["access_token"])

    captured_at = datetime(2021, 3, 21, 7, 45, tzinfo=timezone.utc)
    first = api.upload_media_bytes(user["access_token"], "first.jpg", jpeg_bytes((0, 0, 255), captured_at), "image/jpeg")
    second = api.upload_media(user["access_token"], "second.png", (0, 255, 0))
    api.wait_for_media_status(str(first["id"]))
    api.wait_for_media_status(str(second["id"]))

    download = api.client.post("/media/download", headers=headers, json={"media_ids": [str(first["id"]), str(second["id"])]})
    assert download.status_code == 200
    with zipfile.ZipFile(io.BytesIO(download.content)) as zf:
        assert set(zf.namelist()) == {"first.jpg", "second.png"}

    first_detail = api.client.get(f"/media/{first['id']}", headers=headers)
    assert first_detail.status_code == 200
    assert first_detail.json()["metadata"]["captured_at"].startswith("2021-03-21T07:45:00")

    assert api.client.patch(f"/media/{first['id']}", headers=headers, json={"deleted": True}).status_code == 200
    trash = api.client.get("/media", headers=headers, params={"state": "trashed"})
    assert trash.status_code == 200
    assert trash.json()["items"][0]["id"] == str(first["id"])

    assert api.client.patch(f"/media/{first['id']}", headers=headers, json={"deleted": False}).status_code == 200

    api.set_media_captured_at(str(first["id"]), captured_at.replace(year=captured_at.year - 1))
    on_this_day = api.client.get(
        "/media",
        headers=headers,
        params={"captured_month": 3, "captured_day": 21, "captured_before_year": datetime.now(timezone.utc).year},
    )
    assert on_this_day.status_code == 200
    assert [item["id"] for item in on_this_day.json()["items"]] == [str(first["id"])]

    assert api.client.patch(f"/media/{second['id']}", headers=headers, json={"deleted": True}).status_code == 200
    restored_upload = api.client.post(
        "/media",
        headers=headers,
        files=[("files", ("second.png", png_bytes((0, 255, 0)), "image/png"))],
    )
    restored_json = restored_upload.json()
    assert restored_upload.status_code == 202
    assert restored_json["results"][0]["id"] == str(second["id"])
    api.wait_for_media_status(str(second["id"]))

    assert api.client.patch(f"/media/{first['id']}", headers=headers, json={"deleted": True}).status_code == 200
    assert api.client.post("/media/actions/empty-trash", headers=headers).status_code == 204
    assert api.fetch_media_row(uuid.UUID(str(first["id"]))) is None

    assert api.client.delete(f"/media/{second['id']}", headers=headers).status_code == 204
    second_in_trash = api.client.get("/media", headers=headers, params={"state": "trashed"})
    assert second_in_trash.status_code == 200
    assert [item["id"] for item in second_in_trash.json()["items"]] == [str(second["id"])]

    assert api.client.post("/media/actions/empty-trash", headers=headers).status_code == 204
    assert api.fetch_media_row(uuid.UUID(str(second["id"]))) is None


def assert_media_upload_edge_cases(api):
    user = api.register_and_login("upload-user")
    headers = api.auth_headers(user["access_token"])

    accepted = api.client.post(
        "/media",
        headers=headers,
        files=[("files", ("duplicate.png", png_bytes((0, 0, 255)), "image/png"))],
    )
    assert accepted.status_code == 202
    accepted_result = accepted.json()["results"][0]
    api.wait_for_media_status(str(accepted_result["id"]))

    duplicate = api.client.post(
        "/media",
        headers=headers,
        files=[("files", ("duplicate-copy.png", png_bytes((0, 0, 255)), "image/png"))],
    )
    assert duplicate.status_code == 202
    duplicate_result = duplicate.json()
    assert duplicate_result["accepted"] == 0
    assert duplicate_result["duplicates"] == 1
    assert duplicate_result["results"][0]["status"] == "duplicate"

    invalid = api.client.post(
        "/media",
        headers=headers,
        files=[("files", ("notes.txt", b"not an image", "text/plain"))],
    )
    assert invalid.status_code == 202
    invalid_result = invalid.json()
    assert invalid_result["accepted"] == 0
    assert invalid_result["errors"] == 1
    assert invalid_result["results"][0]["status"] == "error"

    download_missing = api.client.post(
        "/media/download",
        headers=headers,
        json={"media_ids": [str(uuid.uuid4())]},
    )
    assert download_missing.status_code == 404

    partial_metadata_filter = api.client.get("/media", headers=headers, params={"captured_month": 3})
    assert partial_metadata_filter.status_code == 200

    invalid_on_this_day = api.client.get("/media", headers=headers, params={"captured_month": 2, "captured_day": 30})
    assert invalid_on_this_day.status_code == 422


def assert_mixed_media_endpoints(api):
    user = api.register_and_login("mixed-media")
    headers = api.auth_headers(user["access_token"])

    animated = api.upload_media_bytes(
        user["access_token"],
        "animated.gif",
        gif_bytes([(0, 0, 255), (255, 0, 0), (0, 255, 0)]),
        "image/gif",
    )
    movie = api.upload_media_bytes(
        user["access_token"],
        "sample.mp4",
        mp4_bytes([(0, 0, 255), (255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 0, 0)]),
        "video/mp4",
    )
    webm = api.upload_media_bytes(
        user["access_token"],
        "sample.webm",
        webm_bytes([(0, 255, 0), (0, 0, 255), (0, 255, 0), (0, 0, 255), (0, 255, 0)]),
        "video/webm",
    )
    mov = api.upload_media_bytes(
        user["access_token"],
        "sample.mov",
        mov_bytes([(255, 0, 0), (0, 0, 255), (255, 0, 0), (0, 0, 255), (255, 0, 0)]),
        "video/quicktime",
    )

    for item in (animated, movie, webm, mov):
        api.wait_for_media_status(str(item["id"]))

    enabled = api.client.patch("/users/me", headers=headers, json={"show_nsfw": True})
    assert enabled.status_code == 200

    animated_detail = api.client.get(f"/media/{animated['id']}", headers=headers)
    movie_detail = api.client.get(f"/media/{movie['id']}", headers=headers)
    webm_detail = api.client.get(f"/media/{webm['id']}", headers=headers)
    mov_detail = api.client.get(f"/media/{mov['id']}", headers=headers)

    assert animated_detail.status_code == 200
    assert movie_detail.status_code == 200
    assert webm_detail.status_code == 200
    assert mov_detail.status_code == 200

    assert animated_detail.json()["media_type"] == "gif"
    assert movie_detail.json()["media_type"] == "video"
    assert webm_detail.json()["media_type"] == "video"
    assert mov_detail.json()["media_type"] == "video"

    assert {"sky", "rose", "forest"} <= set(animated_detail.json()["tags"])
    assert movie_detail.json()["is_nsfw"] is True
    assert movie_detail.json()["metadata"]["duration_seconds"] is not None
    assert webm_detail.json()["metadata"]["duration_seconds"] is not None
    assert mov_detail.json()["metadata"]["duration_seconds"] is not None

    assert api.client.get(f"/media/{animated['id']}/thumbnail", headers=headers).status_code == 200
    assert api.client.get(f"/media/{movie['id']}/thumbnail", headers=headers).status_code == 200

    listing = api.client.get("/media", headers=headers, params={"nsfw": "include"})
    assert listing.status_code == 200
    assert {item["id"] for item in listing.json()["items"]} >= {
        str(animated["id"]),
        str(movie["id"]),
        str(webm["id"]),
        str(mov["id"]),
    }

    download = api.client.post(
        "/media/download",
        headers=headers,
        json={"media_ids": [str(animated["id"]), str(movie["id"]), str(webm["id"]), str(mov["id"])]},
    )
    assert download.status_code == 200
    with zipfile.ZipFile(io.BytesIO(download.content)) as zf:
        assert set(zf.namelist()) == {"animated.gif", "sample.mp4", "sample.webm", "sample.mov"}


def assert_media_complex_query_regression(api):
    user = api.register_and_login("query-torture")
    headers = api.auth_headers(user["access_token"])

    blue = api.upload_media(user["access_token"], "query-blue.png", (0, 0, 255))
    green = api.upload_media(user["access_token"], "query-green.png", (0, 255, 0))
    red = api.upload_media(user["access_token"], "query-red.png", (255, 0, 0))
    blue_two = api.upload_media(user["access_token"], "query-blue-two.png", (0, 0, 254))

    api.wait_for_media_status(str(blue["id"]))
    api.wait_for_media_status(str(green["id"]))
    api.wait_for_media_status(str(red["id"]))
    api.wait_for_media_status(str(blue_two["id"]))

    api.set_media_captured_at(str(blue["id"]), datetime(2022, 3, 21, 9, 0, tzinfo=timezone.utc))
    api.set_media_captured_at(str(green["id"]), datetime(2021, 3, 14, 8, 30, tzinfo=timezone.utc))
    api.set_media_captured_at(str(red["id"]), datetime(2020, 3, 21, 23, 45, tzinfo=timezone.utc))
    api.set_media_captured_at(str(blue_two["id"]), datetime(2019, 7, 4, 12, 15, tzinfo=timezone.utc))

    blue_update = api.client.patch(
        f"/media/{blue['id']}",
        headers=headers,
        json={
            "tags": ["pilot", "eva", "tokyo3", "rating:general"],
            "character_name": "ikari_shinji",
        },
    )
    assert blue_update.status_code == 200

    green_update = api.client.patch(
        f"/media/{green['id']}",
        headers=headers,
        json={
            "tags": ["forest", "mecha", "support", "rating:general"],
            "character_name": "soryu_asuka_langley",
        },
    )
    assert green_update.status_code == 200

    blue_two_update = api.client.patch(
        f"/media/{blue_two['id']}",
        headers=headers,
        json={
            "tags": ["pilot", "eva", "moon", "rating:general"],
            "character_name": "nagisa_kaworu",
        },
    )
    assert blue_two_update.status_code == 200

    favorite = api.client.patch(
        f"/media/{blue_two['id']}",
        headers=headers,
        json={"favorited": True},
    )
    assert favorite.status_code == 200

    trashed = api.client.patch(
        f"/media/{green['id']}",
        headers=headers,
        json={"deleted": True},
    )
    assert trashed.status_code == 200

    default_list = api.client.get("/media", headers=headers)
    assert default_list.status_code == 200
    assert {item["id"] for item in default_list.json()["items"]} == {str(blue["id"]), str(blue_two["id"])}

    trash_list = api.client.get("/media", headers=headers, params={"state": "trashed"})
    assert trash_list.status_code == 200
    assert [item["id"] for item in trash_list.json()["items"]] == [str(green["id"])]

    year_filter = api.client.get("/media", headers=headers, params={"captured_year": 2022})
    assert year_filter.status_code == 200
    assert [item["id"] for item in year_filter.json()["items"]] == [str(blue["id"])]

    month_filter = api.client.get("/media", headers=headers, params={"captured_month": 3})
    assert month_filter.status_code == 200
    assert {item["id"] for item in month_filter.json()["items"]} == {str(blue["id"])}

    day_filter = api.client.get("/media", headers=headers, params={"captured_day": 4})
    assert day_filter.status_code == 200
    assert [item["id"] for item in day_filter.json()["items"]] == [str(blue_two["id"])]

    combined_and_filter = api.client.get(
        "/media",
        headers=headers,
        params={"tag": ["pilot", "eva"], "mode": "and", "captured_before_year": 2021},
    )
    assert combined_and_filter.status_code == 200
    assert [item["id"] for item in combined_and_filter.json()["items"]] == [str(blue_two["id"])]

    combined_or_excluding_filter = api.client.get(
        "/media",
        headers=headers,
        params={"tag": ["pilot", "forest"], "mode": "or", "exclude_tag": "moon", "nsfw": "include"},
    )
    assert combined_or_excluding_filter.status_code == 200
    assert [item["id"] for item in combined_or_excluding_filter.json()["items"]] == [str(blue["id"])]

    character_with_year = api.client.get(
        "/media",
        headers=headers,
        params={"character_name": "shinji", "captured_year": 2022},
    )
    assert character_with_year.status_code == 200
    assert [item["id"] for item in character_with_year.json()["items"]] == [str(blue["id"])]

    favorited_metadata_filter = api.client.get(
        "/media",
        headers=headers,
        params={"favorited": "true", "captured_month": 7, "tag": "pilot"},
    )
    assert favorited_metadata_filter.status_code == 200
    assert [item["id"] for item in favorited_metadata_filter.json()["items"]] == [str(blue_two["id"])]

    hidden_nsfw = api.client.get("/media", headers=headers, params={"nsfw": "include"})
    assert hidden_nsfw.status_code == 200
    assert {item["id"] for item in hidden_nsfw.json()["items"]} == {str(blue["id"]), str(blue_two["id"]), str(red["id"])}

    show_nsfw = api.client.patch("/users/me", headers=headers, json={"show_nsfw": True})
    assert show_nsfw.status_code == 200

    nsfw_metadata_filter = api.client.get(
        "/media",
        headers=headers,
        params={"nsfw": "only", "captured_month": 3, "captured_day": 21},
    )
    assert nsfw_metadata_filter.status_code == 200
    assert [item["id"] for item in nsfw_metadata_filter.json()["items"]] == [str(red["id"])]

    on_this_day = api.client.get(
        "/media",
        headers=headers,
        params={"captured_month": 3, "captured_day": 21, "captured_before_year": 2023},
    )
    assert on_this_day.status_code == 200
    assert [item["id"] for item in on_this_day.json()["items"]] == [str(blue["id"]), str(red["id"])]

    impossible_combo = api.client.get(
        "/media",
        headers=headers,
        params={"tag": "pilot", "captured_year": 2021, "character_name": "shinji"},
    )
    assert impossible_combo.status_code == 200
    assert impossible_combo.json()["items"] == []

    album = api.client.post("/albums", headers=headers, json={"name": "Regression Album"})
    assert album.status_code == 201
    album_id = album.json()["id"]

    add_to_album = api.client.put(
        f"/albums/{album_id}/media",
        headers=headers,
        json={"media_ids": [str(blue["id"]), str(blue_two["id"])]},
    )
    assert add_to_album.status_code == 200
    assert add_to_album.json() == {"processed": 2, "skipped": 0}

    album_filtered = api.client.get(
        "/media",
        headers=headers,
        params={"album_id": album_id, "tag": "pilot", "status": "done"},
    )
    assert album_filtered.status_code == 200
    assert {item["id"] for item in album_filtered.json()["items"]} == {str(blue["id"]), str(blue_two["id"])}


def assert_tag_management_endpoints(api):
    owner = api.register_and_login("tag-manager-owner")
    other = api.register_and_login("tag-manager-other")
    admin_login = api.client.post("/auth/login", json={"username": "admin", "password": "admin"})
    assert admin_login.status_code == 200

    owner_headers = api.auth_headers(owner["access_token"])
    other_headers = api.auth_headers(other["access_token"])
    admin_headers = api.auth_headers(admin_login.json()["access_token"])

    owner_blue = api.upload_media(owner["access_token"], "tag-owner-blue.png", (0, 0, 255))
    owner_green = api.upload_media(owner["access_token"], "tag-owner-green.png", (0, 255, 0))
    other_blue = api.upload_media(other["access_token"], "tag-other-blue.png", (0, 0, 254))
    for item in (owner_blue, owner_green, other_blue):
        api.wait_for_media_status(str(item["id"]))

    trash_blue = api.client.post(f"/character-names/ayanami_rei/actions/trash-media", headers=owner_headers)
    assert trash_blue.status_code == 200
    assert trash_blue.json() == {
        "matched_media": 1,
        "updated_media": 0,
        "trashed_media": 1,
        "already_trashed": 0,
        "deleted_tag": False,
    }

    repeat_trash_blue = api.client.post(f"/character-names/ayanami_rei/actions/trash-media", headers=owner_headers)
    assert repeat_trash_blue.status_code == 200
    assert repeat_trash_blue.json()["already_trashed"] == 1

    owner_trash = api.client.get("/media", headers=owner_headers, params={"state": "trashed", "nsfw": "include"})
    assert owner_trash.status_code == 200
    assert [item["id"] for item in owner_trash.json()["items"]] == [str(owner_blue["id"])]

    other_active_blue = api.client.get("/media", headers=other_headers, params={"tag": "sky"})
    assert other_active_blue.status_code == 200
    assert [item["id"] for item in other_active_blue.json()["items"]] == [str(other_blue["id"])]

    delete_owner_character = api.client.post("/character-names/ayanami_rei/actions/remove-from-media", headers=owner_headers)
    assert delete_owner_character.status_code == 200
    assert delete_owner_character.json()["matched_media"] == 1
    assert delete_owner_character.json()["updated_media"] == 1

    owner_character_search = api.client.get(
        "/media",
        headers=owner_headers,
        params={"character_name": "ayanami", "nsfw": "include", "state": "trashed"},
    )
    assert owner_character_search.status_code == 200
    assert owner_character_search.json()["items"] == []

    other_character_search = api.client.get("/media", headers=other_headers, params={"character_name": "ayanami"})
    assert other_character_search.status_code == 200
    assert [item["id"] for item in other_character_search.json()["items"]] == [str(other_blue["id"])]

    owner_character_suggestions = api.client.get("/media/character-suggestions", headers=owner_headers, params={"q": "aya"})
    assert owner_character_suggestions.status_code == 200
    assert owner_character_suggestions.json()[0]["name"] == "ayanami_rei"

    other_character_suggestions = api.client.get("/media/character-suggestions", headers=other_headers, params={"q": "aya"})
    assert other_character_suggestions.status_code == 200
    assert other_character_suggestions.json()[0]["name"] == "ayanami_rei"

    trash_forest = api.client.post("/tags/forest/actions/trash-media", headers=owner_headers)
    assert trash_forest.status_code == 200
    assert trash_forest.json()["matched_media"] == 1
    assert trash_forest.json()["trashed_media"] == 1

    delete_forest = api.client.post("/tags/forest/actions/remove-from-media", headers=owner_headers)
    assert delete_forest.status_code == 200
    assert delete_forest.json()["matched_media"] == 1
    assert delete_forest.json()["updated_media"] == 1
    assert delete_forest.json()["deleted_tag"] is True

    owner_forest_search = api.client.get(
        "/media",
        headers=owner_headers,
        params={"tag": "forest", "state": "trashed", "nsfw": "include"},
    )
    assert owner_forest_search.status_code == 200
    assert owner_forest_search.json()["items"] == []

    tags_after_owner_delete = api.client.get("/tags", headers=owner_headers, params={"q": "fo"})
    assert tags_after_owner_delete.status_code == 200
    assert tags_after_owner_delete.json()["items"] == []

    admin_delete_sky = api.client.post("/tags/sky/actions/remove-from-media", headers=admin_headers)
    assert admin_delete_sky.status_code == 200
    assert admin_delete_sky.json()["matched_media"] == 2
    assert admin_delete_sky.json()["updated_media"] == 2
    assert admin_delete_sky.json()["deleted_tag"] is True

    sky_tags = api.client.get("/tags", headers=admin_headers, params={"q": "sk"})
    assert sky_tags.status_code == 200
    assert sky_tags.json()["items"] == []

    owner_sky_search = api.client.get("/media", headers=owner_headers, params={"tag": "sky", "nsfw": "include", "state": "trashed"})
    assert owner_sky_search.status_code == 200
    assert owner_sky_search.json()["items"] == []

    other_sky_search = api.client.get("/media", headers=other_headers, params={"tag": "sky"})
    assert other_sky_search.status_code == 200
    assert other_sky_search.json()["items"] == []


def assert_album_endpoints(api):
    owner = api.register_and_login("album-owner")
    viewer = api.register_and_login("album-viewer")
    outsider = api.register_and_login("album-outsider")

    first = api.upload_media(owner["access_token"], "album-blue.png", (0, 0, 255))
    second = api.upload_media(owner["access_token"], "album-green.png", (0, 255, 0))
    api.wait_for_media_status(str(first["id"]))
    api.wait_for_media_status(str(second["id"]))

    created = api.client.post("/albums", headers=api.auth_headers(owner["access_token"]), json={
        "name": "Road Trip",
        "description": "Spring photos",
    })
    assert created.status_code == 201
    album = created.json()

    assert api.client.put(
        f"/albums/{album['id']}/media",
        headers=api.auth_headers(owner["access_token"]),
        json={"media_ids": [str(first["id"]), str(second["id"])]},
    ).status_code == 200

    listed = api.client.get("/albums", headers=api.auth_headers(owner["access_token"]))
    assert listed.status_code == 200
    assert listed.json()[0]["media_count"] == 2

    fetched = api.client.get(f"/albums/{album['id']}", headers=api.auth_headers(owner["access_token"]))
    assert fetched.status_code == 200
    assert fetched.json()["cover_media_id"] == str(first["id"])

    filtered_media = api.client.get(
        f"/albums/{album['id']}/media",
        headers=api.auth_headers(owner["access_token"]),
        params={"tag": "sky"},
    )
    assert filtered_media.status_code == 200
    assert [item["id"] for item in filtered_media.json()["items"]] == [str(first["id"])]

    album_query = api.client.get(
        "/media",
        headers=api.auth_headers(owner["access_token"]),
        params={"album_id": album["id"]},
    )
    assert album_query.status_code == 200
    assert {item["id"] for item in album_query.json()["items"]} == {str(first["id"]), str(second["id"])}

    updated = api.client.patch(
        f"/albums/{album['id']}",
        headers=api.auth_headers(owner["access_token"]),
        json={"name": "Edited Trip", "description": "Updated", "cover_media_id": str(second["id"])},
    )
    assert updated.status_code == 200
    assert updated.json()["cover_media_id"] == str(second["id"])

    share_read_only = api.client.post(
        f"/albums/{album['id']}/shares",
        headers=api.auth_headers(owner["access_token"]),
        json={"user_id": viewer["user"]["id"], "can_edit": False},
    )
    assert share_read_only.status_code == 200

    shared_albums = api.client.get("/albums", headers=api.auth_headers(viewer["access_token"]))
    assert shared_albums.status_code == 200
    assert [item["id"] for item in shared_albums.json()] == [album["id"]]

    assert api.client.get(f"/albums/{album['id']}", headers=api.auth_headers(viewer["access_token"])).status_code == 200
    shared_album_query = api.client.get(
        "/media",
        headers=api.auth_headers(viewer["access_token"]),
        params={"album_id": album["id"]},
    )
    assert shared_album_query.status_code == 200
    assert {item["id"] for item in shared_album_query.json()["items"]} == {str(first["id"]), str(second["id"])}
    assert api.client.request(
        "DELETE",
        f"/albums/{album['id']}/media",
        headers=api.auth_headers(viewer["access_token"]),
        json={"media_ids": [str(first["id"])]},
    ).status_code == 403

    share_edit = api.client.post(
        f"/albums/{album['id']}/shares",
        headers=api.auth_headers(owner["access_token"]),
        json={"user_id": viewer["user"]["id"], "can_edit": True},
    )
    assert share_edit.status_code == 200

    assert api.client.request(
        "DELETE",
        f"/albums/{album['id']}/media",
        headers=api.auth_headers(viewer["access_token"]),
        json={"media_ids": [str(first["id"])]},
    ).status_code == 200

    download = api.client.get(f"/albums/{album['id']}/download", headers=api.auth_headers(owner["access_token"]))
    assert download.status_code == 200
    with zipfile.ZipFile(io.BytesIO(download.content)) as zf:
        assert zf.namelist() == ["album-green.png"]

    assert api.client.delete(
        f"/albums/{album['id']}/shares/{viewer['user']['id']}",
        headers=api.auth_headers(owner["access_token"]),
    ).status_code == 204

    no_longer_shared = api.client.get(f"/albums/{album['id']}", headers=api.auth_headers(viewer["access_token"]))
    assert no_longer_shared.status_code == 404

    inaccessible_album_query = api.client.get(
        "/media",
        headers=api.auth_headers(outsider["access_token"]),
        params={"album_id": album["id"]},
    )
    assert inaccessible_album_query.status_code == 404

    assert api.client.delete(f"/albums/{album['id']}", headers=api.auth_headers(owner["access_token"])).status_code == 204


def assert_album_edge_cases(api):
    owner = api.register_and_login("album-owner-2")
    viewer = api.register_and_login("album-viewer-2")
    outsider = api.register_and_login("album-outsider-2")
    image = api.upload_media(owner["access_token"], "album-only.png", (0, 0, 255))
    api.wait_for_media_status(str(image["id"]))

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
        f"/albums/{empty_album_id}/shares",
        headers=api.auth_headers(owner["access_token"]),
        json={"user_id": owner["user"]["id"], "can_edit": True},
    )
    assert share_with_self.status_code == 400

    add_image = api.client.put(
        f"/albums/{empty_album_id}/media",
        headers=api.auth_headers(owner["access_token"]),
        json={"media_ids": [str(image["id"])]},
    )
    assert add_image.status_code == 200

    duplicate_add = api.client.put(
        f"/albums/{empty_album_id}/media",
        headers=api.auth_headers(owner["access_token"]),
        json={"media_ids": [str(image["id"])]},
    )
    assert duplicate_add.status_code == 200
    assert duplicate_add.json() == {"processed": 0, "skipped": 1}

    invalid_cover = api.client.patch(
        f"/albums/{empty_album_id}",
        headers=api.auth_headers(owner["access_token"]),
        json={"cover_media_id": str(uuid.uuid4())},
    )
    assert invalid_cover.status_code == 400

    share_read_only = api.client.post(
        f"/albums/{empty_album_id}/shares",
        headers=api.auth_headers(owner["access_token"]),
        json={"user_id": viewer["user"]["id"], "can_edit": False},
    )
    assert share_read_only.status_code == 200

    bulk_add_as_reader = api.client.put(
        f"/albums/{empty_album_id}/media",
        headers=api.auth_headers(viewer["access_token"]),
        json={"media_ids": [str(image["id"])]},
    )
    assert bulk_add_as_reader.status_code == 403

    invisible_album_query = api.client.get(
        "/media",
        headers=api.auth_headers(outsider["access_token"]),
        params={"album_id": empty_album_id},
    )
    assert invisible_album_query.status_code == 404


def assert_bulk_endpoints(api):
    owner = api.register_and_login("bulk-owner")
    other = api.register_and_login("bulk-other")

    first = api.upload_media(owner["access_token"], "bulk-blue.png", (0, 0, 255))
    second = api.upload_media(owner["access_token"], "bulk-green.png", (0, 255, 0))
    third = api.upload_media(other["access_token"], "bulk-other.png", (255, 0, 0))
    api.wait_for_media_status(str(first["id"]))
    api.wait_for_media_status(str(second["id"]))
    api.wait_for_media_status(str(third["id"]))

    album = api.client.post("/albums", headers=api.auth_headers(owner["access_token"]), json={"name": "Bulk Album"})
    assert album.status_code == 201
    album_id = album.json()["id"]

    assert api.client.patch("/media", headers=api.auth_headers(owner["access_token"]), json={
        "media_ids": [str(first["id"]), str(second["id"])],
        "favorited": True,
    }).json() == {"processed": 2, "skipped": 0}

    assert api.client.patch("/media", headers=api.auth_headers(owner["access_token"]), json={
        "media_ids": [str(first["id"]), str(uuid.uuid4())],
        "favorited": False,
    }).json() == {"processed": 1, "skipped": 1}

    assert api.client.put(f"/albums/{album_id}/media", headers=api.auth_headers(owner["access_token"]), json={
        "media_ids": [str(first["id"]), str(second["id"])],
    }).json() == {"processed": 2, "skipped": 0}

    assert api.client.request(
        "DELETE",
        f"/albums/{album_id}/media",
        headers=api.auth_headers(owner["access_token"]),
        json={"media_ids": [str(first["id"]), str(uuid.uuid4())]},
    ).json() == {"processed": 1, "skipped": 1}

    assert api.client.patch("/media", headers=api.auth_headers(owner["access_token"]), json={
        "media_ids": [str(second["id"]), str(third["id"])],
        "deleted": True,
    }).json() == {"processed": 1, "skipped": 1}

    assert api.client.patch("/media", headers=api.auth_headers(owner["access_token"]), json={
        "media_ids": [str(second["id"]), str(third["id"])],
        "deleted": False,
    }).json() == {"processed": 1, "skipped": 1}

    assert api.client.request("DELETE", "/media", headers=api.auth_headers(owner["access_token"]), json={
        "media_ids": [str(second["id"]), str(third["id"])],
    }).json() == {"processed": 1, "skipped": 1}

    trashed = api.client.get("/media", headers=api.auth_headers(owner["access_token"]), params={"state": "trashed"})
    assert trashed.status_code == 200
    assert [item["id"] for item in trashed.json()["items"]] == [str(second["id"])]

    assert api.client.post("/media/actions/empty-trash", headers=api.auth_headers(owner["access_token"])).status_code == 204
    assert api.fetch_media_row(uuid.UUID(str(second["id"]))) is None
    assert api.fetch_media_row(uuid.UUID(str(third["id"]))) is not None


def assert_admin_endpoints(api):
    target = api.register_and_login("admin-target")
    image = api.upload_media(target["access_token"], "admin-blue.png", (0, 0, 255))
    api.wait_for_media_status(str(image["id"]))

    admin_login = api.client.post("/auth/login", json={"username": "admin", "password": "admin"})
    assert admin_login.status_code == 200
    admin_headers = api.auth_headers(admin_login.json()["access_token"])

    stats = api.client.get("/admin/stats", headers=admin_headers)
    assert stats.status_code == 200
    assert stats.json()["total_users"] >= 2
    assert stats.json()["total_media"] >= 1

    users = api.client.get("/admin/users", headers=admin_headers, params={"page_size": 200})
    assert users.status_code == 200
    assert any(user["username"] == "admin-target" for user in users.json()["items"])

    detail = api.client.get(f"/admin/users/{target['user']['id']}", headers=admin_headers)
    assert detail.status_code == 200
    assert detail.json()["media_count"] == 1
    assert detail.json()["storage_used_bytes"] > 0

    updated = api.client.patch(
        f"/admin/users/{target['user']['id']}",
        headers=admin_headers,
        json={"is_admin": True, "show_nsfw": True},
    )
    assert updated.status_code == 200
    assert updated.json()["is_admin"] is True

    retag = api.client.post(f"/admin/users/{target['user']['id']}/tagging-jobs", headers=admin_headers)
    assert retag.status_code == 202
    assert retag.json()["queued"] == 1
    api.wait_for_media_status(str(image["id"]))

    deleted = api.client.delete(
        f"/admin/users/{target['user']['id']}",
        headers=admin_headers,
        params={"delete_media": "true"},
    )
    assert deleted.status_code == 204
    assert api.fetch_media_row(uuid.UUID(str(image["id"]))) is None


def assert_admin_permissions(api):
    user = api.register_and_login("plain-user")
    target = api.register_and_login("plain-target")

    user_headers = api.auth_headers(user["access_token"])
    target_id = target["user"]["id"]

    assert api.client.get("/admin/stats", headers=user_headers).status_code == 403
    assert api.client.get("/admin/users", headers=user_headers).status_code == 403
    assert api.client.get(f"/admin/users/{target_id}", headers=user_headers).status_code == 403
    assert api.client.patch(
        f"/admin/users/{target_id}",
        headers=user_headers,
        json={"show_nsfw": True},
    ).status_code == 403
    assert api.client.post(f"/admin/users/{target_id}/tagging-jobs", headers=user_headers).status_code == 403
    assert api.client.delete(
        f"/admin/users/{target_id}",
        headers=user_headers,
        params={"delete_media": "true"},
    ).status_code == 403

    assert api.client.get("/admin/stats").status_code == 401
    assert api.client.get("/admin/users").status_code == 401
