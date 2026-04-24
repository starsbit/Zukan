from __future__ import annotations

from dataclasses import dataclass
import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models.embeddings import MediaEmbedding
from backend.app.database.vector import _vector_literal


@dataclass(frozen=True)
class MediaNeighbor:
    media_id: uuid.UUID
    similarity: float


class MediaEmbeddingRepository:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def get_by_media_id(self, media_id: uuid.UUID) -> MediaEmbedding | None:
        return await self._db.get(MediaEmbedding, media_id)

    async def upsert(
        self,
        *,
        media_id: uuid.UUID,
        uploader_id: uuid.UUID,
        embedding: list[float],
        model_version: str,
    ) -> None:
        await self._db.execute(
            text(
                """
                INSERT INTO media_embeddings (media_id, uploader_id, embedding, model_version)
                VALUES (:media_id, :uploader_id, CAST(:embedding AS vector), :model_version)
                ON CONFLICT (media_id) DO UPDATE SET
                    uploader_id = EXCLUDED.uploader_id,
                    embedding = EXCLUDED.embedding,
                    model_version = EXCLUDED.model_version,
                    updated_at = now()
                """
            ),
            {
                "media_id": media_id,
                "uploader_id": uploader_id,
                "embedding": _vector_literal(embedding),
                "model_version": model_version,
            },
        )

    async def nearest_neighbors(
        self,
        *,
        media_id: uuid.UUID,
        uploader_id: uuid.UUID,
        embedding: list[float],
        limit: int,
    ) -> list[MediaNeighbor]:
        rows = (
            await self._db.execute(
                text(
                    """
                    SELECT media_id, 1 - (embedding <=> CAST(:embedding AS vector)) AS similarity
                    FROM media_embeddings
                    WHERE uploader_id = :uploader_id
                      AND media_id != :media_id
                    ORDER BY embedding <=> CAST(:embedding AS vector)
                    LIMIT :limit
                    """
                ),
                {
                    "media_id": media_id,
                    "uploader_id": uploader_id,
                    "embedding": _vector_literal(embedding),
                    "limit": limit,
                },
            )
        ).mappings().all()
        return [
            MediaNeighbor(media_id=row["media_id"], similarity=float(row["similarity"] or 0.0))
            for row in rows
        ]
