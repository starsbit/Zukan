from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.testclient import TestClient

from shiori.app.models import ConfigRead, ConfigUpdate, HealthResponse, StatusResponse, SyncTriggerResponse


class _FakeService:
    def __init__(self) -> None:
        self.running = False

    async def get_health(self) -> HealthResponse:
        return HealthResponse(
            ok=True,
            configured=True,
            state="idle",
            zukan_ok=True,
            twitter_ok=True,
            sync_running=self.running,
            issues=[],
        )

    def get_status(self) -> StatusResponse:
        return StatusResponse(configured=True, state="idle", sync_running=self.running, issues=[])

    def get_config(self) -> ConfigRead:
        return ConfigRead(
            zukan_base_url="http://api:8000",
            twitter_user_id="123",
            sync_interval_seconds=900,
            default_visibility="private",
            default_tags=["twitter"],
            has_zukan_token=True,
            has_twitter_auth_token=True,
            has_twitter_ct0=False,
        )

    def update_config(self, _: ConfigUpdate) -> ConfigRead:
        return self.get_config()

    async def trigger_sync(self) -> SyncTriggerResponse:
        if self.running:
            return SyncTriggerResponse(started=False, state="running", detail="A sync is already running")
        self.running = True
        return SyncTriggerResponse(started=True, state="running", detail="Sync started")


def _build_test_app() -> TestClient:
    fake = _FakeService()

    @asynccontextmanager
    async def _lifespan(_: FastAPI):
        yield

    app = FastAPI(lifespan=_lifespan)

    @app.get("/health")
    async def health():
        return await fake.get_health()

    @app.get("/status")
    async def status_view():
        return fake.get_status()

    @app.get("/config")
    async def config_view():
        return fake.get_config()

    @app.patch("/config")
    async def update_config():
        return fake.get_config()

    @app.post("/sync")
    async def sync():
        response = await fake.trigger_sync()
        if not response.started:
            from fastapi import HTTPException
            raise HTTPException(status_code=409, detail=response.model_dump())
        return response

    return TestClient(app)


def test_status_endpoint_contract():
    with _build_test_app() as client:
        response = client.get("/status")
        assert response.status_code == 200
        assert response.json()["state"] == "idle"


def test_sync_endpoint_rejects_concurrent_runs():
    with _build_test_app() as client:
        first = client.post("/sync")
        second = client.post("/sync")
        assert first.status_code == 200
        assert second.status_code == 409
        assert second.json()["detail"]["state"] == "running"


def test_config_endpoint_contract():
    with _build_test_app() as client:
        response = client.get("/config")
        assert response.status_code == 200
        assert response.json()["has_zukan_token"] is True
