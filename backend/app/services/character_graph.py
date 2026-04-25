from __future__ import annotations

from dataclasses import dataclass, field
import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.app.errors.error import AppError
from backend.app.ml.embedding import EMBEDDING_MODEL_VERSION
from backend.app.models.auth import User
from backend.app.models.embeddings import MediaEmbedding
from backend.app.models.media import Media
from backend.app.models.relations import MediaEntity, MediaEntityType, OwnedEntity
from backend.app.models.tags import MediaTag
from backend.app.schemas.graphs import (
    CharacterGraphEdge,
    CharacterGraphNode,
    CharacterGraphResponse,
    CharacterGraphSearchResult,
    GraphSeriesMode,
)
from backend.app.services.hybrid_similarity import (
    HybridScore,
    HybridSimilarityScorer,
    MediaSimilarityProfile,
    general_tag_names,
    normalized,
    series_names,
)
from backend.app.utils.media_common import normalize_manual_entity_names
from backend.app.utils.media_classification import effective_nsfw_value
from backend.app.utils.search import normalize_metadata_search, normalized_token_sequence_like_patterns

DEFAULT_CHARACTER_POOL_SIZE = 160
MAX_CHARACTER_POOL_SIZE = 360


@dataclass
class _CharacterMediaItem:
    media: Media
    embedding: list[float]
    profile: MediaSimilarityProfile


@dataclass
class _CharacterCandidate:
    id: uuid.UUID
    name: str
    media_count: int
    items: list[_CharacterMediaItem] = field(default_factory=list)
    prototype: MediaSimilarityProfile | None = None
    representative_media_ids: list[uuid.UUID] = field(default_factory=list)

    @property
    def embedding_support(self) -> int:
        return len({item.media.id for item in self.items})

    @property
    def series_names(self) -> set[str]:
        if self.prototype is None:
            return set()
        return set(self.prototype.series_names)


