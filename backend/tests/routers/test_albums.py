from __future__ import annotations

from datetime import datetime, timezone
import io
from types import SimpleNamespace
import uuid

from backend.app.services.albums import AlbumService


def _album_payload(album_id: str, owner_id: str, name: str = "Favorites") -> dict:
    now = datetime.now(timezone.utc).isoformat()
    return {
        "id": album_id,
        "owner_id": owner_id,
        "owner": {
            "id": owner_id,
            "username": "owner",
        },
        "access_role": "owner",
        "name": name,
        "description": "desc",
        "cover_media_id": None,
        "preview_media": [],
        "media_count": 0,
        "version": 1,
        "created_at": now,
        "updated_at": now,
    }


def test_create_album_contract(api_client, monkeypatch):
    owner_id = str(uuid.uuid4())

    async def _fake_create(self, user, name, description):
        return _album_payload(str(uuid.uuid4()), owner_id, name)

    monkeypatch.setattr(AlbumService, "create_album", _fake_create)

    response = api_client.post("/api/v1/albums", json={"name": "Favorites", "description": "desc"})

    assert response.status_code == 201
    assert response.json()["name"] == "Favorites"


def test_list_albums_contract(api_client, monkeypatch):
    async def _fake_list(self, user, after, page_size, sort_by, sort_order):
        return {
            "total": 1,
            "next_cursor": None,
            "has_more": False,
            "page_size": page_size,
            "items": [_album_payload(str(uuid.uuid4()), str(user.id))],
        }

    monkeypatch.setattr(AlbumService, "list_albums", _fake_list)

    response = api_client.get("/api/v1/albums", params={"page_size": 7})

    assert response.status_code == 200
    assert response.json()["page_size"] == 7


def test_get_album_contract(api_client, monkeypatch):
    album_id = uuid.uuid4()

    async def _fake_get_for_user(self, requested_album_id, user):
        return {"id": requested_album_id}

    async def _fake_read(self, album, user):
        return _album_payload(str(album["id"]), str(uuid.uuid4()))

    monkeypatch.setattr(AlbumService, "get_album_for_user", _fake_get_for_user)
    monkeypatch.setattr(AlbumService, "album_read", _fake_read)

    response = api_client.get(f"/api/v1/albums/{album_id}")

    assert response.status_code == 200
    assert response.json()["id"] == str(album_id)


def test_update_album_contract(api_client, monkeypatch):
    album_id = uuid.uuid4()

    async def _fake_update(self, requested_album_id, body, user):
        return _album_payload(str(requested_album_id), str(user.id), "Updated")

    monkeypatch.setattr(AlbumService, "update_album", _fake_update)

    response = api_client.patch(f"/api/v1/albums/{album_id}", json={"name": "Updated", "version": 1})

    assert response.status_code == 200
    assert response.json()["name"] == "Updated"


def test_delete_album_contract(api_client, monkeypatch):
    async def _fake_delete(self, album_id, user):
        return None

    monkeypatch.setattr(AlbumService, "delete_album", _fake_delete)

    response = api_client.delete(f"/api/v1/albums/{uuid.uuid4()}")

    assert response.status_code == 204


def test_list_album_media_contract(api_client, monkeypatch):
    async def _fake_list(self, album_id, user, tag, exclude_tag, mode, after, page_size):
        return {
            "total": 0,
            "next_cursor": None,
            "has_more": False,
            "page_size": page_size,
            "items": [],
        }

    monkeypatch.setattr(AlbumService, "list_album_media", _fake_list)

    response = api_client.get(f"/api/v1/albums/{uuid.uuid4()}/media", params={"page_size": 3})

    assert response.status_code == 200
    assert response.json()["page_size"] == 3


def test_add_media_to_album_contract(api_client, monkeypatch):
    async def _fake_add(self, album_id, media_ids, user):
        return {"processed": 2, "skipped": 1}

    monkeypatch.setattr(AlbumService, "bulk_add_to_album", _fake_add)

    response = api_client.put(
        f"/api/v1/albums/{uuid.uuid4()}/media",
        json={"media_ids": [str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())]},
    )

    assert response.status_code == 200
    assert response.json()["processed"] == 2


