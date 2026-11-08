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
    distance: float = 0.0


ACCESSIBLE_NEIGHBOR_PAGE_SQL = """
WITH target AS (
    SELECT embedding
    FROM media_embeddings
    WHERE media_id = :media_id
      AND model_version = :model_version
),
ranked AS (
    SELECT
        neighbors.media_id AS media_id,
        neighbors.embedding <=> target.embedding AS distance
    FROM target
    JOIN media_embeddings AS neighbors
      ON neighbors.model_version = :model_version
     AND neighbors.media_id != :media_id
    JOIN media AS candidate
      ON candidate.id = neighbors.media_id
    WHERE candidate.deleted_at IS NULL
      AND (
        :show_nsfw
        OR COALESCE(candidate.is_nsfw_override, candidate.is_nsfw) IS FALSE
      )
      AND (
        :show_sensitive
        OR COALESCE(candidate.is_sensitive_override, candidate.is_sensitive) IS FALSE
      )
)
SELECT media_id, distance
FROM ranked
WHERE CAST(:after_distance AS double precision) IS NULL
   OR (distance, media_id) > (CAST(:after_distance AS double precision), CAST(:after_id AS uuid))
ORDER BY distance, media_id
LIMIT :limit
"""


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
        return await self.accessible_neighbor_page(
            media_id=media_id,
            user=user,
            limit=limit,
            model_version=model_version,
        )

    async def accessible_neighbor_page(
        self,
        *,
        media_id: uuid.UUID,
        user: User,
        limit: int,
        model_version: str,
        after: tuple[float, uuid.UUID] | None = None,
    ) -> list[MediaNeighbor]:
        rows = (
            (
                await self._db.execute(
                    text(ACCESSIBLE_NEIGHBOR_PAGE_SQL),
                    {
                        "media_id": media_id,
                        "show_nsfw": bool(user.show_nsfw),
                        "show_sensitive": bool(user.show_sensitive),
                        "limit": limit,
                        "model_version": model_version,
                        "after_distance": after[0] if after else None,
                        "after_id": after[1] if after else None,
                    },
                )
            )
            .mappings()
            .all()
        )
        return [
            MediaNeighbor(
                media_id=row["media_id"],
                similarity=1 - float(row["distance"] or 0.0),
                distance=float(row["distance"] or 0.0),
            )
            for row in rows
        ]
