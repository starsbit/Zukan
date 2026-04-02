from __future__ import annotations

from datetime import datetime, timezone
import io
from types import SimpleNamespace
import uuid

from backend.app.services.media.lifecycle import MediaLifecycleService
from backend.app.services.media.metadata import MediaMetadataService
from backend.app.services.media.processing import MediaProcessingService
from backend.app.services.media.query import MediaQueryService
from backend.app.services.media.upload import MediaUploadService


def _media_read_payload(media_id: str) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    return {
        "id": media_id,
        "uploader_id": str(uuid.uuid4()),
        "uploader_username": "uploader",
        "owner_id": str(uuid.uuid4()),
        "owner_username": "owner",
        "visibility": "private",
        "filename": "a.webp",
        "original_filename": "a.webp",
        "media_type": "image",
        "metadata": {
            "file_size": 123,
            "width": 10,
            "height": 10,
            "duration_seconds": None,
            "frame_count": 1,
            "mime_type": "image/webp",
            "captured_at": now,
        },
        "version": 1,
        "created_at": now,
        "deleted_at": None,
        "tags": ["safe"],
        "ocr_text_override": None,
        "is_nsfw": False,
        "tagging_status": "done",
        "tagging_error": None,
        "thumbnail_status": "done",
        "poster_status": "not_applicable",
        "ocr_text": None,
        "is_favorited": False,
    }


def test_upload_media_contract(api_client, monkeypatch):
    captured = {}

    async def _fake_upload(self, user, files, album_id, tags, captured_at_override, captured_at_values=None, visibility="private"):
        captured["captured_at_values"] = captured_at_values
        batch_id = str(uuid.uuid4())
        item_id = str(uuid.uuid4())
        media_id = str(uuid.uuid4())
        return {
            "batch_id": batch_id,
            "batch_url": f"/api/v1/me/import-batches/{batch_id}",
            "batch_items_url": f"/api/v1/me/import-batches/{batch_id}/items",
            "poll_after_seconds": 2,
            "webhooks_supported": False,
            "accepted": 1,
            "duplicates": 0,
            "errors": 0,
            "results": [
                {
                    "id": media_id,
                    "batch_item_id": item_id,
                    "original_filename": "a.webp",
                    "status": "accepted",
                    "message": None,
                }
            ],
        }

    monkeypatch.setattr(MediaUploadService, "upload_files", _fake_upload)

    response = api_client.post(
        "/api/v1/media",
        files=[
            ("files", ("a.webp", b"abc", "image/webp")),
            ("captured_at_values", (None, "2024-02-03T04:05:06Z")),
        ],
    )

    assert response.status_code == 202
    assert response.json()["accepted"] == 1
    assert captured["captured_at_values"] == [datetime(2024, 2, 3, 4, 5, 6, tzinfo=timezone.utc)]


def test_list_media_contract(api_client, monkeypatch):
    async def _fake_list(self, *args):
        return {"total": 0, "next_cursor": None, "has_more": False, "page_size": 5, "items": []}

    monkeypatch.setattr(MediaQueryService, "list_media", _fake_list)

    response = api_client.get("/api/v1/media", params={"page_size": 5})

    assert response.status_code == 200
    assert response.json()["page_size"] == 5


def test_search_media_contract(api_client, monkeypatch):
    async def _fake_list(self, *args):
        return {"total": 0, "next_cursor": None, "has_more": False, "page_size": 6, "items": []}

    monkeypatch.setattr(MediaQueryService, "list_media", _fake_list)

    response = api_client.get("/api/v1/media/search", params={"page_size": 6, "ocr_text": "fate", "series_name": "Fate"})

    assert response.status_code == 200
    assert response.json()["page_size"] == 6


def test_media_timeline_contract(api_client, monkeypatch):
    captured = {}

    async def _fake_timeline(self, user, **kwargs):
        captured.update(kwargs)
        return {"buckets": []}

    monkeypatch.setattr(MediaQueryService, "get_timeline", _fake_timeline)

    response = api_client.get("/api/v1/media/timeline", params={"tag": "safe", "status": "reviewed", "favorited": "false", "series_name": "Fate"})

    assert response.status_code == 200
    assert response.json() == {"buckets": []}
    assert captured["tags"] == ["safe"]
    assert captured["status_filter"] == "reviewed"
    assert captured["favorited"] is False
    assert captured["series_name"] == "Fate"


