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
        "app_version": "0.1.0",
        "worker_version": "0.1.0",
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
