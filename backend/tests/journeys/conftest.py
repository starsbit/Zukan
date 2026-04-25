from __future__ import annotations

import io
from pathlib import Path
import uuid

import pytest
import pytest_asyncio
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from httpx import ASGITransport, AsyncClient
from PIL import Image
from sqlalchemy import delete, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from testcontainers.postgres import PostgresContainer

from backend.app.database import get_db
from backend.app.database.base import Base
from backend.app.errors.error import AppError
from backend.app.main import app_error_handler, http_exception_handler, request_validation_error_handler, v1_router
from backend.app.models.albums import Album, AlbumMedia, AlbumShare
from backend.app.models.auth import RefreshToken, User
from backend.app.models.embeddings import MediaEmbedding
from backend.app.models.library_classification import LibraryClassificationFeedback
from backend.app.models.media import Media
from backend.app.models.media_interactions import UserFavorite
from backend.app.models.notifications import AppAnnouncement, Notification
from backend.app.models.processing import ImportBatch, ImportBatchItem
from backend.app.models.relations import MediaEntity, MediaExternalRef
from backend.app.models.tags import MediaTag, Tag
from backend.app.utils.rate_limit import rate_limit_store


def _to_async_url(url: str) -> str:
    if url.startswith("postgresql+psycopg2://"):
        return url.replace("postgresql+psycopg2://", "postgresql+asyncpg://", 1)
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


@pytest.fixture(scope="session")
def postgres_async_url() -> str:
    try:
        container = PostgresContainer("pgvector/pgvector:pg16")
        container.start()
    except Exception as exc:  # pragma: no cover
        pytest.skip(f"Docker/Testcontainers unavailable: {exc}")
    try:
        yield _to_async_url(container.get_connection_url())
    finally:
        container.stop()


@pytest_asyncio.fixture()
async def db_engine(postgres_async_url: str):
    engine = create_async_engine(postgres_async_url)
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.run_sync(Base.metadata.create_all)
    try:
        yield engine
    finally:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
        await engine.dispose()


@pytest_asyncio.fixture()
async def db_sessionmaker(db_engine):
    maker = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)

    async with maker() as session:
        for model in (
            UserFavorite,
            ImportBatchItem,
            ImportBatch,
            MediaExternalRef,
            MediaEntity,
            MediaEmbedding,
            MediaTag,
            Tag,
            AlbumMedia,
            AlbumShare,
            Album,
            Notification,
            AppAnnouncement,
            Media,
            RefreshToken,
            User,
        ):
            await session.execute(delete(model))
        await session.commit()

    return maker


@pytest_asyncio.fixture()
async def journey_client(db_sessionmaker, tmp_path, monkeypatch):
    await rate_limit_store.reset()
    app = FastAPI()
    app.include_router(v1_router)
    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(RequestValidationError, request_validation_error_handler)
    app.add_exception_handler(HTTPException, http_exception_handler)

    storage_dir = tmp_path / "storage"
    storage_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr("backend.app.config.settings.storage_dir", storage_dir)

    async def _db_override():
        async with db_sessionmaker() as session:
            yield session

    app.dependency_overrides[get_db] = _db_override

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


@pytest_asyncio.fixture()
async def db_session(db_sessionmaker):
    async with db_sessionmaker() as session:
        yield session


def image_file_tuple(filename: str = "sample.png"):
    img = Image.new("RGB", (16, 16), color="red")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return (filename, buf.read(), "image/png")


def unique_email(prefix: str = "user") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}@example.com"
