from __future__ import annotations

from dataclasses import dataclass, field
import logging
import math
import re
import uuid
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload

from backend.app.config import settings
from backend.app.ml.embedding import EMBEDDING_MODEL_VERSION
from backend.app.models.library_classification import (
    LibraryClassificationFeedback,
    LibraryClassificationFeedbackAction,
)
from backend.app.models.embeddings import MediaEmbedding
from backend.app.models.media import Media, MediaTag, TaggingStatus
from backend.app.models.relations import MediaEntity, MediaEntityType
from backend.app.repositories.embeddings import MediaEmbeddingRepository
from backend.app.repositories.relations import MediaEntityRepository
from backend.app.services.hybrid_similarity import HybridSimilarityScorer, MediaSimilarityProfile
from backend.app.schemas import ImportBatchRecommendationSuggestionRead, LibraryClassificationFeedbackCreate
from backend.app.services.embeddings import MediaEmbeddingService

TOKEN_RE = re.compile(r"[a-z0-9]+")
MAX_SUGGESTIONS = 3
EXACT_MATCH_CONFIDENCE = 0.99
TRUSTED_ENTITY_SOURCE_WEIGHTS = {"manual": 1.0, "tagger": 0.92}

logger = logging.getLogger(__name__)


@dataclass
class SignatureVote:
    names: list[str]
    normalized_signature: tuple[str, ...]
    score: float = 0.0
    support: int = 0
    max_similarity: float = 0.0
    source: str = "neighbor"
    explanation: str | None = None
    entity_id: uuid.UUID | None = None


