from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any

from sqlalchemy import or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.ml.embedding import EMBEDDING_MODEL_VERSION, EmbeddingBackend, embedding_backend
from backend.app.models.embeddings import MediaEmbedding
from backend.app.models.media import Media, TaggingStatus
from backend.app.repositories.embeddings import MediaEmbeddingRepository

logger = logging.getLogger(__name__)

_EMBEDDING_DB_RETRY_ATTEMPTS = 3
_EMBEDDING_DB_RETRY_BACKOFF_SECONDS = 0.2
_RETRYABLE_DB_ERROR_NAMES = {
    "DeadlockDetectedError",
    "LockNotAvailableError",
    "SerializationError",
}
_RETRYABLE_DB_SQLSTATES = {
    "40P01",  # deadlock_detected
    "40001",  # serialization_failure
    "55P03",  # lock_not_available
}


class MediaEmbeddingService:
    def __init__(
        self,
        db: AsyncSession,
        *,
        backend: EmbeddingBackend | None = None,
    ) -> None:
        self._db = db
        self._backend = backend or embedding_backend
        self._repo = MediaEmbeddingRepository(db)

    async def ensure_media_embedding(self, media_id: uuid.UUID, *, force: bool = False) -> MediaEmbedding | None:
        media = await self._db.get(Media, media_id)
        return await self.ensure_for_media(media, force=force)

    async def ensure_for_media(self, media: Media | None, *, force: bool = False) -> MediaEmbedding | None:
        if media is None or media.deleted_at is not None or media.uploader_id is None:
            return None

        media_id = media.id
        uploader_id = media.uploader_id
        filepath = media.filepath
        media_type = media.media_type

        for attempt in range(1, _EMBEDDING_DB_RETRY_ATTEMPTS + 1):
            try:
                return await self._ensure_for_media_values(
                    media_id=media_id,
                    uploader_id=uploader_id,
                    filepath=filepath,
                    media_type=media_type,
                    force=force,
                )
            except Exception as exc:
                if not _is_retryable_db_error(exc) or attempt >= _EMBEDDING_DB_RETRY_ATTEMPTS:
                    raise
                await self._db.rollback()
                logger.warning(
                    "Embedding write retrying after transient database error "
                    "media_id=%s attempt=%s max_attempts=%s error_type=%s error=%s",
                    media_id,
                    attempt,
                    _EMBEDDING_DB_RETRY_ATTEMPTS,
                    exc.__class__.__name__,
                    exc,
                )
                await asyncio.sleep(_EMBEDDING_DB_RETRY_BACKOFF_SECONDS * attempt)
        return None

    async def _ensure_for_media_values(
        self,
        *,
        media_id: uuid.UUID,
        uploader_id: uuid.UUID,
        filepath: str,
        media_type: Any,
        force: bool,
    ) -> MediaEmbedding | None:
        existing = await self._repo.get_by_media_id(media_id)
        if existing is not None and existing.model_version == EMBEDDING_MODEL_VERSION and not force:
            return existing

        await self._acquire_uploader_embedding_lock(uploader_id)

        existing = await self._repo.get_by_media_id(media_id)
        if existing is not None and existing.model_version == EMBEDDING_MODEL_VERSION and not force:
            return existing

        embedding = await self._backend.compute(filepath, media_type)
        if not embedding:
            logger.warning("Embedding compute returned empty media_id=%s", media_id)
            return existing

        await self._repo.upsert(
            media_id=media_id,
            uploader_id=uploader_id,
            embedding=embedding,
            model_version=EMBEDDING_MODEL_VERSION,
        )
        await self._db.flush()
        return await self._repo.get_by_media_id(media_id)

    async def _acquire_uploader_embedding_lock(self, uploader_id: uuid.UUID) -> None:
        bind = self._db.get_bind() if hasattr(self._db, "get_bind") else None
        dialect_name = getattr(getattr(bind, "dialect", None), "name", None)
        if dialect_name != "postgresql":
            return
        await self._db.execute(
            text("SELECT pg_advisory_xact_lock(:lock_key)"),
            {"lock_key": _signed_lock_key(uploader_id)},
        )

    async def backfill_user_embeddings(
        self,
        *,
        uploader_id: uuid.UUID,
        exclude_media_id: uuid.UUID | None = None,
        limit: int,
    ) -> int:
        stmt = (
            select(Media)
            .outerjoin(MediaEmbedding, MediaEmbedding.media_id == Media.id)
            .where(
                Media.uploader_id == uploader_id,
                Media.deleted_at.is_(None),
                Media.tagging_status == TaggingStatus.DONE,
                or_(
                    MediaEmbedding.media_id.is_(None),
                    MediaEmbedding.model_version != EMBEDDING_MODEL_VERSION,
                ),
            )
            .order_by(Media.uploaded_at.desc(), Media.id.desc())
            .limit(limit)
        )
        if exclude_media_id is not None:
            stmt = stmt.where(Media.id != exclude_media_id)

        rows = (await self._db.execute(stmt)).scalars().all()
        created = 0
        for media in rows:
            embedding = await self.ensure_for_media(media)
            if embedding is not None:
                created += 1
        return created


def _signed_lock_key(value: uuid.UUID) -> int:
    raw = int.from_bytes(value.bytes[:8], byteorder="big", signed=False)
    return raw - (1 << 64) if raw >= (1 << 63) else raw


def _is_retryable_db_error(exc: Exception) -> bool:
    seen: set[int] = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if current.__class__.__name__ in _RETRYABLE_DB_ERROR_NAMES:
            return True
        for attr in ("sqlstate", "pgcode", "code"):
            if getattr(current, attr, None) in _RETRYABLE_DB_SQLSTATES:
                return True
        text_value = str(current)
        if any(name in text_value for name in _RETRYABLE_DB_ERROR_NAMES):
            return True
        current = (
            getattr(current, "orig", None)
            or getattr(current, "__cause__", None)
            or getattr(current, "__context__", None)
        )
    return False
