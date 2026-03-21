def _login(api, username: str, password: str = "password123") -> dict:
    response = api.client.post("/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.text
    return response.json()


def _logout(api, refresh_token: str):
    response = api.client.post("/auth/logout", json={"refresh_token": refresh_token})
    assert response.status_code == 204, response.text


def test_user_journey_upload_auto_tag_and_discover_images(api):
    registered = api.register_and_login("journey-discovery")
    _logout(api, registered["refresh_token"])

    logged_in = _login(api, "journey-discovery")
    headers = api.auth_headers(logged_in["access_token"])

    blue = api.upload_image(logged_in["access_token"], "journey-blue.png", (0, 0, 255))
    green = api.upload_image(logged_in["access_token"], "journey-green.png", (0, 255, 0))
    red = api.upload_image(logged_in["access_token"], "journey-red.png", (255, 0, 0))
    api.wait_for_image_status(str(blue["id"]))
    api.wait_for_image_status(str(green["id"]))
    api.wait_for_image_status(str(red["id"]))

    visible_library = api.client.get("/images", headers=headers)
    assert visible_library.status_code == 200
    assert visible_library.json()["total"] == 2

    sky_search = api.client.get("/images", headers=headers, params={"tags": "sky"})
    assert sky_search.status_code == 200
    assert [item["id"] for item in sky_search.json()["items"]] == [str(blue["id"])]
    assert sky_search.json()["items"][0]["character_name"] == "ayanami_rei"

    character_search = api.client.get("/images", headers=headers, params={"character_name": "rei"})
    assert character_search.status_code == 200
    assert [item["id"] for item in character_search.json()["items"]] == [str(blue["id"])]

    combined_search = api.client.get(
        "/images",
        headers=headers,
        params={"tags": "sky", "character_name": "ayanami"},
    )
    assert combined_search.status_code == 200
    assert [item["id"] for item in combined_search.json()["items"]] == [str(blue["id"])]

    combined_miss = api.client.get(
        "/images",
        headers=headers,
        params={"tags": "forest", "character_name": "ayanami"},
    )
    assert combined_miss.status_code == 200
    assert combined_miss.json()["items"] == []

    manual_edit = api.client.patch(
        f"/images/{blue['id']}",
        headers=headers,
        json={"tags": ["pilot", "rating:general"], "character_name": "ikari_shinji"},
    )
    assert manual_edit.status_code == 200
    assert manual_edit.json()["tags"] == ["pilot", "rating:general"]
    assert manual_edit.json()["character_name"] == "ikari_shinji"

    corrected_search = api.client.get(
        "/images",
        headers=headers,
        params={"tags": "pilot", "character_name": "shinji"},
    )
    assert corrected_search.status_code == 200
    assert [item["id"] for item in corrected_search.json()["items"]] == [str(blue["id"])]

    stale_search = api.client.get("/images", headers=headers, params={"tags": "sky"})
    assert stale_search.status_code == 200
    assert stale_search.json()["items"] == []

    forest_search = api.client.get("/images", headers=headers, params={"tags": "forest"})
    assert forest_search.status_code == 200
    assert [item["id"] for item in forest_search.json()["items"]] == [str(green["id"])]

    tag_prefix = api.client.get("/tags/search", headers=headers, params={"q": "bl"})
    assert tag_prefix.status_code == 200
    assert [item["name"] for item in tag_prefix.json()] == ["blue"]

    rating_tags = api.client.get("/tags", headers=headers, params={"category": 9})
    assert rating_tags.status_code == 200
    assert {item["name"] for item in rating_tags.json()} == {"rating:general", "rating:questionable"}

    show_nsfw = api.client.patch("/auth/me", headers=headers, json={"show_nsfw": True})
    assert show_nsfw.status_code == 200

    nsfw_search = api.client.get("/images", headers=headers, params={"tags": "rose", "nsfw": "include"})
    assert nsfw_search.status_code == 200
    assert [item["id"] for item in nsfw_search.json()["items"]] == [str(red["id"])]

    clear_character_name = api.client.patch(
        f"/images/{blue['id']}",
        headers=headers,
        json={"character_name": ""},
    )
    assert clear_character_name.status_code == 200
    assert clear_character_name.json()["character_name"] is None

    refreshed = api.client.post("/auth/refresh", json={"refresh_token": logged_in["refresh_token"]})
    assert refreshed.status_code == 200

    _logout(api, logged_in["refresh_token"])
    refresh_after_logout = api.client.post("/auth/refresh", json={"refresh_token": logged_in["refresh_token"]})
    assert refresh_after_logout.status_code == 401


def test_user_journey_full_personal_library_workflow(api):
    registered = api.register_and_login("journey-library")
    _logout(api, registered["refresh_token"])

    logged_in = _login(api, "journey-library")
    headers = api.auth_headers(logged_in["access_token"])

    first = api.upload_image(logged_in["access_token"], "keep-blue.png", (0, 0, 255))
    second = api.upload_image(logged_in["access_token"], "archive-green.png", (0, 255, 0))
    third = api.upload_image(logged_in["access_token"], "discard-red.png", (255, 0, 0))
    api.wait_for_image_status(str(first["id"]))
    api.wait_for_image_status(str(second["id"]))
    api.wait_for_image_status(str(third["id"]))

    album = api.client.post("/albums", headers=headers, json={"name": "Reference Set"})
    assert album.status_code == 201
    album_id = album.json()["id"]

    add_images = api.client.post(
        f"/albums/{album_id}/images",
        headers=headers,
        json={"image_ids": [str(first["id"]), str(second["id"]), str(third["id"])]},
    )
    assert add_images.status_code == 204

    favorite = api.client.post(f"/images/{first['id']}/favorite", headers=headers)
    assert favorite.status_code == 204

    favorite_view = api.client.get("/images", headers=headers, params={"favorited": "true"})
    assert favorite_view.status_code == 200
    assert [item["id"] for item in favorite_view.json()["items"]] == [str(first["id"])]

    bulk_delete = api.client.post(
        "/images/bulk/delete",
        headers=headers,
        json={"image_ids": [str(second["id"]), str(third["id"])]},
    )
    assert bulk_delete.status_code == 200
    assert bulk_delete.json() == {"processed": 2, "skipped": 0}

    album_after_delete = api.client.get(f"/albums/{album_id}/images", headers=headers)
    assert album_after_delete.status_code == 200
    assert [item["id"] for item in album_after_delete.json()["items"]] == [str(first["id"])]

    trash = api.client.get("/images/trash", headers=headers)
    assert trash.status_code == 200
    assert {item["id"] for item in trash.json()["items"]} == {str(second["id"]), str(third["id"])}

    bulk_restore = api.client.post(
        "/images/bulk/restore",
        headers=headers,
        json={"image_ids": [str(second["id"]), str(third["id"])]},
    )
    assert bulk_restore.status_code == 200
    assert bulk_restore.json() == {"processed": 2, "skipped": 0}

    restored_album = api.client.get(f"/albums/{album_id}/images", headers=headers)
    assert restored_album.status_code == 200
    assert {item["id"] for item in restored_album.json()["items"]} == {
        str(first["id"]),
        str(second["id"]),
    }

    bulk_unfavorite = api.client.request(
        "DELETE",
        "/images/bulk/favorite",
        headers=headers,
        json={"image_ids": [str(first["id"])]},
    )
    assert bulk_unfavorite.status_code == 200
    assert bulk_unfavorite.json() == {"processed": 1, "skipped": 0}

    download = api.client.get(f"/albums/{album_id}/download", headers=headers)
    assert download.status_code == 200
    assert download.headers["content-type"] == "application/zip"

    retag = api.client.post(f"/images/{first['id']}/retag", headers=headers)
    assert retag.status_code == 202
    api.wait_for_image_status(str(first["id"]))

    now = api.fetch_image_row(first["id"]).created_at
    api.set_image_created_at(str(first["id"]), now.replace(year=now.year - 1))
    on_this_day = api.client.get("/images/on-this-day", headers=headers)
    assert on_this_day.status_code == 200
    assert on_this_day.json()["years"]

    purge = api.client.post(
        "/images/bulk/purge",
        headers=headers,
        json={"image_ids": [str(third["id"])]},
    )
    assert purge.status_code == 200
    assert purge.json() == {"processed": 1, "skipped": 0}

    remove_from_album = api.client.delete(f"/albums/{album_id}/images/{second['id']}", headers=headers)
    assert remove_from_album.status_code == 204

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

    first = api.upload_image(owner_login["access_token"], "shared-sky.png", (0, 0, 255))
    second = api.upload_image(owner_login["access_token"], "shared-forest.png", (0, 255, 0))
    api.wait_for_image_status(str(first["id"]))
    api.wait_for_image_status(str(second["id"]))

    album = api.client.post("/albums", headers=owner_headers, json={"name": "Shared Finds"})
    assert album.status_code == 201
    album_id = album.json()["id"]

    add_image = api.client.post(
        f"/albums/{album_id}/images",
        headers=owner_headers,
        json={"image_ids": [str(first["id"]), str(second["id"])]},
    )
    assert add_image.status_code == 204

    share = api.client.post(
        f"/albums/{album_id}/share",
        headers=owner_headers,
        json={"user_id": collaborator["user"]["id"], "can_edit": False},
    )
    assert share.status_code == 200

    viewer_album_list = api.client.get("/albums", headers=viewer_headers)
    assert viewer_album_list.status_code == 200
    assert [item["id"] for item in viewer_album_list.json()] == [album_id]

    viewer_album_images = api.client.get(f"/albums/{album_id}/images", headers=viewer_headers)
    assert viewer_album_images.status_code == 200
    assert {item["id"] for item in viewer_album_images.json()["items"]} == {str(first["id"]), str(second["id"])}

    no_edit_yet = api.client.delete(f"/albums/{album_id}/images/{first['id']}", headers=viewer_headers)
    assert no_edit_yet.status_code == 403

    upgrade_share = api.client.post(
        f"/albums/{album_id}/share",
        headers=owner_headers,
        json={"user_id": collaborator["user"]["id"], "can_edit": True},
    )
    assert upgrade_share.status_code == 200

    bulk_remove = api.client.request(
        "DELETE",
        "/images/bulk/album",
        headers=viewer_headers,
        json={"album_id": album_id, "image_ids": [str(second["id"])]},
    )
    assert bulk_remove.status_code == 200
    assert bulk_remove.json() == {"processed": 1, "skipped": 0}

    owner_favorite = api.client.post(f"/images/{first['id']}/favorite", headers=owner_headers)
    assert owner_favorite.status_code == 204

    collaborator_favorite = api.client.post(f"/images/{first['id']}/favorite", headers=viewer_headers)
    assert collaborator_favorite.status_code == 204

    retag = api.client.post(f"/images/{first['id']}/retag", headers=owner_headers)
    assert retag.status_code == 202
    api.wait_for_image_status(str(first["id"]))

    rediscovered = api.client.get("/images", headers=owner_headers, params={"tags": "sky"})
    assert rediscovered.status_code == 200
    assert [item["id"] for item in rediscovered.json()["items"]] == [str(first["id"])]

    revoke = api.client.delete(
        f"/albums/{album_id}/share/{collaborator['user']['id']}",
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
    uploaded = api.upload_image(target_login["access_token"], "admin-review.png", (0, 0, 255))
    api.wait_for_image_status(str(uploaded["id"]))
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
    assert detail.json()["image_count"] == 1

    update = api.client.patch(
        f"/admin/users/{target['user']['id']}",
        headers=admin_headers,
        json={"show_nsfw": True},
    )
    assert update.status_code == 200
    assert update.json()["show_nsfw"] is True

    retag_all = api.client.post(
        f"/admin/users/{target['user']['id']}/retag-all",
        headers=admin_headers,
    )
    assert retag_all.status_code == 202
    assert retag_all.json()["queued"] == 1
    api.wait_for_image_status(str(uploaded["id"]))

    trash_as_admin = api.client.delete(f"/images/{uploaded['id']}", headers=admin_headers)
    assert trash_as_admin.status_code == 204

    trash_list = api.client.get("/images/trash", headers=admin_headers)
    assert trash_list.status_code == 200
    assert [item["id"] for item in trash_list.json()["items"]] == [str(uploaded["id"])]

    restore = api.client.post(f"/images/{uploaded['id']}/restore", headers=admin_headers)
    assert restore.status_code == 204

    delete_user = api.client.delete(
        f"/admin/users/{target['user']['id']}",
        headers=admin_headers,
        params={"delete_images": "true"},
    )
    assert delete_user.status_code == 204

    missing_after_delete = api.client.get(f"/admin/users/{target['user']['id']}", headers=admin_headers)
    assert missing_after_delete.status_code == 404

    _logout(api, admin_login["refresh_token"])
