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
        self, *, media_ids: list[uuid.UUID], model_version: str
    ) -> dict[uuid.UUID, MediaEmbedding]:
        if not media_ids:
            return {}
        rows = (
            (
                await self._db.execute(
                    select(MediaEmbedding).where(
                        MediaEmbedding.media_id.in_(media_ids),
                        MediaEmbedding.model_version == model_version,
                    )
                )
            )
            .scalars()
            .all()
        )
        return {row.media_id: row for row in rows}

    async def upsert(
        self, *, media_id: uuid.UUID, embedding: list[float], model_version: str
    ) -> None:
        await self._db.execute(
            text(
                "\n                INSERT INTO media_embeddings (media_id, embedding, model_version)\n                VALUES (:media_id, CAST(:embedding AS vector), :model_version)\n                ON CONFLICT (media_id) DO UPDATE SET\n                    embedding = EXCLUDED.embedding,\n                    model_version = EXCLUDED.model_version,\n                    updated_at = now()\n                "
            ),
            {
                "media_id": media_id,
                "embedding": _vector_literal(embedding),
                "model_version": model_version,
            },
        )

    async def nearest_neighbors(
        self,
        *,
        media_id: uuid.UUID,
        embedding: list[float],
        limit: int,
        model_version: str | None = None,
    ) -> list[MediaNeighbor]:
        model_filter = (
            "AND model_version = :model_version" if model_version is not None else ""
        )
        rows = (
            (
                await self._db.execute(
                    text(
                        f"\n                    SELECT media_id, 1 - (embedding <=> CAST(:embedding AS vector)) AS similarity\n                    FROM media_embeddings\n                    WHERE media_id != :media_id\n                      {model_filter}\n                    ORDER BY embedding <=> CAST(:embedding AS vector)\n                    LIMIT :limit\n                    "
                    ),
                    {
                        "media_id": media_id,
                        "embedding": _vector_literal(embedding),
                        "limit": limit,
                        "model_version": model_version,
                    },
                )
            )
            .mappings()
            .all()
        )
        return [
            MediaNeighbor(
                media_id=row["media_id"], similarity=float(row["similarity"] or 0.0)
            )
            for row in rows
        ]

    async def nearest_neighbors_for_media_ids(
        self,
        *,
        media_ids: list[uuid.UUID],
        limit: int,
        model_version: str,
        exclude_media_ids: list[uuid.UUID] | None = None,
    ) -> dict[uuid.UUID, list[MediaNeighbor]]:
        if not media_ids:
            return {}
        excluded = exclude_media_ids or media_ids
        rows = (
            (
                await self._db.execute(
                    text(
                        "\n                    WITH targets AS (\n                        SELECT media_id AS target_media_id, embedding\n                        FROM media_embeddings\n                        WHERE model_version = :model_version\n                          AND media_id = ANY(CAST(:media_ids AS uuid[]))\n                    )\n                    SELECT\n                        targets.target_media_id AS target_media_id,\n                        neighbors.media_id AS media_id,\n                        1 - (neighbors.embedding <=> targets.embedding) AS similarity\n                    FROM targets\n                    CROSS JOIN LATERAL (\n                        SELECT media_id, embedding\n                        FROM media_embeddings\n                        WHERE model_version = :model_version\n                          AND media_id != ALL(CAST(:excluded_media_ids AS uuid[]))\n                        ORDER BY embedding <=> targets.embedding\n                        LIMIT :limit\n                    ) AS neighbors\n                    "
                    ),
                    {
                        "media_ids": media_ids,
                        "limit": limit,
                        "model_version": model_version,
                        "excluded_media_ids": excluded,
                    },
                )
            )
            .mappings()
            .all()
        )
        grouped: dict[uuid.UUID, list[MediaNeighbor]] = {
            media_id: [] for media_id in media_ids
        }
        for row in rows:
            target_media_id = row["target_media_id"]
            grouped.setdefault(target_media_id, []).append(
                MediaNeighbor(
                    media_id=row["media_id"], similarity=float(row["similarity"] or 0.0)
                )
            )
        return grouped

    async def nearest_accessible_neighbors(
        self, *, media_id: uuid.UUID, user: User, limit: int, model_version: str
    ) -> list[MediaNeighbor]:
        rows = (
            (
                await self._db.execute(
                    text(
                        "\n                    WITH target AS (\n                        SELECT embedding\n                        FROM media_embeddings\n                        WHERE media_id = :media_id\n                          AND model_version = :model_version\n                    )\n                    SELECT\n                        neighbors.media_id AS media_id,\n                        1 - (neighbors.embedding <=> target.embedding) AS similarity\n                    FROM target\n                    JOIN media_embeddings AS neighbors\n                      ON neighbors.model_version = :model_version\n                     AND neighbors.media_id != :media_id\n                    JOIN media AS candidate\n                      ON candidate.id = neighbors.media_id\n                    WHERE candidate.deleted_at IS NULL\n                      AND (\n                        :show_nsfw\n                        OR COALESCE(candidate.is_nsfw_override, candidate.is_nsfw) IS FALSE\n                      )\n                      AND (\n                        :show_sensitive\n                        OR COALESCE(candidate.is_sensitive_override, candidate.is_sensitive) IS FALSE\n                      )\n                    ORDER BY neighbors.embedding <=> target.embedding\n                    LIMIT :limit\n                    "
                    ),
                    {
                        "media_id": media_id,
                        "show_nsfw": bool(user.show_nsfw),
                        "show_sensitive": bool(user.show_sensitive),
                        "limit": limit,
                        "model_version": model_version,
                    },
                )
            )
            .mappings()
            .all()
        )
        return [
            MediaNeighbor(
                media_id=row["media_id"], similarity=float(row["similarity"] or 0.0)
            )
            for row in rows
        ]
