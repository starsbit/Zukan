from __future__ import annotations

from dataclasses import dataclass, field
import logging
import re
import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload

from backend.app.config import settings
from backend.app.models.media import Media, TaggingStatus
from backend.app.models.relations import MediaEntity, MediaEntityType
from backend.app.repositories.embeddings import MediaEmbeddingRepository
from backend.app.repositories.relations import MediaEntityRepository
from backend.app.schemas import ImportBatchRecommendationSuggestionRead
from backend.app.services.embeddings import MediaEmbeddingService

TOKEN_RE = re.compile(r"[a-z0-9]+")
MAX_SUGGESTIONS = 3
EXACT_MATCH_CONFIDENCE = 0.99
TRUSTED_ENTITY_SOURCES = {"manual": 1.0, "tagger": 0.92}

logger = logging.getLogger(__name__)


@dataclass
class SignatureVote:
    names: list[str]
    normalized_signature: tuple[str, ...]
    score: float = 0.0
    support: int = 0
    max_similarity: float = 0.0


@dataclass
class LibraryClassificationResult:
    applied: dict[MediaEntityType, list[str]] = field(default_factory=dict)
    suggestions: dict[MediaEntityType, list[ImportBatchRecommendationSuggestionRead]] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)


class MediaLibraryEnrichmentService:
    def __init__(
        self,
        db: AsyncSession,
        *,
        embedding_service: MediaEmbeddingService | None = None,
    ) -> None:
        self._db = db
        self._embeddings = embedding_service or MediaEmbeddingService(db)
        self._embedding_repo = MediaEmbeddingRepository(db)

    async def enrich_media(
        self,
        media_id: uuid.UUID,
        *,
        user_id: uuid.UUID,
        apply: bool = True,
        target_media: Media | None = None,
    ) -> LibraryClassificationResult:
        target = target_media if self._is_matching_media(target_media, media_id=media_id, uploader_id=user_id) else None
        if target is None:
            target = await self._load_media(media_id, uploader_id=user_id)
        if target is None:
            return LibraryClassificationResult()

        missing_types = [
            entity_type
            for entity_type in (MediaEntityType.character, MediaEntityType.series)
            if not self._has_non_empty_entities(target, entity_type)
        ]
        if not missing_types:
            return LibraryClassificationResult(metadata={"reason": "no_missing_entities"})

        exact_matches = await self._load_exact_matches(target)
        neighbors = []
        try:
            await self._embeddings.ensure_for_media(target)
            await self._embeddings.backfill_user_embeddings(
                uploader_id=user_id,
                exclude_media_id=target.id,
                limit=settings.library_classification_backfill_limit,
            )
            target_embedding = await self._embedding_repo.get_by_media_id(target.id)
            if target_embedding is not None:
                neighbors = await self._embedding_repo.nearest_neighbors(
                    media_id=target.id,
                    uploader_id=user_id,
                    embedding=target_embedding.embedding,
                    limit=settings.library_classification_neighbor_count,
                )
        except Exception as exc:  # pragma: no cover - best-effort fallback for optional enrichment
            logger.warning("Library classification embedding lookup failed media_id=%s error=%s", target.id, exc)

        neighbor_media = await self._load_media_by_ids([neighbor.media_id for neighbor in neighbors])
        media_by_id = {media.id: media for media in neighbor_media}

        result = LibraryClassificationResult(
            suggestions={MediaEntityType.character: [], MediaEntityType.series: []},
            metadata={
                "neighbor_count": len(neighbors),
                "exact_match_count": len(exact_matches),
            },
        )

        entity_repo = MediaEntityRepository(self._db)
        remaining_missing_types = set(missing_types)
        accepted_character_names = self._entity_names(target, MediaEntityType.character)

        for entity_type in (MediaEntityType.character, MediaEntityType.series):
            if entity_type not in remaining_missing_types:
                continue
            exact = self._pick_exact_signature(exact_matches, entity_type)
            if exact is None:
                continue
            if apply:
                await entity_repo.add_media_entities(
                    target,
                    entity_type=entity_type,
                    names=exact,
                    source="library_match",
                    confidence=EXACT_MATCH_CONFIDENCE,
                    replace_existing_type=True,
                )
                result.applied[entity_type] = exact
            if entity_type == MediaEntityType.character:
                accepted_character_names = exact
            remaining_missing_types.remove(entity_type)

        if MediaEntityType.character in remaining_missing_types:
            decision = self._score_signatures(
                entity_type=MediaEntityType.character,
                neighbors=neighbors,
                media_by_id=media_by_id,
            )
            result.suggestions[MediaEntityType.character] = decision["suggestions"]
            result.metadata[MediaEntityType.character.value] = decision["metadata"]

            auto_names = decision["auto_names"]
            if auto_names:
                accepted_character_names = auto_names
            if apply and auto_names:
                await entity_repo.add_media_entities(
                    target,
                    entity_type=MediaEntityType.character,
                    names=auto_names,
                    source="library_match",
                    confidence=decision["confidence"],
                    replace_existing_type=True,
                )
                result.applied[MediaEntityType.character] = auto_names
            remaining_missing_types.remove(MediaEntityType.character)

        if MediaEntityType.series in remaining_missing_types:
            character_decision = await self._infer_series_from_characters(
                user_id=user_id,
                target_media_id=target.id,
                character_names=accepted_character_names,
            )
            if character_decision["suggestions"]:
                result.suggestions[MediaEntityType.series] = character_decision["suggestions"]
                result.metadata[MediaEntityType.series.value] = character_decision["metadata"]

                auto_names = character_decision["auto_names"]
                if apply and auto_names:
                    await entity_repo.add_media_entities(
                        target,
                        entity_type=MediaEntityType.series,
                        names=auto_names,
                        source="library_match",
                        confidence=character_decision["confidence"],
                        replace_existing_type=True,
                    )
                    result.applied[MediaEntityType.series] = auto_names
            else:
                decision = self._score_signatures(
                    entity_type=MediaEntityType.series,
                    neighbors=neighbors,
                    media_by_id=media_by_id,
                )
                result.suggestions[MediaEntityType.series] = decision["suggestions"]
                result.metadata[MediaEntityType.series.value] = decision["metadata"]

                auto_names = decision["auto_names"]
                if apply and auto_names:
                    await entity_repo.add_media_entities(
                        target,
                        entity_type=MediaEntityType.series,
                        names=auto_names,
                        source="library_match",
                        confidence=decision["confidence"],
                        replace_existing_type=True,
                    )
                    result.applied[MediaEntityType.series] = auto_names

        if apply and result.applied:
            await self._db.commit()

        return result

    async def ensure_media_embedding(self, media_id: uuid.UUID) -> None:
        try:
            await self._embeddings.ensure_media_embedding(media_id)
            await self._db.commit()
        except Exception as exc:  # pragma: no cover - defensive logging for best-effort work
            await self._db.rollback()
            logger.warning("Media embedding refresh failed media_id=%s error=%s", media_id, exc)

    async def _load_media(self, media_id: uuid.UUID, *, uploader_id: uuid.UUID) -> Media | None:
        stmt = (
            select(Media)
            .options(selectinload(Media.entities), selectinload(Media.embedding))
            .where(
                Media.id == media_id,
                Media.uploader_id == uploader_id,
                Media.deleted_at.is_(None),
            )
        )
        result = await self._db.execute(stmt)
        media = self._extract_scalar(result)
        return media if isinstance(media, Media) else None

    async def _load_media_by_ids(self, media_ids: list[uuid.UUID]) -> list[Media]:
        if not media_ids:
            return []
        stmt = (
            select(Media)
            .options(selectinload(Media.entities))
            .where(
                Media.id.in_(media_ids),
                Media.deleted_at.is_(None),
                Media.tagging_status == TaggingStatus.DONE,
            )
        )
        return self._extract_media_list(await self._db.execute(stmt))

    async def _load_exact_matches(self, target: Media) -> list[Media]:
        if not target.phash or target.uploader_id is None:
            return []
        stmt = (
            select(Media)
            .options(selectinload(Media.entities))
            .where(
                Media.uploader_id == target.uploader_id,
                Media.deleted_at.is_(None),
                Media.tagging_status == TaggingStatus.DONE,
                Media.id != target.id,
                Media.phash == target.phash,
            )
        )
        return self._extract_media_list(await self._db.execute(stmt))

    def _is_matching_media(self, media: Media | None, *, media_id: uuid.UUID, uploader_id: uuid.UUID) -> bool:
        return bool(
            media is not None
            and media.id == media_id
            and media.uploader_id == uploader_id
            and media.deleted_at is None
        )

    def _extract_scalar(self, result: Any) -> Any:
        scalar_one_or_none = getattr(result, "scalar_one_or_none", None)
        if callable(scalar_one_or_none):
            return scalar_one_or_none()
        scalar_one = getattr(result, "scalar_one", None)
        if callable(scalar_one):
            return scalar_one()
        scalars = getattr(result, "scalars", None)
        if callable(scalars):
            scalar_result = scalars()
            all_rows = getattr(scalar_result, "all", None)
            if callable(all_rows):
                rows = all_rows()
                return rows[0] if rows else None
        all_rows = getattr(result, "all", None)
        if callable(all_rows):
            rows = all_rows()
            return rows[0] if rows else None
        return None

    def _extract_media_list(self, result: Any) -> list[Media]:
        scalars = getattr(result, "scalars", None)
        if callable(scalars):
            scalar_result = scalars()
            all_rows = getattr(scalar_result, "all", None)
            if callable(all_rows):
                return [row for row in all_rows() if isinstance(row, Media)]
        all_rows = getattr(result, "all", None)
        if callable(all_rows):
            return [row for row in all_rows() if isinstance(row, Media)]
        return []

    def _pick_exact_signature(self, candidates: list[Media], entity_type: MediaEntityType) -> list[str] | None:
        grouped: dict[tuple[str, ...], list[str]] = {}
        for candidate in candidates:
            names = self._trusted_entity_names(candidate, entity_type)
            if not names:
                continue
            signature = tuple(sorted(self._normalize_name(name) for name in names))
            grouped.setdefault(signature, names)
        if len(grouped) != 1:
            return None
        return next(iter(grouped.values()))

    def _score_signatures(
        self,
        *,
        entity_type: MediaEntityType,
        neighbors,
        media_by_id: dict[uuid.UUID, Media],
    ) -> dict[str, Any]:
        votes: dict[tuple[str, ...], SignatureVote] = {}
        for neighbor in neighbors:
            if neighbor.similarity < settings.library_classification_suggestion_min_similarity:
                continue
            media = media_by_id.get(neighbor.media_id)
            if media is None:
                continue
            names = self._trusted_entity_names(media, entity_type)
            if not names:
                continue
            signature = tuple(sorted(self._normalize_name(name) for name in names))
            if not signature:
                continue

            trust = self._source_weight(media, entity_type)
            vote = votes.setdefault(signature, SignatureVote(names=names, normalized_signature=signature))
            vote.score += neighbor.similarity * trust
            vote.support += 1
            vote.max_similarity = max(vote.max_similarity, neighbor.similarity)

        ranked = sorted(
            votes.values(),
            key=lambda vote: (-vote.score, -vote.max_similarity, -vote.support, vote.normalized_signature),
        )
        suggestions = self._build_suggestions(ranked)
        if not ranked:
            return {
                "auto_names": [],
                "confidence": None,
                "suggestions": suggestions,
                "metadata": {"reason": "no_ranked_neighbors"},
            }

        top = ranked[0]
        runner_up = ranked[1] if len(ranked) > 1 else None
        margin = top.score - (runner_up.score if runner_up is not None else 0.0)
        auto_allowed = (
            top.max_similarity >= settings.library_classification_auto_min_similarity
            and (
                top.support >= settings.library_classification_auto_min_support
                or top.max_similarity >= settings.library_classification_auto_high_similarity
            )
            and margin >= settings.library_classification_auto_min_margin
        )
        return {
            "auto_names": top.names if auto_allowed else [],
            "confidence": round(top.max_similarity, 3) if auto_allowed else None,
            "suggestions": suggestions,
            "metadata": {
                "reason": "auto_apply" if auto_allowed else "suggest_only",
                "top_support": top.support,
                "top_similarity": round(top.max_similarity, 3),
                "margin": round(margin, 3),
            },
        }

    async def _infer_series_from_characters(
        self,
        *,
        user_id: uuid.UUID,
        target_media_id: uuid.UUID,
        character_names: list[str],
    ) -> dict[str, Any]:
        normalized_character_names = self._unique_clean_names(character_names)
        if not normalized_character_names:
            return {
                "auto_names": [],
                "confidence": None,
                "suggestions": [],
                "metadata": {"reason": "no_character_context"},
            }

        character_model = aliased(MediaEntity)
        series_model = aliased(MediaEntity)
        trusted_sources = tuple(TRUSTED_ENTITY_SOURCES)
        count_expr = func.count(series_model.media_id.distinct())
        stmt = (
            select(
                series_model.name.label("name"),
                count_expr.label("media_count"),
            )
            .join(character_model, character_model.media_id == series_model.media_id)
            .join(Media, Media.id == series_model.media_id)
            .where(
                series_model.entity_type == MediaEntityType.series,
                character_model.entity_type == MediaEntityType.character,
                character_model.name.in_(normalized_character_names),
                character_model.source.in_(trusted_sources),
                series_model.source.in_(trusted_sources),
                series_model.name != "",
                Media.deleted_at.is_(None),
                Media.tagging_status == TaggingStatus.DONE,
                Media.uploader_id == user_id,
                Media.id != target_media_id,
            )
            .group_by(series_model.name)
            .order_by(count_expr.desc(), series_model.name.asc())
            .limit(MAX_SUGGESTIONS + 1)
        )
        rows = (await self._db.execute(stmt)).all()
        ranked = [
            (row.name.strip(), int(row.media_count or 0))
            for row in rows
            if row.name and row.name.strip() and int(row.media_count or 0) > 0
        ]
        ranked.sort(key=lambda item: (-item[1], item[0].casefold()))
        if not ranked:
            return {
                "auto_names": [],
                "confidence": None,
                "suggestions": [],
                "metadata": {"reason": "no_character_series_matches"},
            }

        max_count = ranked[0][1] or 1
        suggestions = [
            ImportBatchRecommendationSuggestionRead(
                name=name,
                confidence=round(count / max_count, 3),
            )
            for name, count in ranked[:MAX_SUGGESTIONS]
        ]

        top_name, top_count = ranked[0]
        runner_up_count = ranked[1][1] if len(ranked) > 1 else 0
        only_observed_series = len(ranked) == 1
        clear_top = only_observed_series or top_count > runner_up_count
        auto_allowed = clear_top and (
            top_count >= settings.library_classification_auto_min_support
            or only_observed_series
        )
        return {
            "auto_names": [top_name] if auto_allowed else [],
            "confidence": 0.95 if auto_allowed else None,
            "suggestions": suggestions,
            "metadata": {
                "reason": "character_inference" if auto_allowed else "character_inference_suggest_only",
                "character_names": normalized_character_names,
                "top_support": top_count,
                "runner_up_support": runner_up_count,
                "observed_series_count": len(ranked),
            },
        }

    def _build_suggestions(self, ranked: list[SignatureVote]) -> list[ImportBatchRecommendationSuggestionRead]:
        if not ranked:
            return []
        max_score = ranked[0].score or 1.0
        suggestions: list[ImportBatchRecommendationSuggestionRead] = []
        seen_names: set[str] = set()
        for vote in ranked:
            for name in vote.names:
                key = name.casefold()
                if key in seen_names:
                    continue
                seen_names.add(key)
                suggestions.append(
                    ImportBatchRecommendationSuggestionRead(
                        name=name,
                        confidence=round(min(0.999, vote.score / max_score), 3),
                    )
                )
                if len(suggestions) >= MAX_SUGGESTIONS:
                    return suggestions
        return suggestions

    def _trusted_entity_names(self, media: Media, entity_type: MediaEntityType) -> list[str]:
        names: list[str] = []
        seen: set[str] = set()
        for entity in media.entities:
            if entity.entity_type != entity_type or entity.source not in TRUSTED_ENTITY_SOURCES:
                continue
            name = entity.name.strip()
            if not name:
                continue
            key = name.casefold()
            if key in seen:
                continue
            seen.add(key)
            names.append(name)
        return names

    def _entity_names(self, media: Media, entity_type: MediaEntityType) -> list[str]:
        return self._unique_clean_names([
            entity.name
            for entity in media.entities
            if entity.entity_type == entity_type
        ])

    def _unique_clean_names(self, names: list[str]) -> list[str]:
        cleaned_names: list[str] = []
        seen: set[str] = set()
        for raw_name in names:
            name = raw_name.strip()
            if not name:
                continue
            key = name.casefold()
            if key in seen:
                continue
            seen.add(key)
            cleaned_names.append(name)
        return cleaned_names

    def _source_weight(self, media: Media, entity_type: MediaEntityType) -> float:
        weights = [
            TRUSTED_ENTITY_SOURCES.get(entity.source, 0.0)
            for entity in media.entities
            if entity.entity_type == entity_type and entity.name.strip()
        ]
        return max(weights, default=0.0)

    def _has_non_empty_entities(self, media: Media, entity_type: MediaEntityType) -> bool:
        return any(
            entity.entity_type == entity_type and entity.name.strip()
            for entity in media.entities
        )

    def _normalize_name(self, value: str | None) -> str:
        if not value:
            return ""
        return " ".join(TOKEN_RE.findall(value.replace("_", " ").casefold())).strip()
