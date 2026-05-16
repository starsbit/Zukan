from __future__ import annotations

from dataclasses import dataclass
import uuid

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models.auth import User
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

    async def get_current_by_media_ids(
        self,
        *,
        media_ids: list[uuid.UUID],
        uploader_id: uuid.UUID,
        model_version: str,
    ) -> dict[uuid.UUID, MediaEmbedding]:
        if not media_ids:
            return {}
        rows = (
            await self._db.execute(
                select(MediaEmbedding).where(
                    MediaEmbedding.media_id.in_(media_ids),
                    MediaEmbedding.uploader_id == uploader_id,
                    MediaEmbedding.model_version == model_version,
                )
            )
        ).scalars().all()
        return {row.media_id: row for row in rows}

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
        model_version: str | None = None,
    ) -> list[MediaNeighbor]:
        model_filter = "AND model_version = :model_version" if model_version is not None else ""
        rows = (
            await self._db.execute(
                text(
                    f"""
                    SELECT media_id, 1 - (embedding <=> CAST(:embedding AS vector)) AS similarity
                    FROM media_embeddings
                    WHERE uploader_id = :uploader_id
                      AND media_id != :media_id
                      {model_filter}
                    ORDER BY embedding <=> CAST(:embedding AS vector)
                    LIMIT :limit
                    """
                ),
                {
                    "media_id": media_id,
                    "uploader_id": uploader_id,
                    "embedding": _vector_literal(embedding),
                    "limit": limit,
                    "model_version": model_version,
                },
            )
        ).mappings().all()
        return [
            MediaNeighbor(media_id=row["media_id"], similarity=float(row["similarity"] or 0.0))
            for row in rows
        ]

    async def nearest_neighbors_for_media_ids(
        self,
        *,
        media_ids: list[uuid.UUID],
        uploader_id: uuid.UUID,
        limit: int,
        model_version: str,
        exclude_media_ids: list[uuid.UUID] | None = None,
    ) -> dict[uuid.UUID, list[MediaNeighbor]]:
        if not media_ids:
            return {}
        excluded = exclude_media_ids or media_ids
        rows = (
            await self._db.execute(
                text(
                    """
                    WITH targets AS (
                        SELECT media_id AS target_media_id, embedding
                        FROM media_embeddings
                        WHERE uploader_id = :uploader_id
                          AND model_version = :model_version
                          AND media_id = ANY(CAST(:media_ids AS uuid[]))
                    )
                    SELECT
                        targets.target_media_id AS target_media_id,
                        neighbors.media_id AS media_id,
                        1 - (neighbors.embedding <=> targets.embedding) AS similarity
                    FROM targets
                    CROSS JOIN LATERAL (
                        SELECT media_id, embedding
                        FROM media_embeddings
                        WHERE uploader_id = :uploader_id
                          AND model_version = :model_version
                          AND media_id != ALL(CAST(:excluded_media_ids AS uuid[]))
                        ORDER BY embedding <=> targets.embedding
                        LIMIT :limit
                    ) AS neighbors
                    """
                ),
                {
                    "media_ids": media_ids,
                    "uploader_id": uploader_id,
                    "limit": limit,
                    "model_version": model_version,
                    "excluded_media_ids": excluded,
                },
            )
        ).mappings().all()

        grouped: dict[uuid.UUID, list[MediaNeighbor]] = {media_id: [] for media_id in media_ids}
        for row in rows:
            target_media_id = row["target_media_id"]
            grouped.setdefault(target_media_id, []).append(
                MediaNeighbor(media_id=row["media_id"], similarity=float(row["similarity"] or 0.0))
            )
        return grouped

    async def nearest_accessible_neighbors(
        self,
        *,
        media_id: uuid.UUID,
        user: User,
        limit: int,
        model_version: str,
    ) -> list[MediaNeighbor]:
        rows = (
            await self._db.execute(
                text(
                    """
                    WITH target AS (
                        SELECT embedding
                        FROM media_embeddings
                        WHERE media_id = :media_id
                          AND model_version = :model_version
                    )
                    SELECT
                        neighbors.media_id AS media_id,
                        1 - (neighbors.embedding <=> target.embedding) AS similarity
                    FROM target
                    JOIN media_embeddings AS neighbors
                      ON neighbors.model_version = :model_version
                     AND neighbors.media_id != :media_id
                    JOIN media AS candidate
                      ON candidate.id = neighbors.media_id
                    WHERE candidate.deleted_at IS NULL
                      AND (
                        :is_admin
                        OR candidate.uploader_id = :user_id
                        OR candidate.owner_id = :user_id
                        OR (
                          candidate.visibility = 'public'
                          AND candidate.tagging_status::text NOT IN ('PENDING', 'PROCESSING')
                          AND candidate.thumbnail_status::text NOT IN ('PENDING', 'PROCESSING')
                          AND candidate.poster_status::text NOT IN ('PENDING', 'PROCESSING')
                        )
                        OR (
                          EXISTS (
                            SELECT 1
                            FROM album_media AS album_item
                            JOIN albums AS album ON album.id = album_item.album_id
                            LEFT JOIN album_shares AS album_share
                              ON album_share.album_id = album.id
                             AND album_share.user_id = :user_id
                            WHERE album_item.media_id = candidate.id
                              AND (
                                album.owner_id = :user_id
                                OR album_share.user_id = :user_id
                              )
                          )
                          AND candidate.tagging_status::text NOT IN ('PENDING', 'PROCESSING')
                          AND candidate.thumbnail_status::text NOT IN ('PENDING', 'PROCESSING')
                          AND candidate.poster_status::text NOT IN ('PENDING', 'PROCESSING')
                        )
                      )
                      AND (
                        :is_admin
                        OR :show_nsfw
                        OR COALESCE(candidate.is_nsfw_override, candidate.is_nsfw) IS FALSE
                      )
                      AND (
                        :is_admin
                        OR :show_sensitive
                        OR COALESCE(candidate.is_sensitive_override, candidate.is_sensitive) IS FALSE
                      )
                    ORDER BY neighbors.embedding <=> target.embedding
                    LIMIT :limit
                    """
                ),
                {
                    "media_id": media_id,
                    "user_id": user.id,
                    "is_admin": bool(user.is_admin),
                    "show_nsfw": bool(user.show_nsfw),
                    "show_sensitive": bool(user.show_sensitive),
                    "limit": limit,
                    "model_version": model_version,
                },
            )
        ).mappings().all()
        return [
            MediaNeighbor(media_id=row["media_id"], similarity=float(row["similarity"] or 0.0))
            for row in rows
        ]