class CharacterGraphService:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def search_characters(
        self,
        user: User,
        *,
        q: str,
        limit: int,
    ) -> list[CharacterGraphSearchResult]:
        conditions = _metadata_name_conditions(q)
        stmt = (
            select(OwnedEntity)
            .where(
                OwnedEntity.owner_user_id == user.id,
                OwnedEntity.entity_type == MediaEntityType.character,
                OwnedEntity.media_count > 0,
            )
            .order_by(OwnedEntity.media_count.desc(), OwnedEntity.name.asc())
            .limit(limit)
        )
        if conditions:
            stmt = stmt.where(or_(*conditions))
        rows = (await self._db.execute(stmt)).scalars().all()
        return [
            CharacterGraphSearchResult(id=row.id, name=row.name, media_count=row.media_count)
            for row in rows
        ]

    async def get_character_graph(
        self,
        user: User,
        *,
        center_entity_id: uuid.UUID | None,
        center_name: str | None,
        limit: int,
        min_similarity: float,
        series_mode: GraphSeriesMode,
        sample_size: int,
    ) -> CharacterGraphResponse:
        entity_pool = await self._load_candidate_entities(
            user,
            center_entity_id=center_entity_id,
            center_name=center_name,
            limit=limit,
        )
        candidates = self._build_candidates(
            await self._load_character_rows(user, entity_ids={entity.id for entity in entity_pool}),
            sample_size=sample_size,
            include_nsfw_thumbnails=bool(user.show_nsfw),
        )
        center = self._find_center(candidates, center_entity_id=center_entity_id, center_name=center_name)
        selected = self._select_candidates(
            candidates,
            center=center,
            limit=limit,
            min_similarity=min_similarity,
            series_mode=series_mode,
        )
        edges = self._build_edges(selected, min_similarity=min_similarity, series_mode=series_mode)
        return CharacterGraphResponse(
            model_version=EMBEDDING_MODEL_VERSION,
            total_characters_considered=len(candidates),
            center_entity_id=center.id if center is not None else None,
            nodes=[
                CharacterGraphNode(
                    id=candidate.id,
                    name=candidate.name,
                    media_count=candidate.media_count,
                    embedding_support=candidate.embedding_support,
                    series_names=sorted(candidate.series_names),
                    representative_media_ids=candidate.representative_media_ids,
                )
                for candidate in selected
            ],
            edges=edges,
        )

    async def _load_candidate_entities(
        self,
        user: User,
        *,
        center_entity_id: uuid.UUID | None,
        center_name: str | None,
        limit: int,
    ) -> list[OwnedEntity]:
        pool_size = min(MAX_CHARACTER_POOL_SIZE, max(DEFAULT_CHARACTER_POOL_SIZE, limit * 4))
        center = await self._load_center_entity(
            user,
            center_entity_id=center_entity_id,
            center_name=center_name,
        )
        top_limit = max(0, pool_size - (1 if center is not None else 0))
        stmt = (
            select(OwnedEntity)
            .where(
                OwnedEntity.owner_user_id == user.id,
                OwnedEntity.entity_type == MediaEntityType.character,
                OwnedEntity.media_count > 0,
            )
            .order_by(OwnedEntity.media_count.desc(), OwnedEntity.name.asc())
            .limit(top_limit if center is not None else pool_size)
        )
        if center is not None:
            stmt = stmt.where(OwnedEntity.id != center.id)
        rows = list((await self._db.execute(stmt)).scalars().all())
        return [center, *rows] if center is not None else rows

    async def _load_center_entity(
        self,
        user: User,
        *,
        center_entity_id: uuid.UUID | None,
        center_name: str | None,
    ) -> OwnedEntity | None:
        if center_entity_id is None and not center_name:
            return None

        stmt = select(OwnedEntity).where(
            OwnedEntity.owner_user_id == user.id,
            OwnedEntity.entity_type == MediaEntityType.character,
            OwnedEntity.media_count > 0,
        )
        if center_entity_id is not None:
            stmt = stmt.where(OwnedEntity.id == center_entity_id)
        else:
            conditions = _metadata_name_conditions(center_name or "")
            if conditions:
                stmt = stmt.where(or_(*conditions))
            stmt = stmt.order_by(OwnedEntity.media_count.desc(), OwnedEntity.name.asc())

        center = (await self._db.execute(stmt.limit(1))).scalar_one_or_none()
        if center is None:
            raise AppError(status_code=404, code="character_graph_center_not_found", detail="Character not found in graph")
        return center

    async def _load_character_rows(
        self,
        user: User,
        *,
        entity_ids: set[uuid.UUID],
    ) -> list[tuple[OwnedEntity, Media, list[float]]]:
        if not entity_ids:
            return []
        stmt = (
            select(OwnedEntity, Media, MediaEmbedding.embedding)
            .join(MediaEntity, MediaEntity.entity_id == OwnedEntity.id)
            .join(Media, Media.id == MediaEntity.media_id)
            .join(MediaEmbedding, MediaEmbedding.media_id == Media.id)
            .options(
                selectinload(Media.media_tags).selectinload(MediaTag.tag),
                selectinload(Media.entities),
            )
            .where(
                OwnedEntity.owner_user_id == user.id,
                OwnedEntity.id.in_(entity_ids),
                OwnedEntity.entity_type == MediaEntityType.character,
                MediaEntity.entity_type == MediaEntityType.character,
                Media.uploader_id == user.id,
                Media.deleted_at.is_(None),
                MediaEmbedding.model_version == EMBEDDING_MODEL_VERSION,
            )
            .order_by(OwnedEntity.media_count.desc(), OwnedEntity.name.asc(), Media.uploaded_at.desc())
        )
        return list((await self._db.execute(stmt)).all())

    def _build_candidates(
        self,
        rows: list[tuple[OwnedEntity, Media, list[float]]],
        *,
        sample_size: int,
        include_nsfw_thumbnails: bool,
    ) -> list[_CharacterCandidate]:
        scorer = HybridSimilarityScorer()
        grouped: dict[uuid.UUID, _CharacterCandidate] = {}
        seen_media_by_entity: dict[uuid.UUID, set[uuid.UUID]] = {}
        for entity, media, embedding in rows:
            vector = normalized(embedding)
            if not vector:
                continue
            candidate = grouped.setdefault(
                entity.id,
                _CharacterCandidate(id=entity.id, name=entity.name, media_count=entity.media_count),
            )
            seen_media = seen_media_by_entity.setdefault(entity.id, set())
            if media.id in seen_media:
                continue
            seen_media.add(media.id)
            candidate.items.append(_CharacterMediaItem(
                media=media,
                embedding=vector,
                profile=MediaSimilarityProfile(
                    embedding=vector,
                    tags=general_tag_names(media),
                    series_names=series_names(media),
                    support_count=1,
                ),
            ))

        candidates = [candidate for candidate in grouped.values() if candidate.items]
        for candidate in candidates:
            prototype = scorer.prototype_profile([item.profile for item in candidate.items])
            prototype.support_count = candidate.embedding_support
            candidate.prototype = prototype
            candidate.representative_media_ids = [
                item.media.id
                for item, _ in sorted(
                    (
                        (
                            item,
                            scorer.score(
                                item.profile,
                                prototype,
                                apply_confidence=False,
                            ).score,
                        )
                        for item in candidate.items
                    ),
                    key=lambda pair: pair[1],
                    reverse=True,
                )
                if include_nsfw_thumbnails or not effective_nsfw_value(item.media)
            ][:sample_size]

        return sorted(candidates, key=lambda candidate: (-candidate.media_count, candidate.name.casefold()))

    def _find_center(
        self,
        candidates: list[_CharacterCandidate],
        *,
        center_entity_id: uuid.UUID | None,
        center_name: str | None,
    ) -> _CharacterCandidate | None:
        if center_entity_id is None and not center_name:
            return None
        if center_entity_id is not None:
            for candidate in candidates:
                if candidate.id == center_entity_id:
                    return candidate
            raise AppError(status_code=404, code="character_graph_center_not_found", detail="Character not found in graph")

        normalized_center = normalize_metadata_search(center_name or "")
        submitted_names = normalize_manual_entity_names([center_name or ""])
        submitted_name = submitted_names[0].casefold() if submitted_names else (center_name or "").strip().casefold()
        for candidate in candidates:
            if normalize_metadata_search(candidate.name) == normalized_center or candidate.name.casefold() == submitted_name:
                return candidate
        raise AppError(status_code=404, code="character_graph_center_not_found", detail="Character not found in graph")

    def _select_candidates(
        self,
        candidates: list[_CharacterCandidate],
        *,
        center: _CharacterCandidate | None,
        limit: int,
        min_similarity: float,
        series_mode: GraphSeriesMode,
    ) -> list[_CharacterCandidate]:
        if center is None:
            return candidates[:limit]

        scored_neighbors = sorted(
            [
                (candidate, score)
                for candidate in candidates
                if candidate.id != center.id
                for score in [self._score(center, candidate)]
                if score is not None
                and score.score >= min_similarity
                and _series_mode_matches(center.series_names & candidate.series_names, series_mode)
            ],
            key=lambda pair: (-pair[1].score, -pair[0].media_count, pair[0].name.casefold()),
        )
        return [center, *[candidate for candidate, _ in scored_neighbors[: max(0, limit - 1)]]]

    def _build_edges(
        self,
        candidates: list[_CharacterCandidate],
        *,
        min_similarity: float,
        series_mode: GraphSeriesMode,
    ) -> list[CharacterGraphEdge]:
        edges: list[CharacterGraphEdge] = []
        for left_index, left in enumerate(candidates):
            for right in candidates[left_index + 1:]:
                score = self._score(left, right)
                if score is None or score.score < min_similarity:
                    continue
                shared_series = left.series_names & right.series_names
                if not _series_mode_matches(shared_series, series_mode):
                    continue
                source, target = sorted([left.id, right.id], key=str)
                edges.append(CharacterGraphEdge(
                    id=f"{source}:{target}",
                    source=source,
                    target=target,
                    similarity=round(score.score, 3),
                    shared_series=sorted(shared_series),
                ))
        return sorted(edges, key=lambda edge: (-edge.similarity, str(edge.source), str(edge.target)))

    def _score(self, left: _CharacterCandidate, right: _CharacterCandidate) -> HybridScore | None:
        if left.prototype is None or right.prototype is None:
            return None
        left_profile = _profile_without_series_penalty(left.prototype)
        right_profile = _profile_without_series_penalty(right.prototype)
        return HybridSimilarityScorer().score(
            left_profile,
            right_profile,
            apply_confidence=False,
        )


def _metadata_name_conditions(query: str):
    normalized_query = normalize_metadata_search(query)
    if normalized_query:
        return [
            func.lower(OwnedEntity.normalized_name) == normalized_query,
            *[
                func.lower(OwnedEntity.normalized_name).like(pattern, escape="\\")
                for pattern in normalized_token_sequence_like_patterns(normalized_query)
            ],
        ]
    clean_query = query.strip()
    if clean_query:
        return [OwnedEntity.name.ilike(f"%{clean_query}%")]
    return []


def _series_mode_matches(shared_series: set[str], series_mode: GraphSeriesMode) -> bool:
    if series_mode == "same":
        return bool(shared_series)
    if series_mode == "different":
        return not shared_series
    return True


def _profile_without_series_penalty(profile: MediaSimilarityProfile) -> MediaSimilarityProfile:
    return MediaSimilarityProfile(
        embedding=profile.embedding,
        tags=profile.tags,
        color_histogram=profile.color_histogram,
        series_names=set(),
        support_count=profile.support_count,
    )
