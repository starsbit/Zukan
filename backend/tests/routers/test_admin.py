from __future__ import annotations
from datetime import datetime, timezone
from types import SimpleNamespace
import uuid
from unittest.mock import AsyncMock, patch
from backend.app.repositories.notifications import AppAnnouncementRepository
from backend.app.services.admin import AdminService
from backend.app.config import settings

def test_admin_stats_contract(api_client, monkeypatch):

    async def _fake_stats(self):
        return {
            "total_users": 5,
            "total_media": 20,
            "total_storage_bytes": 1234,
            "pending_tagging": 1,
            "failed_tagging": 2,
            "trashed_media": 3,
            "storage_by_user": [
                {
                    "user_id": str(uuid.uuid4()),
                    "username": "alice",
                    "media_count": 4,
                    "storage_used_bytes": 1024,
                }
            ],
        }
    monkeypatch.setattr(AdminService, 'get_admin_stats', _fake_stats)
    response = api_client.get('/api/v1/admin/stats')
    assert response.status_code == 200

def test_admin_retag_contract(api_client, monkeypatch):

    async def _fake_retag(self):
        return 9
    monkeypatch.setattr(AdminService, 'retag_all_media', _fake_retag)
    response = api_client.post('/api/v1/admin/tagging-jobs')
    assert response.status_code == 202
    assert response.json() == {'queued': 9}

def test_admin_embedding_backfill_start_contract(api_client, monkeypatch):
    batch_id = uuid.uuid4()

    async def _fake_start(self):
        return {'batch_id': batch_id, 'queued': 12, 'already_current': 3}
    monkeypatch.setattr(AdminService, 'start_embedding_backfill', _fake_start)
    response = api_client.post('/api/v1/admin/embedding-backfill')
    assert response.status_code == 202
    assert response.json() == {'batch_id': str(batch_id), 'queued': 12, 'already_current': 3}

def test_admin_embedding_backfill_status_contract(api_client, monkeypatch):
    batch_id = uuid.uuid4()
    user_id = uuid.uuid4()
    now = datetime.now(timezone.utc).isoformat()

    async def _fake_status(self, requested_batch_id):
        assert requested_batch_id == batch_id
        return {
            "batch_id": batch_id,
            "user_id": user_id,
            "status": "running",
            "total_items": 12,
            "queued_items": 8,
            "processing_items": 1,
            "done_items": 3,
            "failed_items": 0,
            "started_at": now,
            "finished_at": None,
            "error_summary": None,
            "recent_failed_items": [],
        }

    monkeypatch.setattr(AdminService, "get_embedding_backfill_status", _fake_status)

    response = api_client.get(f"/api/v1/admin/embedding-backfills/{batch_id}")

    assert response.status_code == 200
    assert response.json()["batch_id"] == str(batch_id)
    assert response.json()["queued_items"] == 8

def test_admin_library_classification_metrics_contract(api_client, monkeypatch):
    user_id = uuid.uuid4()

    async def _fake_metrics(self, *, model_version):
        assert model_version == 'clip_onnx_v1'
        return {'user_id': user_id, 'model_version': model_version, 'reviewed': 10, 'accepted': 8, 'rejected': 2, 'auto_applied': 4, 'acceptance_rate': 0.8, 'rejection_rate': 0.2, 'by_source': [{'source': 'prototype', 'reviewed': 6, 'accepted': 5, 'rejected': 1, 'auto_applied': 3, 'acceptance_rate': 0.8333}]}
    monkeypatch.setattr(AdminService, 'get_library_classification_metrics', _fake_metrics)
    response = api_client.get(f'/api/v1/admin/library-classification-metrics', params={'model_version': 'clip_onnx_v1'})
    assert response.status_code == 200
    assert response.json()['acceptance_rate'] == 0.8
    assert response.json()['by_source'][0]['source'] == 'prototype'

def test_admin_list_announcements_contract(api_client, monkeypatch):
    now = datetime.now(timezone.utc)

    async def _fake_list(self, offset, limit):
        return [
            SimpleNamespace(
                id=uuid.uuid4(),
                version="1.0.0",
                title="Notice",
                message="Planned maintenance",
                severity="info",
                starts_at=None,
                ends_at=None,
                is_active=True,
                created_at=now,
            )
        ]

    monkeypatch.setattr(AppAnnouncementRepository, "list_all", _fake_list)

    response = api_client.get("/api/v1/admin/announcements")

    assert response.status_code == 200
    assert response.json()[0]["title"] == "Notice"