def test_character_suggestions_contract(api_client, monkeypatch):
    async def _fake_suggestions(self, user, q, limit):
        return [{"name": "Saber", "media_count": 2}]

    monkeypatch.setattr(MediaQueryService, "list_character_suggestions", _fake_suggestions)

    response = api_client.get("/api/v1/media/character-suggestions", params={"q": "Sa", "limit": 10})

    assert response.status_code == 200
    assert response.json()[0]["name"] == "Saber"


def test_series_suggestions_contract(api_client, monkeypatch):
    async def _fake_suggestions(self, user, q, limit):
        assert q == "S"
        assert limit == 6
        return [{"name": "Fate/stay night", "media_count": 2}]

    monkeypatch.setattr(MediaQueryService, "list_series_suggestions", _fake_suggestions)

    response = api_client.get("/api/v1/media/series-suggestions", params={"q": "S", "limit": 6})

    assert response.status_code == 200
    assert response.json()[0]["name"] == "Fate/stay night"


def test_batch_update_contract(api_client, monkeypatch):
    async def _fake_bulk_delete(self, media_ids, user):
        return {"processed": 1, "skipped": 0}

    monkeypatch.setattr(MediaLifecycleService, "bulk_delete_media", _fake_bulk_delete)

    response = api_client.patch("/api/v1/media", json={"media_ids": [str(uuid.uuid4())], "deleted": True})

    assert response.status_code == 200
    assert response.json()["processed"] == 1


def test_batch_update_visibility_contract(api_client, monkeypatch):
    async def _fake_bulk_visibility(self, media_ids, user, visibility):
        assert visibility == "public"
        return {"processed": 2, "skipped": 1}

    monkeypatch.setattr(MediaMetadataService, "bulk_update_visibility", _fake_bulk_visibility)

    response = api_client.patch("/api/v1/media", json={"media_ids": [str(uuid.uuid4())], "visibility": "public"})

    assert response.status_code == 200
    assert response.json() == {"processed": 2, "skipped": 1}


def test_batch_update_entities_contract(api_client, monkeypatch):
    async def _fake_bulk_entities(self, body, user):
        assert body.character_names == ["Saber"]
        assert body.series_names == ["Fate/stay night"]
        return {"processed": 2, "skipped": 0}

    monkeypatch.setattr(MediaMetadataService, "bulk_update_entities", _fake_bulk_entities)

    response = api_client.patch(
        "/api/v1/media/entities",
        json={
            "media_ids": [str(uuid.uuid4())],
            "character_names": ["Saber"],
            "series_names": ["Fate/stay night"],
        },
    )

    assert response.status_code == 200
    assert response.json() == {"processed": 2, "skipped": 0}


def test_batch_delete_command_contract(api_client, monkeypatch):
    async def _fake_delete(self, body, user):
        return {"processed": 2, "skipped": 1}

    monkeypatch.setattr(MediaLifecycleService, "batch_delete_media", _fake_delete)

    response = api_client.post("/api/v1/media/actions/delete", json={"media_ids": [str(uuid.uuid4())]})

    assert response.status_code == 200
    assert response.json()["skipped"] == 1


def test_batch_purge_contract(api_client, monkeypatch):
    async def _fake_purge(self, body, user):
        return {"processed": 3, "skipped": 1}

    monkeypatch.setattr(MediaLifecycleService, "batch_purge_media", _fake_purge)

    response = api_client.post("/api/v1/media/actions/purge", json={"media_ids": [str(uuid.uuid4())]})

    assert response.status_code == 200
    assert response.json()["processed"] == 3


def test_empty_trash_contract(api_client, monkeypatch):
    async def _fake_empty(self, user):
        return None

    monkeypatch.setattr(MediaLifecycleService, "empty_trash", _fake_empty)

    response = api_client.post("/api/v1/media/actions/empty-trash")

    assert response.status_code == 204


def test_download_media_contract(api_client, monkeypatch):
    async def _fake_downloadables(self, user, media_ids):
        return [{"filepath": "/tmp/a", "filename": "a.webp", "original_filename": "a.webp"}]

    monkeypatch.setattr(MediaQueryService, "get_downloadable_media", _fake_downloadables)
    monkeypatch.setattr("backend.app.routers.media.zip_media", lambda rows: io.BytesIO(b"zip-bytes"))

    response = api_client.post("/api/v1/media/download", json={"media_ids": [str(uuid.uuid4())]})

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/zip")


