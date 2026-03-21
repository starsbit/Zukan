import asyncio
import io
import sys
import tempfile
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image as PILImage
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
from testcontainers.postgres import PostgresContainer

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def run(coro):
    return asyncio.run(coro)


def png_bytes(color: tuple[int, int, int]) -> bytes:
    body = io.BytesIO()
    PILImage.new("RGB", (32, 24), color=color).save(body, format="PNG")
    return body.getvalue()


def jpeg_bytes(color: tuple[int, int, int], captured_at: datetime | None = None) -> bytes:
    body = io.BytesIO()
    image = PILImage.new("RGB", (32, 24), color=color)
    if captured_at is not None:
        exif = image.getexif()
        timestamp = captured_at.astimezone(timezone.utc).strftime("%Y:%m:%d %H:%M:%S")
        exif[36867] = timestamp
        exif[36868] = timestamp
        exif[36881] = "+00:00"
        exif[36882] = "+00:00"
        image.save(body, format="JPEG", exif=exif)
    else:
        image.save(body, format="JPEG")
    return body.getvalue()


@dataclass
class ApiHarness:
    client: TestClient
    database_url: str

    def auth_headers(self, token: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {token}"}

    def basic_auth(self, username: str, password: str) -> tuple[str, str]:
        return (username, password)

    def register_and_login(
        self,
        username: str,
        *,
        email: str | None = None,
        password: str = "password123",
        remember_me: bool = False,
    ) -> dict:
        email = email or f"{username}@example.com"
        register = self.client.post("/auth/register", json={
            "username": username,
            "email": email,
            "password": password,
        })
        assert register.status_code == 201, register.text

        login = self.client.post("/auth/login", json={
            "username": username,
            "password": password,
            "remember_me": remember_me,
        })
        assert login.status_code == 200, login.text
        tokens = login.json()
        return {
            "user": register.json(),
            "access_token": tokens["access_token"],
            "refresh_token": tokens["refresh_token"],
            "password": password,
            "remember_me": remember_me,
        }

    def upload_image(self, token: str, filename: str, color: tuple[int, int, int]) -> dict:
        return self.upload_image_bytes(token, filename, png_bytes(color), "image/png")

    def upload_image_bytes(self, token: str, filename: str, content: bytes, content_type: str) -> dict:
        response = self.client.post(
            "/images",
            headers=self.auth_headers(token),
            files=[("files", (filename, content, content_type))],
        )
        assert response.status_code == 202, response.text
        payload = response.json()
        assert payload["accepted"] == 1
        return payload["results"][0]

    def wait_for_image_status(self, image_id: str, expected: str = "done", timeout: float = 5.0):
        deadline = time.time() + timeout
        while time.time() < deadline:
            image = self.fetch_image_row(uuid.UUID(image_id))
            if image is not None and image.tagging_status == expected:
                return image
            time.sleep(0.05)
        raise AssertionError(f"Timed out waiting for image {image_id} to reach status {expected}")

    def run_db(self, fn):
        async def _inner():
            engine = create_async_engine(self.database_url, poolclass=NullPool)
            session_maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
            try:
                async with session_maker() as session:
                    return await fn(session)
            finally:
                await engine.dispose()

        return run(_inner())

    def fetch_image_row(self, image_id: uuid.UUID):
        from app.models import Image

        async def _fetch(session: AsyncSession):
            return await session.get(Image, image_id)

        return self.run_db(_fetch)

    def set_image_created_at(self, image_id: str, created_at: datetime):
        from app.models import Image

        async def _update(session: AsyncSession):
            image = await session.get(Image, uuid.UUID(image_id))
            image.created_at = created_at
            await session.commit()

        self.run_db(_update)

    def set_image_captured_at(self, image_id: str, captured_at: datetime):
        from app.models import Image

        async def _update(session: AsyncSession):
            image = await session.get(Image, uuid.UUID(image_id))
            image.captured_at = captured_at
            await session.commit()

        self.run_db(_update)


@pytest.fixture
def api():
    tmpdir = tempfile.TemporaryDirectory()
    storage_dir = Path(tmpdir.name) / "storage"
    storage_dir.mkdir(parents=True, exist_ok=True)
    container = PostgresContainer(
        image="postgres:16-alpine",
        username="zukan",
        password="zukan",
        dbname="zukan",
        driver="asyncpg",
    )
    container.start()
    database_url = container.get_connection_url().replace("localhost", "127.0.0.1")

    from app.config import settings
    import app.database as database_module
    import app.main as main_module
    import app.services.tagger as tagger_module
    from app.services.tagger import TagPrediction, TaggingResult

    original_database_url = settings.database_url
    original_storage_dir = settings.storage_dir
    original_model_cache_dir = settings.model_cache_dir
    original_engine = database_module.engine
    original_sessionmaker = database_module.AsyncSessionLocal
    original_main_sessionmaker = main_module.AsyncSessionLocal
    original_tag_queue = main_module.tag_queue
    original_tagger_load = tagger_module.tagger.load
    original_tagger_predict = tagger_module.tagger.predict

    async def fake_predict(image_path: str):
        with PILImage.open(image_path) as img:
            r, g, b = img.convert("RGB").getpixel((0, 0))

        if r > 200 and g < 120 and b < 120:
            return TaggingResult(
                predictions=[
                    TagPrediction(name="rose", category=0, confidence=0.97),
                    TagPrediction(name="warm", category=0, confidence=0.88),
                    TagPrediction(name="rating:questionable", category=9, confidence=0.99),
                ],
                character_name=None,
                is_nsfw=True,
            )
        if b > 200:
            return TaggingResult(
                predictions=[
                    TagPrediction(name="ayanami_rei", category=4, confidence=0.98),
                    TagPrediction(name="sky", category=0, confidence=0.96),
                    TagPrediction(name="blue", category=0, confidence=0.9),
                    TagPrediction(name="rating:general", category=9, confidence=0.99),
                ],
                character_name="ayanami_rei",
                is_nsfw=False,
            )
        return TaggingResult(
            predictions=[
                TagPrediction(name="forest", category=0, confidence=0.95),
                TagPrediction(name="green", category=0, confidence=0.87),
                TagPrediction(name="rating:general", category=9, confidence=0.99),
            ],
            character_name=None,
            is_nsfw=False,
        )

    settings.database_url = database_url
    settings.storage_dir = storage_dir
    settings.model_cache_dir = Path(tmpdir.name) / "model_cache"
    settings.model_cache_dir.mkdir(parents=True, exist_ok=True)

    test_engine = create_async_engine(database_url, echo=False, poolclass=NullPool)
    test_session_maker = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)

    database_module.engine = test_engine
    database_module.AsyncSessionLocal = test_session_maker
    main_module.AsyncSessionLocal = test_session_maker
    main_module.tag_queue = asyncio.Queue()
    tagger_module.tagger.load = lambda: None
    tagger_module.tagger.predict = fake_predict

    try:
        with TestClient(main_module.app) as client:
            yield ApiHarness(client=client, database_url=database_url)
    finally:
        run(test_engine.dispose())
        database_module.engine = original_engine
        database_module.AsyncSessionLocal = original_sessionmaker
        main_module.AsyncSessionLocal = original_main_sessionmaker
        main_module.tag_queue = original_tag_queue
        settings.database_url = original_database_url
        settings.storage_dir = original_storage_dir
        settings.model_cache_dir = original_model_cache_dir
        tagger_module.tagger.load = original_tagger_load
        tagger_module.tagger.predict = original_tagger_predict
        container.stop()
        tmpdir.cleanup()
