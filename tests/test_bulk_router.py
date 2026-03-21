import uuid


def test_bulk_favorite_delete_and_restore_endpoints(api):
    owner = api.register_and_login("bulk-owner")
    other = api.register_and_login("bulk-other")

    owner_first = api.upload_image(owner["access_token"], "bulk-owner-blue.png", (0, 0, 255))
    owner_second = api.upload_image(owner["access_token"], "bulk-owner-green.png", (0, 255, 0))
    other_image = api.upload_image(other["access_token"], "bulk-other-red.png", (255, 0, 0))
    api.wait_for_image_status(str(owner_first["id"]))
    api.wait_for_image_status(str(owner_second["id"]))
    api.wait_for_image_status(str(other_image["id"]))

    owner_headers = api.auth_headers(owner["access_token"])
    missing_id = str(uuid.uuid4())

    favorite = api.client.patch(
        "/images",
        headers=owner_headers,
        json={"image_ids": [str(owner_first["id"]), str(owner_second["id"]), missing_id], "favorited": True},
    )
    assert favorite.status_code == 200
    assert favorite.json() == {"processed": 2, "skipped": 1}

    unfavorite = api.client.patch(
        "/images",
        headers=owner_headers,
        json={"image_ids": [str(owner_first["id"]), missing_id], "favorited": False},
    )
    assert unfavorite.status_code == 200
    assert unfavorite.json() == {"processed": 1, "skipped": 1}

    bulk_delete = api.client.patch(
        "/images",
        headers=owner_headers,
        json={"image_ids": [str(owner_first["id"]), str(other_image["id"]), missing_id], "deleted": True},
    )
    assert bulk_delete.status_code == 200
    assert bulk_delete.json() == {"processed": 1, "skipped": 2}

    trash = api.client.get("/images", headers=owner_headers, params={"state": "trashed"})
    assert trash.status_code == 200
    assert [item["id"] for item in trash.json()["items"]] == [str(owner_first["id"])]

    bulk_restore = api.client.patch(
        "/images",
        headers=owner_headers,
        json={"image_ids": [str(owner_first["id"]), str(other_image["id"]), missing_id], "deleted": False},
    )
    assert bulk_restore.status_code == 200
    assert bulk_restore.json() == {"processed": 1, "skipped": 2}


def test_bulk_album_and_purge_endpoints(api):
    owner = api.register_and_login("bulk-album-owner")
    collaborator = api.register_and_login("bulk-collaborator")
    outsider = api.register_and_login("bulk-outsider")
    admin_login = api.client.post("/auth/login", json={"username": "admin", "password": "admin"})
    assert admin_login.status_code == 200

    owner_headers = api.auth_headers(owner["access_token"])
    collaborator_headers = api.auth_headers(collaborator["access_token"])
    admin_headers = api.auth_headers(admin_login.json()["access_token"])

    first = api.upload_image(owner["access_token"], "bulk-album-blue.png", (0, 0, 255))
    second = api.upload_image(owner["access_token"], "bulk-album-green.png", (0, 255, 0))
    outsider_image = api.upload_image(outsider["access_token"], "bulk-outsider-red.png", (255, 0, 0))
    api.wait_for_image_status(str(first["id"]))
    api.wait_for_image_status(str(second["id"]))
    api.wait_for_image_status(str(outsider_image["id"]))

    created = api.client.post("/albums", headers=owner_headers, json={"name": "Bulk Album"})
    assert created.status_code == 201
    album_id = created.json()["id"]

    share = api.client.post(
        f"/albums/{album_id}/shares",
        headers=owner_headers,
        json={"user_id": collaborator["user"]["id"], "can_edit": True},
    )
    assert share.status_code == 200

    add_to_album = api.client.put(
        f"/albums/{album_id}/images",
        headers=collaborator_headers,
        json={"image_ids": [str(first["id"]), str(second["id"]), str(uuid.uuid4())]},
    )
    assert add_to_album.status_code == 200
    assert add_to_album.json() == {"processed": 2, "skipped": 1}

    album_images = api.client.get(f"/albums/{album_id}/images", headers=collaborator_headers)
    assert album_images.status_code == 200
    assert [item["id"] for item in album_images.json()["items"]] == [str(first["id"]), str(second["id"])]

    remove_from_album = api.client.request(
        "DELETE",
        f"/albums/{album_id}/images",
        headers=collaborator_headers,
        json={"image_ids": [str(second["id"]), str(uuid.uuid4())]},
    )
    assert remove_from_album.status_code == 200
    assert remove_from_album.json() == {"processed": 1, "skipped": 1}

    purge = api.client.request(
        "DELETE",
        "/images",
        headers=owner_headers,
        json={"image_ids": [str(first["id"]), str(outsider_image["id"]), str(uuid.uuid4())]},
    )
    assert purge.status_code == 200
    assert purge.json() == {"processed": 1, "skipped": 2}

    admin_purge = api.client.request(
        "DELETE",
        "/images",
        headers=admin_headers,
        json={"image_ids": [str(outsider_image["id"]), str(uuid.uuid4())]},
    )
    assert admin_purge.status_code == 200
    assert admin_purge.json() == {"processed": 1, "skipped": 1}


def test_batch_patch_validation_and_empty_trash_endpoint(api):
    owner = api.register_and_login("bulk-validation-owner")
    headers = api.auth_headers(owner["access_token"])

    first = api.upload_image(owner["access_token"], "validation-blue.png", (0, 0, 255))
    second = api.upload_image(owner["access_token"], "validation-green.png", (0, 255, 0))
    api.wait_for_image_status(str(first["id"]))
    api.wait_for_image_status(str(second["id"]))

    invalid = api.client.patch(
        "/images",
        headers=headers,
        json={"image_ids": [str(first["id"])]},
    )
    assert invalid.status_code == 422

    trash_many = api.client.patch(
        "/images",
        headers=headers,
        json={"image_ids": [str(first["id"]), str(second["id"])], "deleted": True},
    )
    assert trash_many.status_code == 200
    assert trash_many.json() == {"processed": 2, "skipped": 0}

    empty_trash = api.client.delete("/images/trash", headers=headers)
    assert empty_trash.status_code == 204
    assert api.fetch_image_row(uuid.UUID(str(first["id"]))) is None
    assert api.fetch_image_row(uuid.UUID(str(second["id"]))) is None
