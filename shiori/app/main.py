from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, status
from fastapi.responses import JSONResponse

from shiori.app.config import settings
from shiori.app.models import ConfigRead, ConfigUpdate, HealthResponse, StatusResponse, SyncTriggerResponse
from shiori.app.service import SyncService
from shiori.app.state import StateStore
from shiori.app.twitter_client import TwitterClient
from shiori.app.zukan_client import ZukanClient

logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))

service: SyncService | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global service
    store = StateStore(settings.state_db_path)
    twitter_client = TwitterClient(settings)
    zukan_client = ZukanClient(settings)
    service = SyncService(settings, store, twitter_client, zukan_client)
    await service.start()
    try:
        yield
    finally:
        await service.stop()
        service = None


app = FastAPI(
    title="Shiori",
    version="0.1.0",
    description=(
        "Optional standalone companion service for syncing liked tweets into Zukan. "
        "Use Swagger UI or ReDoc as the management surface to inspect readiness, "
        "update stored config, and trigger manual sync runs."
    ),
    lifespan=lifespan,
)


def _service() -> SyncService:
    if service is None:
        raise RuntimeError("Service is not initialized")
    return service


@app.get(
    "/health",
    response_model=HealthResponse,
    summary="Get health",
    description="Return Shiori readiness, current issues, and connectivity checks for Zukan and Twitter/X.",
)
async def health() -> HealthResponse:
    current = await _service().get_health()
    if not current.ok:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content=current.model_dump(),
        )
    return current


@app.get(
    "/status",
    response_model=StatusResponse,
    summary="Get status",
    description="Return operational state, latest sync counters, timestamps, and the last recorded error.",
)
async def status_view() -> StatusResponse:
    return _service().get_status()


@app.get(
    "/config",
    response_model=ConfigRead,
    summary="Get stored config",
    description="Return Shiori configuration values that are safe to read, plus presence flags for stored secrets.",
)
async def get_config() -> ConfigRead:
    return _service().get_config()


@app.patch(
    "/config",
    response_model=ConfigRead,
    summary="Update stored config",
    description=(
        "Persist Shiori configuration in SQLite. Secret fields are write-only; "
        "send a string to set them or explicit null to clear them."
    ),
)
async def update_config(body: ConfigUpdate) -> ConfigRead:
    return _service().update_config(body)


@app.post(
    "/sync",
    response_model=SyncTriggerResponse,
    summary="Trigger sync",
    description="Start a manual sync run if Shiori is configured and no sync is currently active.",
)
async def trigger_sync() -> SyncTriggerResponse:
    response = await _service().trigger_sync()
    if not response.started:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=response.model_dump())
    return response
