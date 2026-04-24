from __future__ import annotations

import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.ml.embedding import EMBEDDING_MODEL_VERSION, EmbeddingBackend, embedding_backend
from backend.app.models.embeddings import MediaEmbedding
from backend.app.models.media import Media, TaggingStatus
from backend.app.repositories.embeddings import MediaEmbeddingRepository

logger = logging.getLogger(__name__)


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

        existing = await self._repo.get_by_media_id(media.id)
        if existing is not None and existing.model_version == EMBEDDING_MODEL_VERSION and not force:
            return existing

        embedding = await self._backend.compute(media.filepath, media.media_type)
        if not embedding:
            logger.warning("Embedding compute returned empty media_id=%s", getattr(media, "id", None))
            return existing

        await self._repo.upsert(
            media_id=media.id,
            uploader_id=media.uploader_id,
            embedding=embedding,
            model_version=EMBEDDING_MODEL_VERSION,
        )
        await self._db.flush()
        return await self._repo.get_by_media_id(media.id)

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
                MediaEmbedding.media_id.is_(None),
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