def test_get_media_contract(api_client, monkeypatch):
    media_id = uuid.uuid4()

    async def _fake_get(self, requested_media_id, user):
        payload = _media_read_payload(str(requested_media_id))
        payload["tag_details"] = []
        payload["external_refs"] = []
        payload["entities"] = []
        return payload

    monkeypatch.setattr(MediaQueryService, "get_media_detail", _fake_get)

    response = api_client.get(f"/api/v1/media/{media_id}")

    assert response.status_code == 200
    assert response.json()["id"] == str(media_id)


def test_update_media_contract(api_client, monkeypatch):
    media_id = uuid.uuid4()

    async def _fake_update(self, requested_media_id, user, body):
        payload = _media_read_payload(str(requested_media_id))
        payload["tag_details"] = []
        payload["external_refs"] = []
        payload["entities"] = []
        return payload

    monkeypatch.setattr(MediaMetadataService, "update_media_metadata", _fake_update)

    response = api_client.patch(f"/api/v1/media/{media_id}", json={"version": 1, "favorited": True})

    assert response.status_code == 200
    assert response.json()["id"] == str(media_id)


def test_get_media_file_contract(api_client, monkeypatch, tmp_path):
    media_path = tmp_path / "a.webp"
    media_path.write_bytes(b"abc")

    async def _fake_visible(self, media_id, user):
        return SimpleNamespace(filepath=str(media_path), mime_type="image/webp")

    monkeypatch.setattr(MediaQueryService, "get_visible_media", _fake_visible)

    response = api_client.get(f"/api/v1/media/{uuid.uuid4()}/file")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/webp")


def test_get_media_thumbnail_contract(api_client, monkeypatch, tmp_path):
    thumb_path = tmp_path / "thumb.webp"
    thumb_path.write_bytes(b"thumb")

    async def _fake_visible(self, media_id, user):
        return SimpleNamespace(thumbnail_path=str(thumb_path))

    monkeypatch.setattr(MediaQueryService, "get_visible_media", _fake_visible)

    response = api_client.get(f"/api/v1/media/{uuid.uuid4()}/thumbnail")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/webp")


def test_get_media_poster_contract(api_client, monkeypatch, tmp_path):
    poster_path = tmp_path / "poster.png"
    poster_path.write_bytes(b"poster")

    async def _fake_visible(self, media_id, user):
        return SimpleNamespace(poster_path=str(poster_path))

    monkeypatch.setattr(MediaQueryService, "get_visible_media", _fake_visible)

    response = api_client.get(f"/api/v1/media/{uuid.uuid4()}/poster")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/png")


def test_delete_media_contract(api_client, monkeypatch):
    async def _fake_delete(self, media_id, user):
        return None

    monkeypatch.setattr(MediaLifecycleService, "soft_delete_media", _fake_delete)

    response = api_client.delete(f"/api/v1/media/{uuid.uuid4()}")

    assert response.status_code == 204


def test_restore_media_contract(api_client, monkeypatch):
    async def _fake_restore(self, media_id, user):
        return None

    monkeypatch.setattr(MediaLifecycleService, "restore_media", _fake_restore)

    response = api_client.post(f"/api/v1/media/{uuid.uuid4()}/restore")

    assert response.status_code == 204


def test_purge_media_contract(api_client, monkeypatch):
    async def _fake_purge(self, media_id, user):
        return None

    monkeypatch.setattr(MediaLifecycleService, "purge_media", _fake_purge)

    response = api_client.delete(f"/api/v1/media/{uuid.uuid4()}/purge")

    assert response.status_code == 204


def test_queue_media_tagging_job_contract(api_client, monkeypatch):
    async def _fake_retag(self, media_id, user):
        return 4

    monkeypatch.setattr(MediaProcessingService, "retag_media", _fake_retag)

    response = api_client.post(f"/api/v1/media/{uuid.uuid4()}/tagging-jobs")

    assert response.status_code == 202
    assert response.json() == {"queued": 4}


def test_queue_bulk_media_tagging_jobs_contract(api_client, monkeypatch):
    async def _fake_bulk_retag(self, media_ids, user):
        return 2

    monkeypatch.setattr(MediaProcessingService, "bulk_retag_media", _fake_bulk_retag)

    response = api_client.post("/api/v1/media/tagging-jobs", json={"media_ids": [str(uuid.uuid4()), str(uuid.uuid4())]})

    assert response.status_code == 202
    assert response.json() == {"queued": 2}