def test_admin_create_announcement_contract(api_client):
    with patch("backend.app.routers.admin.NotificationService") as notification_service_cls:
        notification_service_cls.return_value.publish_announcement = AsyncMock(return_value=3)

        response = api_client.post(
            "/api/v1/admin/announcements",
            json={
                "version": "1.1.0",
                "title": "Upgrade",
                "message": "New backend release",
                "severity": "warning",
                "starts_at": None,
                "ends_at": None,
            },
        )

    assert response.status_code == 201
    payload = response.json()
    assert payload["title"] == "Upgrade"
    assert payload["severity"] == "warning"
    notification_service_cls.return_value.publish_announcement.assert_awaited_once()

def test_admin_app_config_contract(api_client):
    response = api_client.get("/api/v1/admin/app-config")

    assert response.status_code == 200
    payload = response.json()
    assert payload["auth_login_rate_limit_requests"] >= 0
    assert payload["upload_rate_limit_window_seconds"] >= 0

def test_update_endpoints_removed(api_client):
    assert api_client.post("/api/v1/admin/update").status_code == 404
    assert api_client.post("/api/v1/admin/check-updates").status_code == 404


def test_unused_endpoints_removed(api_client):
    assert api_client.post("/api/v1/admin/service-notifications", json={"title": "t", "body": "b"}).status_code == 404
    assert api_client.post("/api/v1/media/annotated").status_code in {404, 405}
    assert api_client.get("/api/v1/graphs/characters").status_code == 404
    assert api_client.get("/api/v1/graphs/characters/search", params={"q": "a"}).status_code == 404

def test_admin_app_config_patch_updates_runtime_settings(api_client, monkeypatch):
    original_login_limit = settings.auth_login_rate_limit_requests
    original_upload_limit = settings.upload_rate_limit_requests
    monkeypatch.setattr(settings, "auth_login_rate_limit_requests", original_login_limit)
    monkeypatch.setattr(settings, "upload_rate_limit_requests", original_upload_limit)

    response = api_client.patch(
        "/api/v1/admin/app-config",
        json={
            "auth_login_rate_limit_requests": 0,
            "upload_rate_limit_requests": 0,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["auth_login_rate_limit_requests"] == 0
    assert payload["upload_rate_limit_requests"] == 0


def _tagger_status(**overrides):
    return {
        "active": "wd_v3",
        "status": "ready",
        "target": None,
        "error": None,
        "execution_provider": "CPUExecutionProvider",
        "options": [
            {"id": "wd_v3", "label": "WD", "description": "d", "download_size_bytes": 1},
            {"id": "pixai_v1_336_int8", "label": "PixAI", "description": "d", "download_size_bytes": 2},
        ],
        **overrides,
    }


def test_get_tagger_status(api_client):
    with patch("backend.app.routers.admin.tagger") as tagger:
        tagger.status_payload.return_value = _tagger_status()
        response = api_client.get("/api/v1/admin/tagger")

    assert response.status_code == 200
    assert response.json()["active"] == "wd_v3"
    assert [option["id"] for option in response.json()["options"]] == ["wd_v3", "pixai_v1_336_int8"]


def test_put_tagger_starts_switch(api_client):
    with patch("backend.app.routers.admin.tagger") as tagger:
        tagger.can_switch = True
        tagger.start_switch.return_value = True
        tagger.status_payload.return_value = _tagger_status(status="loading", target="pixai_v1_336_int8")
        response = api_client.put("/api/v1/admin/tagger", json={"backend": "pixai_v1_336_int8"})

    assert response.status_code == 202
    assert response.json()["target"] == "pixai_v1_336_int8"
    assert tagger.start_switch.call_args.args[0] == "pixai_v1_336_int8"


def test_put_tagger_for_active_backend_returns_ok(api_client):
    with patch("backend.app.routers.admin.tagger") as tagger:
        tagger.can_switch = True
        tagger.start_switch.return_value = False
        tagger.status_payload.return_value = _tagger_status()
        response = api_client.put("/api/v1/admin/tagger", json={"backend": "wd_v3"})

    assert response.status_code == 200


def test_put_tagger_conflicts_while_loading(api_client):
    with patch("backend.app.routers.admin.tagger") as tagger:
        tagger.can_switch = False
        response = api_client.put("/api/v1/admin/tagger", json={"backend": "pixai_v1_336_int8"})

    assert response.status_code == 409
    assert response.json()["code"] == "tagger_switch_unavailable"
    tagger.start_switch.assert_not_called()


def test_put_tagger_rejects_unknown_backend(api_client):
    response = api_client.put("/api/v1/admin/tagger", json={"backend": "nope"})

    assert response.status_code == 422


def test_switching_tagger_does_not_queue_retag(api_client):
    with patch("backend.app.routers.admin.tagger") as tagger, patch(
        "backend.app.routers.admin.AdminService"
    ) as admin_service:
        tagger.can_switch = True
        tagger.start_switch.return_value = True
        tagger.status_payload.return_value = _tagger_status(status="loading")
        api_client.put("/api/v1/admin/tagger", json={"backend": "pixai_v1_336_int8"})

    admin_service.assert_not_called()