@dataclass
class CharacterPrototype:
    names: list[str]
    normalized_signature: tuple[str, ...]
    centroid: list[float]
    support_keys: set[str] = field(default_factory=set)
    entity_id: uuid.UUID | None = None
    tags: set[str] = field(default_factory=set)
    color_histogram: list[float] = field(default_factory=list)
    series_names: set[str] = field(default_factory=set)


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
        self._hybrid_similarity = HybridSimilarityScorer()

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
        target_embedding = None
        try:
            await self._embeddings.ensure_for_media(target)
            await self._embeddings.backfill_user_embeddings(
                uploader_id=user_id,
                exclude_media_id=target.id,
                limit=settings.library_classification_backfill_limit,
            )
            target_embedding = await self._embedding_repo.get_by_media_id(target.id)
            if target_embedding is not None and getattr(target_embedding, "model_version", EMBEDDING_MODEL_VERSION) == EMBEDDING_MODEL_VERSION:
                neighbors = await self._embedding_repo.nearest_neighbors(
                    media_id=target.id,
                    uploader_id=user_id,
                    embedding=target_embedding.embedding,
                    limit=settings.library_classification_neighbor_count,
                    model_version=EMBEDDING_MODEL_VERSION,
                )
            else:
                target_embedding = None
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
                await self._record_feedback(
                    user_id=user_id,
                    media_id=target.id,
                    entity_type=entity_type,
                    names=exact,
                    action=LibraryClassificationFeedbackAction.auto_applied,
                    source="exact_phash",
                    similarity=EXACT_MATCH_CONFIDENCE,
                    explanation=f"Exact visual duplicate matched {', '.join(exact)}.",
                )
                result.applied[entity_type] = exact
            if entity_type == MediaEntityType.character:
                accepted_character_names = exact
            remaining_missing_types.remove(entity_type)

        if MediaEntityType.character in remaining_missing_types:
            prototype_decision = await self._score_character_prototypes(
                user_id=user_id,
                target=target,
                target_embedding=target_embedding.embedding if target_embedding is not None else None,
            )
            neighbor_decision = self._score_signatures(
                entity_type=MediaEntityType.character,
                neighbors=neighbors,
                media_by_id=media_by_id,
                target=target,
                auto_apply=False,
            )
            decision = self._merge_decisions(prototype_decision, neighbor_decision)
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
                await self._record_feedback(
                    user_id=user_id,
                    media_id=target.id,
                    entity_type=MediaEntityType.character,
                    names=auto_names,
                    action=LibraryClassificationFeedbackAction.auto_applied,
                    source=decision["metadata"].get("reason"),
                    similarity=decision["confidence"],
                    explanation=decision["metadata"].get("explanation"),
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
                    target=target,
                    auto_apply=False,
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
            .options(
                selectinload(Media.entities),
                selectinload(Media.embedding),
                selectinload(Media.media_tags).selectinload(MediaTag.tag),
            )
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
            .options(
                selectinload(Media.entities),
                selectinload(Media.embedding),
                selectinload(Media.media_tags).selectinload(MediaTag.tag),
            )
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
        target: Media,
        auto_apply: bool,
    ) -> dict[str, Any]:
        votes: dict[tuple[str, ...], SignatureVote] = {}
        target_profile: MediaSimilarityProfile | None = None
        for neighbor in neighbors:
            if neighbor.similarity < settings.library_classification_min_visual_similarity:
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
            if entity_type == MediaEntityType.character:
                if target_profile is None:
                    target_profile = self._hybrid_similarity.media_profile(target, [1.0, 0.0])
                    target_profile.support_count = 10
                candidate_profile = self._hybrid_similarity.media_profile(media, _synthetic_cosine_vector(neighbor.similarity))
                candidate_profile.support_count = 10
                hybrid = self._hybrid_similarity.score(target_profile, candidate_profile, apply_confidence=False)
                adjusted_similarity = hybrid.score
                explanation = (
                    f"Matched nearby library item for {', '.join(names)}, "
                    f"hybrid similarity {adjusted_similarity:.2f} "
                    f"(visual {hybrid.breakdown.visual or 0.0:.2f}, tags {hybrid.breakdown.tags or 0.0:.2f}, color {hybrid.breakdown.color or 0.0:.2f})."
                )
            else:
                tag_boost = self._tag_overlap_score(self._general_tag_names(target), self._general_tag_names(media))
                adjusted_similarity = min(
                    0.999,
                    neighbor.similarity * (1.0 - settings.library_classification_tag_overlap_weight)
                    + tag_boost * settings.library_classification_tag_overlap_weight,
                )
                explanation = (
                    f"Matched nearby library item for {', '.join(names)}, "
                    f"visual similarity {neighbor.similarity:.2f}."
                )
            vote.score += adjusted_similarity * trust
            vote.support += 1
            vote.max_similarity = max(vote.max_similarity, adjusted_similarity)
            vote.explanation = explanation

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
        auto_allowed = auto_apply and (
            top.max_similarity >= settings.library_classification_auto_min_similarity
            and top.support >= settings.library_classification_auto_min_support
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
                "explanation": top.explanation,
            },
        }

    async def _score_character_prototypes(
        self,
        *,
        user_id: uuid.UUID,
        target: Media,
        target_embedding: list[float] | None,
    ) -> dict[str, Any]:
        if not target_embedding:
            return {
                "auto_names": [],
                "confidence": None,
                "suggestions": [],
                "metadata": {"reason": "no_target_embedding"},
            }

        rejected = await self._rejected_suggestion_keys(
            user_id=user_id,
            media_id=target.id,
            entity_type=MediaEntityType.character,
        )
        prototypes = await self._build_character_prototypes(
            user_id=user_id,
            target_media_id=target.id,
        )
        ranked: list[SignatureVote] = []
        for prototype in prototypes:
            if prototype.normalized_signature in rejected:
                continue
            target_profile = self._hybrid_similarity.media_profile(target, _normalized(target_embedding))
            target_profile.support_count = 10
            prototype_profile = _profile_from_character_prototype(prototype)
            hybrid = self._hybrid_similarity.score(target_profile, prototype_profile)
            if hybrid.score < settings.library_classification_suggestion_min_similarity:
                continue
            support = len(prototype.support_keys)
            explanation = (
                f"Matched {support} trusted example{'s' if support != 1 else ''} of "
                f"{', '.join(prototype.names)}, hybrid similarity {hybrid.score:.2f} "
                f"(visual {hybrid.breakdown.visual or 0.0:.2f}, tags {hybrid.breakdown.tags or 0.0:.2f}, "
                f"color {hybrid.breakdown.color or 0.0:.2f}, confidence {hybrid.breakdown.confidence or 0.0:.2f})."
            )
            ranked.append(SignatureVote(
                names=prototype.names,
                normalized_signature=prototype.normalized_signature,
                score=hybrid.score,
                support=support,
                max_similarity=hybrid.score,
                source="prototype",
                explanation=explanation,
                entity_id=prototype.entity_id,
            ))

        ranked.sort(key=lambda vote: (-vote.score, -vote.support, vote.normalized_signature))
        suggestions = self._build_suggestions(ranked)
        if not ranked:
            return {
                "auto_names": [],
                "confidence": None,
                "suggestions": suggestions,
                "metadata": {"reason": "no_ranked_prototypes"},
            }

        top = ranked[0]
        runner_up = ranked[1] if len(ranked) > 1 else None
        margin = top.score - (runner_up.score if runner_up is not None else 0.0)
        auto_allowed = (
            top.max_similarity >= settings.library_classification_auto_min_similarity
            and top.support >= settings.library_classification_auto_min_support
            and margin >= settings.library_classification_auto_min_margin
        )
        return {
            "auto_names": top.names if auto_allowed else [],
            "confidence": round(top.max_similarity, 3) if auto_allowed else None,
            "suggestions": suggestions,
            "metadata": {
                "reason": "prototype_auto_apply" if auto_allowed else "prototype_suggest_only",
                "top_support": top.support,
                "top_similarity": round(top.max_similarity, 3),
                "margin": round(margin, 3),
                "explanation": top.explanation,
            },
        }

    async def _build_character_prototypes(
        self,
        *,
        user_id: uuid.UUID,
        target_media_id: uuid.UUID,
    ) -> list[CharacterPrototype]:
        stmt = (
            select(
                MediaEntity.name,
                MediaEntity.entity_id,
                Media,
                MediaEmbedding.embedding,
            )
            .join(Media, Media.id == MediaEntity.media_id)
            .join(MediaEmbedding, MediaEmbedding.media_id == Media.id)
            .options(
                selectinload(Media.media_tags).selectinload(MediaTag.tag),
                selectinload(Media.entities),
            )
            .where(
                Media.uploader_id == user_id,
                Media.deleted_at.is_(None),
                Media.tagging_status == TaggingStatus.DONE,
                Media.id != target_media_id,
                MediaEmbedding.model_version == EMBEDDING_MODEL_VERSION,
                MediaEntity.entity_type == MediaEntityType.character,
                MediaEntity.source == "manual",
                MediaEntity.name != "",
            )
            .order_by(Media.uploaded_at.desc(), Media.id.desc())
        )
        rows = (await self._db.execute(stmt)).all()
        prototypes_by_signature: dict[tuple[str, ...], list[CharacterPrototype]] = {}
        used_support_keys: dict[tuple[str, ...], set[str]] = {}
        for row in rows:
            name = str(row.name or "").strip()
            signature = (self._normalize_name(name),)
            embedding = getattr(row, "embedding", None)
            if not signature[0] or not embedding:
                continue
            media = row.Media if hasattr(row, "Media") else row[2]
            support_key = str(media.phash or media.id)
            seen_keys = used_support_keys.setdefault(signature, set())
            if support_key in seen_keys:
                continue
            seen_keys.add(support_key)

            vector = _normalized(embedding)
            if not vector:
                continue
            media_profile = self._hybrid_similarity.media_profile(media, vector)
            prototypes = prototypes_by_signature.setdefault(signature, [])
            best = max(
                prototypes,
                key=lambda prototype: _cosine_similarity(vector, prototype.centroid),
                default=None,
            )
            if (
                best is not None
                and _cosine_similarity(vector, best.centroid) >= settings.library_classification_prototype_cluster_similarity
            ):
                best.centroid = _normalized([
                    (best.centroid[index] * len(best.support_keys) + vector[index]) / (len(best.support_keys) + 1)
                    for index in range(min(len(best.centroid), len(vector)))
                ])
                best.support_keys.add(support_key)
                best_profile = _profile_from_character_prototype(best)
                merged_profile = self._hybrid_similarity.prototype_profile([best_profile, media_profile])
                best.tags = merged_profile.tags
                best.color_histogram = merged_profile.color_histogram
                best.series_names = merged_profile.series_names
                continue

            if len(prototypes) >= settings.library_classification_prototype_max_per_entity:
                continue
            prototypes.append(CharacterPrototype(
                names=[name],
                normalized_signature=signature,
                centroid=vector,
                support_keys={support_key},
                entity_id=row.entity_id,
                tags=set(media_profile.tags),
                color_histogram=list(media_profile.color_histogram),
                series_names=set(media_profile.series_names),
            ))

        return [
            prototype
            for prototypes in prototypes_by_signature.values()
            for prototype in prototypes
        ]

    def _merge_decisions(self, primary: dict[str, Any], secondary: dict[str, Any]) -> dict[str, Any]:
        merged_suggestions = self._merge_suggestion_lists(primary.get("suggestions", []), secondary.get("suggestions", []))
        if primary.get("auto_names"):
            primary["suggestions"] = merged_suggestions
            return primary
        primary_rank = primary.get("suggestions", [])
        secondary_rank = secondary.get("suggestions", [])
        if not primary_rank and secondary_rank:
            secondary["suggestions"] = merged_suggestions
            return secondary
        primary["suggestions"] = merged_suggestions
        return primary

    def _merge_suggestion_lists(
        self,
        primary: list[ImportBatchRecommendationSuggestionRead],
        secondary: list[ImportBatchRecommendationSuggestionRead],
    ) -> list[ImportBatchRecommendationSuggestionRead]:
        by_name: dict[str, ImportBatchRecommendationSuggestionRead] = {}
        order: list[str] = []
        for suggestion in [*primary, *secondary]:
            key = suggestion.name.casefold()
            current = by_name.get(key)
            if current is None:
                by_name[key] = suggestion
                order.append(key)
            elif suggestion.confidence > current.confidence:
                by_name[key] = suggestion
        ordered = sorted(
            by_name.values(),
            key=lambda suggestion: (-suggestion.confidence, order.index(suggestion.name.casefold())),
        )
        return ordered[:MAX_SUGGESTIONS]

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
                _trusted_entity_sql_filter(character_model),
                _trusted_entity_sql_filter(series_model),
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

        _, top_count = ranked[0]
        runner_up_count = ranked[1][1] if len(ranked) > 1 else 0
        return {
            "auto_names": [],
            "confidence": None,
            "suggestions": suggestions,
            "metadata": {
                "reason": "character_inference_suggest_only",
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
                        entity_id=vote.entity_id,
                        entity_type=None,
                        source=vote.source,
                        model_version=EMBEDDING_MODEL_VERSION,
                        visual_similarity=round(vote.max_similarity, 3),
                        explanation=vote.explanation,
                    )
                )
                if len(suggestions) >= MAX_SUGGESTIONS:
                    return suggestions
        return suggestions

    def _trusted_entity_names(self, media: Media, entity_type: MediaEntityType) -> list[str]:
        names: list[str] = []
        seen: set[str] = set()
        for entity in media.entities:
            if entity.entity_type != entity_type or not _is_trusted_entity(entity):
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
            _trusted_entity_weight(entity)
            for entity in media.entities
            if entity.entity_type == entity_type and entity.name.strip() and _is_trusted_entity(entity)
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

    def _general_tag_names(self, media: Media) -> set[str]:
        names: set[str] = set()
        for media_tag in getattr(media, "media_tags", []) or []:
            tag = getattr(media_tag, "tag", None)
            name = str(getattr(tag, "name", "") or "").strip().casefold()
            category = int(getattr(tag, "category", 0) or 0)
            if not name or category in {3, 4, 9}:
                continue
            names.add(name)
        return names

    def _tag_overlap_score(self, target_tags: set[str], candidate_tags: set[str]) -> float:
        if not target_tags or not candidate_tags:
            return 0.0
        intersection = len(target_tags & candidate_tags)
        union = len(target_tags | candidate_tags)
        return intersection / union if union else 0.0

    async def _rejected_suggestion_keys(
        self,
        *,
        user_id: uuid.UUID,
        media_id: uuid.UUID,
        entity_type: MediaEntityType,
    ) -> set[tuple[str, ...]]:
        rows = (
            await self._db.execute(
                select(
                    LibraryClassificationFeedback.suggested_name,
                    LibraryClassificationFeedback.suggested_entity_id,
                ).where(
                    LibraryClassificationFeedback.user_id == user_id,
                    LibraryClassificationFeedback.media_id == media_id,
                    LibraryClassificationFeedback.entity_type == entity_type.value,
                    LibraryClassificationFeedback.action == LibraryClassificationFeedbackAction.rejected,
                )
            )
        ).all()
        return {
            (self._normalize_name(row.suggested_name),)
            for row in rows
            if hasattr(row, "suggested_name")
            if self._normalize_name(row.suggested_name)
        }

    async def _record_feedback(
        self,
        *,
        user_id: uuid.UUID,
        media_id: uuid.UUID,
        entity_type: MediaEntityType,
        names: list[str],
        action: LibraryClassificationFeedbackAction,
        source: str | None,
        similarity: float | None,
        explanation: str | None,
    ) -> None:
        for name in self._unique_clean_names(names):
            self._db.add(LibraryClassificationFeedback(
                user_id=user_id,
                media_id=media_id,
                entity_type=entity_type.value,
                suggested_entity_id=None,
                suggested_name=name,
                series_name=None,
                model_version=EMBEDDING_MODEL_VERSION,
                action=action,
                source=source,
                similarity=similarity,
                explanation=explanation,
            ))
        logger.info(
            "Library classification feedback recorded user_id=%s media_id=%s entity_type=%s action=%s names=%s source=%s similarity=%s",
            user_id,
            media_id,
            entity_type.value,
            action.value,
            names,
            source,
            similarity,
        )

    async def record_feedback(
        self,
        user_id: uuid.UUID,
        payload: LibraryClassificationFeedbackCreate,
    ) -> LibraryClassificationFeedback | None:
        media = await self._db.get(Media, payload.media_id)
        if media is None or media.deleted_at is not None or media.uploader_id != user_id:
            return None

        action = LibraryClassificationFeedbackAction(payload.action)
        feedback = LibraryClassificationFeedback(
            user_id=user_id,
            media_id=payload.media_id,
            entity_type=payload.entity_type.value,
            suggested_entity_id=payload.suggested_entity_id,
            suggested_name=payload.suggested_name.strip(),
            series_name=payload.series_name.strip() if payload.series_name else None,
            model_version=payload.model_version or EMBEDDING_MODEL_VERSION,
            action=action,
            source=payload.source,
            similarity=payload.similarity,
            explanation=payload.explanation,
        )
        self._db.add(feedback)
        await self._db.commit()
        await self._db.refresh(feedback)
        logger.info(
            "Library classification feedback submitted user_id=%s media_id=%s entity_type=%s action=%s suggested_name=%s source=%s similarity=%s",
            user_id,
            payload.media_id,
            payload.entity_type.value,
            action.value,
            feedback.suggested_name,
            feedback.source,
            feedback.similarity,
        )
        return feedback