def test_remove_media_from_album_contract(api_client, monkeypatch):
    async def _fake_remove(self, album_id, media_ids, user):
        return {"processed": 1, "skipped": 1}

    monkeypatch.setattr(AlbumService, "bulk_remove_from_album", _fake_remove)

    response = api_client.request(
        "DELETE",
        f"/api/v1/albums/{uuid.uuid4()}/media",
        json={"media_ids": [str(uuid.uuid4()), str(uuid.uuid4())]},
    )

    assert response.status_code == 200
    assert response.json()["skipped"] == 1


def test_share_album_contract(api_client, monkeypatch):
    album_id = uuid.uuid4()
    shared_user_id = uuid.uuid4()

    async def _fake_share(self, requested_album_id, body, user):
        now = datetime.now(timezone.utc).isoformat()
        return (
            {
                "user_id": str(shared_user_id),
                "role": "viewer",
                "status": "pending",
                "shared_at": now,
                "shared_by_user_id": str(user.id),
            },
            True,
        )

    monkeypatch.setattr(AlbumService, "share_album", _fake_share)

    response = api_client.post(
        f"/api/v1/albums/{album_id}/shares",
        json={"username": "viewer_user", "role": "viewer"},
    )

    assert response.status_code == 201
    assert response.json()["user_id"] == str(shared_user_id)
    assert response.json()["status"] == "pending"


def test_list_album_access_contract(api_client, monkeypatch):
    album_id = uuid.uuid4()
    owner_id = uuid.uuid4()
    shared_user_id = uuid.uuid4()

    async def _fake_list_access(self, requested_album_id, user):
        now = datetime.now(timezone.utc).isoformat()
        return {
            "owner": {
                "id": str(owner_id),
                "username": "owner",
            },
            "entries": [
                {
                    "user_id": str(shared_user_id),
                    "username": "viewer_user",
                    "role": "viewer",
                    "status": "accepted",
                    "shared_at": now,
                    "shared_by_user_id": str(owner_id),
                    "shared_by_username": "owner",
                },
            ],
        }

    monkeypatch.setattr(AlbumService, "list_album_access", _fake_list_access)

    response = api_client.get(f"/api/v1/albums/{album_id}/shares")

    assert response.status_code == 200
    assert response.json()["owner"]["id"] == str(owner_id)
    assert response.json()["entries"][0]["username"] == "viewer_user"


def test_transfer_album_owner_contract(api_client, monkeypatch):
    album_id = uuid.uuid4()

    async def _fake_transfer(self, requested_album_id, body, user):
        return _album_payload(str(requested_album_id), str(body.new_owner_user_id), "Transferred")

    monkeypatch.setattr(AlbumService, "transfer_album_ownership", _fake_transfer)

    response = api_client.post(
        f"/api/v1/albums/{album_id}/owner/transfer",
        json={"new_owner_user_id": str(uuid.uuid4()), "keep_editor_access": True},
    )

    assert response.status_code == 200
    assert response.json()["name"] == "Transferred"


def test_download_album_contract(api_client, monkeypatch):
    async def _fake_download(self, album_id, user):
        return (SimpleNamespace(name="My Album"), [{"filepath": "/tmp/a", "filename": "a.webp", "original_filename": "a.webp"}])

    monkeypatch.setattr(AlbumService, "get_album_download_media", _fake_download)
    monkeypatch.setattr("backend.app.routers.albums.zip_media", lambda rows: io.BytesIO(b"zip-bytes"))

    response = api_client.get(f"/api/v1/albums/{uuid.uuid4()}/download")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/zip")


def test_revoke_album_share_contract(api_client, monkeypatch):
    async def _fake_revoke(self, album_id, shared_user_id, user):
        return None

    monkeypatch.setattr(AlbumService, "revoke_share", _fake_revoke)

    response = api_client.delete(f"/api/v1/albums/{uuid.uuid4()}/shares/{uuid.uuid4()}")

    assert response.status_code == 204
