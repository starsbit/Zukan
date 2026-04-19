from __future__ import annotations

from datetime import datetime, timezone
import uuid

from backend.app.services.processing import ProcessingService


def _batch_payload(batch_id: str, user_id: str) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    return {
        "id": batch_id,
        "user_id": user_id,
        "type": "upload",
        "status": "running",
        "total_items": 10,
        "queued_items": 2,
        "processing_items": 2,
        "done_items": 5,
        "failed_items": 1,
        "created_at": now,
        "started_at": now,
        "finished_at": None,
        "last_heartbeat_at": now,
        "app_version": "0.1.3",
        "worker_version": "0.1.3",
        "error_summary": None,
    }


def test_list_batches_contract(api_client, monkeypatch):
    async def _fake_list(self, user_id, after, page_size):
        return {
            "total": 1,
            "next_cursor": None,
            "has_more": False,
            "page_size": page_size,
            "items": [_batch_payload(str(uuid.uuid4()), str(user_id))],
        }

    monkeypatch.setattr(ProcessingService, "list_batches", _fake_list)

    response = api_client.get("/api/v1/me/import-batches", params={"page_size": 3})

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert payload["items"][0]["type"] == "upload"


def test_get_batch_contract(api_client, monkeypatch):
    batch_id = uuid.uuid4()

    async def _fake_get(self, request_batch_id, user_id):
        assert request_batch_id == batch_id
        return _batch_payload(str(batch_id), str(user_id))

    monkeypatch.setattr(ProcessingService, "get_batch_for_user", _fake_get)

    response = api_client.get(f"/api/v1/me/import-batches/{batch_id}")

    assert response.status_code == 200
    assert response.json()["id"] == str(batch_id)


def test_list_batch_items_contract(api_client, monkeypatch):
    batch_id = uuid.uuid4()

    async def _fake_items(self, request_batch_id, user_id, after, page_size):
        now = datetime.now(timezone.utc).isoformat()
        return {
            "total": 1,
            "next_cursor": None,
            "has_more": False,
            "page_size": page_size,
            "items": [
                {
                    "id": str(uuid.uuid4()),
                    "batch_id": str(request_batch_id),
                    "media_id": None,
                    "source_filename": "a.webp",
                    "status": "done",
                    "step": "tag",
                    "progress_percent": 100,
                    "error": None,
                    "updated_at": now,
                }
            ],
        }

    monkeypatch.setattr(ProcessingService, "list_batch_items", _fake_items)

    response = api_client.get(f"/api/v1/me/import-batches/{batch_id}/items", params={"page_size": 10})

    assert response.status_code == 200
    assert response.json()["items"][0]["batch_id"] == str(batch_id)


def test_list_batch_review_items_contract(api_client, monkeypatch):
    batch_id = uuid.uuid4()

    async def _fake_review(self, request_batch_id, user_id, include_recommendations=False, force_refresh=False):
        assert request_batch_id == batch_id
        assert include_recommendations is False
        now = datetime.now(timezone.utc).isoformat()
        media_id = str(uuid.uuid4())
        return {
            "total": 1,
            "recommendation_groups": [
                {
                    "id": "batch-group-1",
                    "media_ids": [media_id],
                    "item_count": 1,
                    "missing_character_count": 1,
                    "missing_series_count": 1,
                    "suggested_characters": [{"name": "Saber", "confidence": 0.95}],
                    "suggested_series": [{"name": "Fate/stay night", "confidence": 0.92}],
                    "shared_signals": [{"kind": "tag", "label": "blue dress", "confidence": 0.8}],
                    "confidence": 0.81,
                }
            ],
            "items": [
                {
                    "batch_item_id": str(uuid.uuid4()),
                    "media": {
                        "id": media_id,
                        "uploader_id": str(user_id),
                        "uploader_username": "demo",
                        "owner_id": str(user_id),
                        "owner_username": "demo",
                        "visibility": "private",
                        "filename": "a.webp",
                        "original_filename": "a.webp",
                        "media_type": "image",
                        "metadata": {
                            "file_size": 1,
                            "width": 10,
                            "height": 10,
                            "duration_seconds": None,
                            "frame_count": 1,
                            "mime_type": "image/webp",
                            "captured_at": now,
                        },
                        "version": 1,
                        "uploaded_at": now,
                        "deleted_at": None,
                        "tags": [],
                        "ocr_text_override": None,
                        "is_nsfw": False,
                        "tagging_status": "done",
                        "tagging_error": None,
                        "thumbnail_status": "done",
                        "poster_status": "not_applicable",
                        "ocr_text": None,
                        "is_favorited": False,
                        "favorite_count": 0,
                    },
                    "entities": [
                        {
                            "id": str(uuid.uuid4()),
                            "entity_type": "series",
                            "entity_id": None,
                            "name": "Fate/stay night",
                            "role": "primary",
                            "source": "library_match",
                            "confidence": 0.91,
                        }
                    ],
                    "source_filename": "a.webp",
                    "missing_character": True,
                    "missing_series": True,
                }
            ],
        }

    monkeypatch.setattr(ProcessingService, "list_batch_review_items", _fake_review)

    response = api_client.get(f"/api/v1/me/import-batches/{batch_id}/review-items")

    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["recommendation_groups"][0]["suggested_characters"][0]["name"] == "Saber"