def _normalized(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(float(value) * float(value) for value in vector))
    if norm <= 0:
        return []
    return [float(value) / norm for value in vector]


def _cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right:
        return 0.0
    limit = min(len(left), len(right))
    return sum(float(left[index]) * float(right[index]) for index in range(limit))


def _synthetic_cosine_vector(similarity: float) -> list[float]:
    clamped = max(0.0, min(1.0, float(similarity)))
    return [clamped, math.sqrt(max(0.0, 1.0 - clamped * clamped))]


def _profile_from_character_prototype(prototype: CharacterPrototype) -> MediaSimilarityProfile:
    return MediaSimilarityProfile(
        embedding=prototype.centroid,
        tags=set(prototype.tags),
        color_histogram=list(prototype.color_histogram),
        series_names=set(prototype.series_names),
        support_count=max(1, len(prototype.support_keys)),
    )


def _is_trusted_entity(entity: MediaEntity) -> bool:
    if entity.source == "manual":
        return True
    if entity.source != "tagger":
        return False
    return entity.confidence is not None and entity.confidence >= settings.library_classification_trusted_tagger_min_confidence


def _trusted_entity_weight(entity: MediaEntity) -> float:
    if not _is_trusted_entity(entity):
        return 0.0
    return TRUSTED_ENTITY_SOURCE_WEIGHTS.get(entity.source, 0.0)


def _trusted_entity_sql_filter(model):
    return or_(
        model.source == "manual",
        and_(
            model.source == "tagger",
            model.confidence.is_not(None),
            model.confidence >= settings.library_classification_trusted_tagger_min_confidence,
        ),
    )
