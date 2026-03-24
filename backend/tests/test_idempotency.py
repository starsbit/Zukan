import uuid

from backend.tests.api_test_support import png_bytes


def test_logout_is_safe_to_repeat(api):
    auth = api.register_and_login("idem-logout")

    first = api.client.post("/auth/logout", json={"refresh_token": auth["refresh_token"]})
    assert first.status_code == 204

    second = api.client.post("/auth/logout", json={"refresh_token": auth["refresh_token"]})
    assert second.status_code == 204


def test_upload_replay_with_idempotency_key_returns_same_result(api):
    user = api.register_and_login("idem-upload")
    headers = {
        **api.auth_headers(user["access_token"]),
        "Idempotency-Key": "upload-key-1",
    }

    first = api.client.post(
        "/media",
        headers=headers,
        files=[("files", ("idem-blue.png", png_bytes((0, 0, 255)), "image/png"))],
    )
    assert first.status_code == 202
    first_payload = first.json()

    second = api.client.post(
        "/media",
        headers=headers,
        files=[("files", ("idem-blue.png", png_bytes((0, 0, 255)), "image/png"))],
    )
    assert second.status_code == 202
    assert second.json() == first_payload

    media_id = first_payload["results"][0]["id"]
    api.wait_for_media_status(str(media_id))

    visible = api.client.get("/media", headers=api.auth_headers(user["access_token"]))
    assert visible.status_code == 200
    assert [item["id"] for item in visible.json()["items"]] == [str(media_id)]


def test_share_create_replay_returns_same_status_and_blocks_payload_change(api):
    owner = api.register_and_login("idem-share-owner")
    viewer = api.register_and_login("idem-share-viewer")
    owner_headers = api.auth_headers(owner["access_token"])

    album = api.client.post("/albums", headers=owner_headers, json={"name": "Idempotency Album"})
    assert album.status_code == 201
    album_id = album.json()["id"]

    request_headers = {**owner_headers, "Idempotency-Key": "share-key-1"}
    body = {"user_id": viewer["user"]["id"], "role": "viewer"}

    first = api.client.post(f"/albums/{album_id}/shares", headers=request_headers, json=body)
    assert first.status_code == 201
    first_payload = first.json()

    second = api.client.post(f"/albums/{album_id}/shares", headers=request_headers, json=body)
    assert second.status_code == 201
    assert second.json() == first_payload

    changed_payload = {"user_id": viewer["user"]["id"], "role": "editor"}
    mismatch = api.client.post(f"/albums/{album_id}/shares", headers=request_headers, json=changed_payload)
    assert mismatch.status_code == 409
    assert mismatch.json()["code"] == "idempotency_key_conflict"


def test_batch_delete_replay_with_idempotency_key_returns_same_result(api):
    owner = api.register_and_login("idem-batch")
    headers = api.auth_headers(owner["access_token"])

    first = api.upload_media(owner["access_token"], "idem-batch-1.png", (0, 0, 255))
    second = api.upload_media(owner["access_token"], "idem-batch-2.png", (0, 255, 0))
    api.wait_for_media_status(str(first["id"]))
    api.wait_for_media_status(str(second["id"]))

    request_headers = {**headers, "Idempotency-Key": "batch-trash-key-1"}
    body = {"media_ids": [str(first["id"]), str(second["id"])], "deleted": True}

    first_batch = api.client.patch("/media", headers=request_headers, json=body)
    assert first_batch.status_code == 200
    assert first_batch.json() == {"processed": 2, "skipped": 0}

    replay_batch = api.client.patch("/media", headers=request_headers, json=body)
    assert replay_batch.status_code == 200
    assert replay_batch.json() == {"processed": 2, "skipped": 0}

    changed_body = {"media_ids": [str(first["id"]), str(uuid.uuid4())], "deleted": True}
    mismatch = api.client.patch("/media", headers=request_headers, json=changed_body)
    assert mismatch.status_code == 409
    assert mismatch.json()["code"] == "idempotency_key_conflict"