def test_list_batch_review_items_with_recommendations_contract(api_client, monkeypatch):
    batch_id = uuid.uuid4()

    async def _fake_review(self, request_batch_id, user_id, include_recommendations=False, force_refresh=False):
        assert request_batch_id == batch_id
        assert include_recommendations is True
        return {
            "total": 0,
            "recommendation_groups": [],
            "items": [],
        }

    monkeypatch.setattr(ProcessingService, "list_batch_review_items", _fake_review)

    response = api_client.get(
        f"/api/v1/me/import-batches/{batch_id}/review-items",
        params={"include_recommendations": "true"},
    )

    assert response.status_code == 200


def test_list_all_review_items_contract(api_client, monkeypatch):
    async def _fake_review(self, user_id, include_recommendations=False):
        assert include_recommendations is True
        now = datetime.now(timezone.utc).isoformat()
        media_id = str(uuid.uuid4())
        return {
            "total": 2,
            "recommendation_groups": [],
            "items": [
                {
                    "batch_item_id": str(uuid.uuid4()),
                    "media": {
                        "id": media_id,
                        "uploader_id": str(user_id),
                        "uploader_username": "demo",
                        "owner_id": str(user_id),
                        "owner_username": "demo",
                        "visibility": "private",
                        "filename": "a.webp",
                        "original_filename": "a.webp",
                        "media_type": "image",
                        "metadata": {
                            "file_size": 1,
                            "width": 10,
                            "height": 10,
                            "duration_seconds": None,
                            "frame_count": 1,
                            "mime_type": "image/webp",
                            "captured_at": now,
                        },
                        "version": 1,
                        "uploaded_at": now,
                        "deleted_at": None,
                        "tags": [],
                        "ocr_text_override": None,
                        "is_nsfw": False,
                        "tagging_status": "done",
                        "tagging_error": None,
                        "thumbnail_status": "done",
                        "poster_status": "not_applicable",
                        "ocr_text": None,
                        "is_favorited": False,
                        "favorite_count": 0,
                    },
                    "entities": [],
                    "source_filename": "a.webp",
                    "missing_character": True,
                    "missing_series": True,
                }
            ],
        }

    monkeypatch.setattr(ProcessingService, "list_all_review_items", _fake_review)

    response = api_client.get(
        "/api/v1/me/import-batches/review-items",
        params={"include_recommendations": "true"},
    )

    assert response.status_code == 200
    assert response.json()["total"] == 2


def test_merge_review_batches_contract(api_client, monkeypatch):
    async def _fake_merge(self, user_id, include_recommendations=False, force_refresh=False):
        assert include_recommendations is True
        assert force_refresh is True
        return {
            "merged_batch_id": str(uuid.uuid4()),
            "total": 2,
            "recommendation_groups": [],
            "items": [],
        }

    monkeypatch.setattr(ProcessingService, "merge_review_batches", _fake_merge)

    response = api_client.post(
        "/api/v1/me/import-batches/review-merge",
        params={"include_recommendations": "true", "force_refresh": "true"},
    )

    assert response.status_code == 200
    assert response.json()["total"] == 2
    assert "merged_batch_id" in response.json()


def test_get_review_summary_contract(api_client, monkeypatch):
    async def _fake_summary(self, user_id):
        now = datetime.now(timezone.utc).isoformat()
        batch_id = str(uuid.uuid4())
        return {
            "unresolved_count": 4,
            "review_batch_ids": [batch_id],
            "latest_batch_id": batch_id,
            "latest_batch_created_at": now,
        }

    monkeypatch.setattr(ProcessingService, "get_review_summary", _fake_summary)

    response = api_client.get("/api/v1/me/import-batches/review-summary")

    assert response.status_code == 200
    payload = response.json()
    assert payload["unresolved_count"] == 4
    assert len(payload["review_batch_ids"]) == 1
