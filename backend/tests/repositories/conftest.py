from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from testcontainers.postgres import PostgresContainer

from backend.app.database.base import Base
from backend.app.models.albums import Album, AlbumMedia, AlbumShare, AlbumShareRole
from backend.app.models.auth import RefreshToken, User
from backend.app.models.media import Media, MediaType, MediaVisibility, ProcessingStatus, TaggingStatus
from backend.app.models.media_interactions import UserFavorite
from backend.app.models.notifications import AppAnnouncement, Notification, NotificationType
from backend.app.models.processing import BatchStatus, BatchType, ImportBatch, ImportBatchItem, ItemStatus
from backend.app.models.relations import MediaEntity, MediaEntityType, MediaExternalRef
from backend.app.models.tags import MediaTag, Tag


def _to_async_url(url: str) -> str:
    if url.startswith("postgresql+psycopg2://"):
        return url.replace("postgresql+psycopg2://", "postgresql+asyncpg://", 1)
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


@pytest.fixture(scope="session")
def postgres_async_url() -> str:
    try:
        container = PostgresContainer("postgres:16-alpine")
        container.start()
    except Exception as exc:  # pragma: no cover
        pytest.skip(f"Docker/Testcontainers unavailable: {exc}")
    try:
        yield _to_async_url(container.get_connection_url())
    finally:
        container.stop()


@pytest_asyncio.fixture
async def db_engine(postgres_async_url: str):
    engine = create_async_engine(postgres_async_url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    try:
        yield engine
    finally:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
        await engine.dispose()


@pytest_asyncio.fixture
async def db_session(db_engine) -> AsyncSession:
    maker = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as session:
        yield session


@pytest_asyncio.fixture
async def make_user(db_session: AsyncSession):
    async def _make_user(*, is_admin: bool = False, username: str | None = None, email: str | None = None) -> User:
        uid = uuid.uuid4()
        user = User(
            id=uid,
            username=username or f"u_{str(uid)[:8]}",
            email=email or f"{str(uid)[:8]}@example.com",
            hashed_password="hash",
            is_admin=is_admin,
            show_nsfw=False,
            tag_confidence_threshold=0.35,
            version=1,
        )
        db_session.add(user)
        await db_session.flush()
        return user

    return _make_user


@pytest_asyncio.fixture
async def make_media(db_session: AsyncSession):
    async def _make_media(
        *,
        uploader_id: uuid.UUID,
        media_type: MediaType = MediaType.IMAGE,
        deleted: bool = False,
        is_nsfw: bool = False,
        sha256: str | None = None,
        phash: str | None = None,
        tagging_status: TaggingStatus = TaggingStatus.PENDING,
        file_size: int = 1,
        visibility: MediaVisibility = MediaVisibility.private,
    ) -> Media:
        mid = uuid.uuid4()
        now = datetime.now(timezone.utc)
        media = Media(
            id=mid,
            uploader_id=uploader_id,
            owner_id=uploader_id,
            filename=f"{mid}.webp",
            original_filename=f"{mid}.webp",
            filepath=f"/tmp/{mid}.webp",
            file_size=file_size,
            sha256=sha256 or mid.hex,
            mime_type="image/webp",
            media_type=media_type,
            width=10,
            height=10,
            duration_seconds=None,
            frame_count=1,
            is_nsfw=is_nsfw,
            tagging_status=tagging_status,
            tagging_error=None,
            thumbnail_status=ProcessingStatus.DONE,
            poster_status=ProcessingStatus.NOT_APPLICABLE,
            captured_at=now,
            uploaded_at=now,
            deleted_at=now if deleted else None,
            version=1,
            phash=phash,
            visibility=visibility,
        )
        db_session.add(media)
        await db_session.flush()
        return media

    return _make_media
