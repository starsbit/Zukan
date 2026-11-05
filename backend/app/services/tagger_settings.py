from __future__ import annotations

from backend.app.database import AsyncSessionLocal
from backend.app.models.app_settings import AppSettings
from backend.app.utils.tagging import TaggerBackendName

APP_SETTINGS_ID = 1


async def load_saved_tagger_backend() -> str | None:
    async with AsyncSessionLocal() as db:
        row = await db.get(AppSettings, APP_SETTINGS_ID)
        if row is None or row.tagger_backend is None:
            return None
        return row.tagger_backend.value


async def save_tagger_backend(backend: str) -> None:
    async with AsyncSessionLocal() as db:
        row = await db.get(AppSettings, APP_SETTINGS_ID)
        if row is None:
            row = AppSettings(id=APP_SETTINGS_ID)
            db.add(row)
        row.tagger_backend = TaggerBackendName(backend)
        await db.commit()
