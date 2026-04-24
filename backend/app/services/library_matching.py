from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Coroutine
from itertools import combinations
import logging
import math
import re
from types import SimpleNamespace
import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload

from backend.app.models.media import Media, TaggingStatus
from backend.app.models.processing import ImportBatchItem
from backend.app.models.relations import MediaEntity, MediaEntityType
from backend.app.models.tags import MediaTag
from backend.app.repositories.relations import MediaEntityRepository
from backend.app.schemas import (
    ImportBatchRecommendationGroupRead,
    ImportBatchRecommendationSignalRead,
    ImportBatchRecommendationSuggestionRead,
    ImportBatchReviewItemRead,
)

TOKEN_RE = re.compile(r"[a-z0-9]+")
MAX_GROUP_SUGGESTIONS = 3
TAG_SIMILARITY_THRESHOLD = 0.34
PAIR_SCORE_THRESHOLD = 0.36
LIBRARY_MATCH_SCORE_THRESHOLD = 0.72
LIBRARY_MATCH_SCORE_MARGIN = 0.10
EXACT_MATCH_CONFIDENCE = 0.99

logger = logging.getLogger(__name__)

SuggestionSource = Coroutine[Any, Any, list[ImportBatchRecommendationSuggestionRead]]


async def _resolved(value: list[ImportBatchRecommendationSuggestionRead]) -> list[ImportBatchRecommendationSuggestionRead]:
    return value


class MediaSimilarityMatcher:
    def _media(self, candidate: Any) -> Media:
        return candidate.media if hasattr(candidate, "media") else candidate

    def build_batch_tag_counts(self, candidates: list[Any]) -> Counter[str]:
        tag_counts: Counter[str] = Counter()
        for candidate in candidates:
            for tag_name, _, _ in self.iter_groupable_tags(candidate):
                tag_counts[tag_name] += 1
        return tag_counts

    def pair_similarity(
        self,
        left: Any,
        right: Any,
        batch_tag_counts: Counter[str],
        batch_size: int,
    ) -> float:
        left_tags = self.tag_weight_map(left, batch_tag_counts, batch_size)
        right_tags = self.tag_weight_map(right, batch_tag_counts, batch_size)
        similarity = self.weighted_jaccard(left_tags, right_tags)
        if similarity >= TAG_SIMILARITY_THRESHOLD:
            similarity += 0.08

        left_media = self._media(left)
        right_media = self._media(right)
        if left_media.phash and left_media.phash == right_media.phash:
            similarity += 0.22

        similarity += 0.16 * self.token_jaccard(self.ocr_tokens(left_media.ocr_text), self.ocr_tokens(right_media.ocr_text))
        similarity += 0.24 * self.token_jaccard(self.entity_tokens(left_media), self.entity_tokens(right_media))
        return min(similarity, 0.99)

    def iter_groupable_tags(
        self,
        candidate: Any,
        *,
        include_common: bool = False,
    ) -> list[tuple[str, MediaTag, float]]:
        media = self._media(candidate)
        tags: list[tuple[str, MediaTag, float]] = []
        for media_tag in media.media_tags:
            tag = media_tag.tag
            normalized = self.normalize_token(tag.name)
            if not normalized or tag.category == 9:
                continue
            if not include_common and tag.category == 5:
                continue

            category_weight = {
                0: 1.0,
                3: 1.35,
                4: 1.45,
                5: 0.45,
            }.get(tag.category, 0.75)
            confidence_weight = 0.6 + (media_tag.confidence or 0.0)
            tags.append((normalized, media_tag, category_weight * confidence_weight))
        return tags

    def tag_weight_map(
        self,
        candidate: Any,
        batch_tag_counts: Counter[str],
        batch_size: int,
    ) -> dict[str, float]:
        weights: dict[str, float] = {}
        common_threshold = max(3, math.ceil(batch_size * 0.6))
        for normalized, _, weight in self.iter_groupable_tags(candidate):
            if batch_tag_counts[normalized] >= common_threshold:
                continue
            weights[normalized] = max(weights.get(normalized, 0.0), weight)
        return weights

    def shared_tag_weights(self, candidates: list[Any]) -> dict[int, float]:
        if len(candidates) < 2:
            return {}

        tag_weights: dict[int, float] = defaultdict(float)
        tag_counts: Counter[int] = Counter()
        for candidate in candidates:
            per_candidate_weights: dict[int, float] = {}
            for _, media_tag, weight in self.iter_groupable_tags(candidate):
                tag_id = int(media_tag.tag_id)
                per_candidate_weights[tag_id] = max(per_candidate_weights.get(tag_id, 0.0), weight)
            for tag_id, weight in per_candidate_weights.items():
                tag_counts[tag_id] += 1
                tag_weights[tag_id] += weight

        shared = {
            tag_id: tag_weights[tag_id] * (tag_counts[tag_id] / len(candidates))
            for tag_id in tag_counts
            if tag_counts[tag_id] >= 2
        }
        if not shared:
            return {}

        sorted_shared = sorted(shared.items(), key=lambda item: (-item[1], item[0]))[:6]
        return dict(sorted_shared)

    def entity_tokens(self, media_or_candidate: Any) -> set[str]:
        media = self._media(media_or_candidate)
        tokens: set[str] = set()
        for entity in media.entities:
            normalized = self.normalize_token(entity.name)
            if normalized:
                tokens.add(normalized)
        return tokens

    def ocr_tokens(self, text: str | None) -> set[str]:
        if not text:
            return set()
        return {token for token in TOKEN_RE.findall(text.casefold()) if len(token) >= 3}

    def weighted_jaccard(self, left: dict[str, float], right: dict[str, float]) -> float:
        if not left or not right:
            return 0.0
        keys = set(left) | set(right)
        intersection = sum(min(left.get(key, 0.0), right.get(key, 0.0)) for key in keys)
        union = sum(max(left.get(key, 0.0), right.get(key, 0.0)) for key in keys)
        return intersection / union if union else 0.0

    def token_jaccard(self, left: set[str], right: set[str]) -> float:
        if not left or not right:
            return 0.0
        return len(left & right) / len(left | right)

    def normalize_token(self, value: str | None) -> str:
        if not value:
            return ""
        normalized = " ".join(TOKEN_RE.findall(value.replace("_", " ").casefold()))
        return normalized.strip()


class MediaLibraryMatcher:
    def __init__(
        self,
        db: AsyncSession,
        *,
        similarity: MediaSimilarityMatcher | None = None,
    ) -> None:
        self._db = db
        self._similarity = similarity or MediaSimilarityMatcher()

    async def build_recommendation_groups(
        self,
        review_items: list[ImportBatchReviewItemRead],
        candidates: list[ImportBatchItem],
        user_id: uuid.UUID,
    ) -> list[ImportBatchRecommendationGroupRead]:
        review_item_by_media_id = {item.media.id: item for item in review_items}
        review_candidates = [candidate for candidate in candidates if candidate.media and candidate.media.id in review_item_by_media_id]
        logger.info("Building recommendation groups candidate_count=%d", len(review_candidates))
        if len(review_candidates) < 2:
            logger.info("Skipping grouping: fewer than 2 candidates")
            return []

        groups: list[ImportBatchRecommendationGroupRead] = []
        grouped_ids: set[uuid.UUID] = set()

        remaining = [c for c in review_candidates if c.media.id not in grouped_ids]
        if len(remaining) >= 2:
            entity_groups, entity_grouped_ids = await self._build_entity_name_groups(
                remaining, review_item_by_media_id, len(groups), user_id,
            )
            groups.extend(entity_groups)
            grouped_ids |= entity_grouped_ids

        remaining = [c for c in review_candidates if c.media.id not in grouped_ids]
        if len(remaining) >= 2:
            groups.extend(await self._build_similarity_groups(remaining, review_item_by_media_id, len(groups), user_id))

        groups.sort(key=lambda group: (-group.confidence, -group.item_count, group.id))
        return groups

    async def _build_entity_name_groups(
        self,
        candidates: list[ImportBatchItem],
        review_item_by_media_id: dict[uuid.UUID, ImportBatchReviewItemRead],
        group_index_start: int,
        user_id: uuid.UUID,
    ) -> tuple[list[ImportBatchRecommendationGroupRead], set[uuid.UUID]]:
        series_buckets: dict[str, list[ImportBatchItem]] = defaultdict(list)
        character_buckets: dict[str, list[ImportBatchItem]] = defaultdict(list)

        for candidate in candidates:
            review_item = review_item_by_media_id[candidate.media.id]
            if review_item.missing_character and not review_item.missing_series:
                series_name = next(
                    (e.name.strip() for e in candidate.media.entities if e.entity_type == MediaEntityType.series and e.name.strip()),
                    None,
                )
                if series_name is not None:
                    series_buckets[series_name.casefold()].append(candidate)
            elif review_item.missing_series and not review_item.missing_character:
                char_name = next(
                    (e.name.strip() for e in candidate.media.entities if e.entity_type == MediaEntityType.character and e.name.strip()),
                    None,
                )
                if char_name is not None:
                    character_buckets[char_name.casefold()].append(candidate)

        logger.info(
            "Entity buckets built series_buckets=%s character_buckets=%s",
            {k: len(v) for k, v in series_buckets.items()},
            {k: len(v) for k, v in character_buckets.items()},
        )

        groups: list[ImportBatchRecommendationGroupRead] = []
        grouped_ids: set[uuid.UUID] = set()

        for bucket_candidates in series_buckets.values():
            if len(bucket_candidates) < 2:
                continue
            group = await self._build_recommendation_group(
                bucket_candidates,
                review_item_by_media_id,
                {},
                group_index_start + len(groups),
                user_id,
                confidence_override=0.90,
            )
            groups.append(group)
            grouped_ids.update(c.media.id for c in bucket_candidates)

        for bucket_candidates in character_buckets.values():
            ungrouped = [c for c in bucket_candidates if c.media.id not in grouped_ids]
            if not ungrouped:
                continue
            if len(ungrouped) < 2:
                continue
            group = await self._build_recommendation_group(
                ungrouped,
                review_item_by_media_id,
                {},
                group_index_start + len(groups),
                user_id,
                confidence_override=0.80,
            )
            groups.append(group)
            grouped_ids.update(c.media.id for c in ungrouped)

        return groups, grouped_ids

    async def _build_similarity_groups(
        self,
        candidates: list[ImportBatchItem],
        review_item_by_media_id: dict[uuid.UUID, ImportBatchReviewItemRead],
        group_index_start: int,
        user_id: uuid.UUID,
    ) -> list[ImportBatchRecommendationGroupRead]:
        batch_tag_counts = self._similarity.build_batch_tag_counts(candidates)

        adjacency: dict[uuid.UUID, set[uuid.UUID]] = defaultdict(set)
        pair_scores: dict[frozenset[uuid.UUID], float] = {}

        for left, right in combinations(candidates, 2):
            score = self._similarity.pair_similarity(left, right, batch_tag_counts, len(candidates))
            if score < PAIR_SCORE_THRESHOLD:
                continue
            left_id = left.media.id
            right_id = right.media.id
            adjacency[left_id].add(right_id)
            adjacency[right_id].add(left_id)
            pair_scores[frozenset((left_id, right_id))] = score

        groups: list[ImportBatchRecommendationGroupRead] = []
        visited: set[uuid.UUID] = set()
        for candidate in candidates:
            media_id = candidate.media.id
            if media_id in visited or media_id not in adjacency:
                continue

            component_ids: list[uuid.UUID] = []
            stack = [media_id]
            while stack:
                current = stack.pop()
                if current in visited:
                    continue
                visited.add(current)
                component_ids.append(current)
                stack.extend(neighbor for neighbor in adjacency[current] if neighbor not in visited)

            if len(component_ids) < 2:
                continue

            component_media_ids = set(component_ids)
            component_candidates = [c for c in candidates if c.media.id in component_media_ids]
            groups.append(
                await self._build_recommendation_group(
                    component_candidates,
                    review_item_by_media_id,
                    pair_scores,
                    group_index_start + len(groups),
                    user_id,
                )
            )

        return groups

    async def _build_recommendation_group(
        self,
        candidates: list[ImportBatchItem],
        review_item_by_media_id: dict[uuid.UUID, ImportBatchReviewItemRead],
        pair_scores: dict[frozenset[uuid.UUID], float],
        group_index: int,
        user_id: uuid.UUID,
        *,
        extra_series_suggestions: list[ImportBatchRecommendationSuggestionRead] | None = None,
        confidence_override: float | None = None,
    ) -> ImportBatchRecommendationGroupRead:
        media_ids = [candidate.media.id for candidate in candidates]
        media_id_set = set(media_ids)
        pair_values = [
            pair_scores[key]
            for key in pair_scores
            if key.issubset(media_id_set)
        ]
        confidence = confidence_override if confidence_override is not None else (
            round(sum(pair_values) / len(pair_values), 3) if pair_values else PAIR_SCORE_THRESHOLD
        )

        missing_character_count = sum(1 for media_id in media_ids if review_item_by_media_id[media_id].missing_character)
        missing_series_count = sum(1 for media_id in media_ids if review_item_by_media_id[media_id].missing_series)

        suggested_characters = await self._collect_suggestions([
            self._build_name_suggestions(candidates, MediaEntityType.character),
            self._infer_entity_suggestions_from_library(user_id, candidates, MediaEntityType.character),
        ])

        series_sources: list[SuggestionSource] = []
        if extra_series_suggestions:
            series_sources.append(_resolved(extra_series_suggestions))
        series_sources.extend([
            self._build_name_suggestions(candidates, MediaEntityType.series),
            self._infer_entity_suggestions_from_library(user_id, candidates, MediaEntityType.series),
            self._infer_series_suggestions_from_characters(user_id, [s.name for s in suggested_characters]),
        ])
        suggested_series = await self._collect_suggestions(series_sources)

        shared_signals = self._build_shared_signals(candidates)

        return ImportBatchRecommendationGroupRead(
            id=f"batch-group-{group_index + 1}",
            media_ids=media_ids,
            item_count=len(media_ids),
            missing_character_count=missing_character_count,
            missing_series_count=missing_series_count,
            suggested_characters=suggested_characters,
            suggested_series=suggested_series,
            shared_signals=shared_signals,
            confidence=min(confidence, 0.999),
        )

    async def _collect_suggestions(
        self,
        sources: list[SuggestionSource],
    ) -> list[ImportBatchRecommendationSuggestionRead]:
        results: list[ImportBatchRecommendationSuggestionRead] = []
        for source in sources:
            if len(results) >= MAX_GROUP_SUGGESTIONS:
                source.close()
                continue
            results = self._merge_suggestions(results, await source)
        return results

    async def _infer_entity_suggestions_from_library(
        self,
        user_id: uuid.UUID,
        candidates: list[ImportBatchItem],
        entity_type: MediaEntityType,
    ) -> list[ImportBatchRecommendationSuggestionRead]:
        shared_tag_weights = self._similarity.shared_tag_weights(candidates)
        if not shared_tag_weights:
            return []

        current_media_ids = [candidate.media.id for candidate in candidates if candidate.media is not None]
        stmt = (
            select(
                MediaEntity.name.label("name"),
                MediaTag.tag_id.label("tag_id"),
                func.count(Media.id.distinct()).label("media_count"),
            )
            .join(Media, Media.id == MediaEntity.media_id)
            .join(MediaTag, MediaTag.media_id == Media.id)
            .where(
                MediaEntity.entity_type == entity_type,
                MediaEntity.name != "",
                Media.deleted_at.is_(None),
                Media.uploader_id == user_id,
                MediaTag.tag_id.in_(list(shared_tag_weights)),
                Media.id.not_in(current_media_ids),
            )
            .group_by(MediaEntity.name, MediaTag.tag_id)
        )
        rows = (await self._db.execute(stmt)).all()
        if not rows:
            return []

        name_scores: dict[str, float] = defaultdict(float)
        for row in rows:
            name = row.name.strip() if row.name else ""
            if not name:
                continue
            tag_weight = shared_tag_weights.get(int(row.tag_id), 0.0)
            media_count = int(row.media_count or 0)
            if tag_weight <= 0 or media_count <= 0:
                continue
            name_scores[name] += tag_weight * media_count

        if not name_scores:
            return []

        sorted_scores = sorted(name_scores.items(), key=lambda item: (-item[1], item[0].casefold()))
        max_score = sorted_scores[0][1] or 1.0
        return [
            ImportBatchRecommendationSuggestionRead(
                name=name,
                confidence=round(score / max_score, 3),
            )
            for name, score in sorted_scores[:MAX_GROUP_SUGGESTIONS]
        ]

    async def _infer_series_suggestions_from_characters(
        self,
        user_id: uuid.UUID,
        character_names: list[str],
    ) -> list[ImportBatchRecommendationSuggestionRead]:
        if not character_names:
            return []

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
                character_model.name.in_(character_names),
                Media.deleted_at.is_(None),
                Media.uploader_id == user_id,
            )
            .group_by(series_model.name)
            .order_by(count_expr.desc(), series_model.name.asc())
            .limit(MAX_GROUP_SUGGESTIONS)
        )
        rows = (await self._db.execute(stmt)).all()
        if not rows:
            return []

        max_count = max(int(row.media_count or 0) for row in rows) or 1
        return [
            ImportBatchRecommendationSuggestionRead(
                name=row.name,
                confidence=round((int(row.media_count or 0) / max_count), 3),
            )
            for row in rows
            if row.name
        ]

    async def _build_name_suggestions(
        self,
        candidates: list[ImportBatchItem],
        entity_type: MediaEntityType,
    ) -> list[ImportBatchRecommendationSuggestionRead]:
        entity_scores: dict[str, float] = defaultdict(float)
        for candidate in candidates:
            for entity in candidate.media.entities:
                if entity.entity_type != entity_type or not entity.name.strip():
                    continue
                entity_scores[entity.name.strip()] += entity.confidence or 1.0

        if not entity_scores:
            tag_category = 4 if entity_type == MediaEntityType.character else 3
            for candidate in candidates:
                for _, media_tag, weight in self._similarity.iter_groupable_tags(candidate, include_common=True):
                    tag = media_tag.tag
                    if tag.category != tag_category:
                        continue
                    entity_scores[tag.name.strip()] += weight

        sorted_scores = sorted(entity_scores.items(), key=lambda item: (-item[1], item[0].casefold()))
        if not sorted_scores:
            return []

        max_score = sorted_scores[0][1] or 1.0
        return [
            ImportBatchRecommendationSuggestionRead(
                name=name,
                confidence=round(score / max_score, 3),
            )
            for name, score in sorted_scores[:MAX_GROUP_SUGGESTIONS]
        ]

    def _merge_suggestions(
        self,
        primary: list[ImportBatchRecommendationSuggestionRead],
        secondary: list[ImportBatchRecommendationSuggestionRead],
    ) -> list[ImportBatchRecommendationSuggestionRead]:
        if not secondary:
            return primary[:MAX_GROUP_SUGGESTIONS]
        if not primary:
            return secondary[:MAX_GROUP_SUGGESTIONS]

        merged_scores: dict[str, float] = {}
        order: dict[str, int] = {}
        for index, suggestion in enumerate(primary):
            merged_scores[suggestion.name] = suggestion.confidence
            order.setdefault(suggestion.name, index)
        primary_count = len(order)
        for index, suggestion in enumerate(secondary):
            merged_scores[suggestion.name] = max(merged_scores.get(suggestion.name, 0.0), suggestion.confidence * 0.92)
            order.setdefault(suggestion.name, primary_count + index)

        sorted_scores = sorted(
            merged_scores.items(),
            key=lambda item: (-item[1], order.get(item[0], primary_count), item[0].casefold()),
        )
        return [
            ImportBatchRecommendationSuggestionRead(name=name, confidence=round(score, 3))
            for name, score in sorted_scores[:MAX_GROUP_SUGGESTIONS]
        ]

    def _build_named_suggestions(
        self,
        names: list[str],
    ) -> list[ImportBatchRecommendationSuggestionRead]:
        if not names:
            return []
        limited = names[:MAX_GROUP_SUGGESTIONS]
        total = len(limited)
        return [
            ImportBatchRecommendationSuggestionRead(
                name=name,
                confidence=round(max(0.55, 1.0 - (index * 0.12)), 3) if total > 1 else 1.0,
            )
            for index, name in enumerate(limited)
        ]

    def _build_shared_signals(self, candidates: list[ImportBatchItem]) -> list[ImportBatchRecommendationSignalRead]:
        tag_scores: dict[str, float] = defaultdict(float)
        phash_counts = Counter(candidate.media.phash for candidate in candidates if candidate.media.phash)
        entity_counts: Counter[str] = Counter()
        ocr_counts: Counter[str] = Counter()

        for candidate in candidates:
            for tag_name, _, weight in self._similarity.iter_groupable_tags(candidate, include_common=True):
                tag_scores[tag_name] += weight
            for entity in candidate.media.entities:
                if entity.name.strip():
                    entity_counts[entity.name.strip()] += 1
            for token in self._similarity.ocr_tokens(candidate.media.ocr_text):
                ocr_counts[token] += 1

        signals: list[ImportBatchRecommendationSignalRead] = []
        for name, score in sorted(tag_scores.items(), key=lambda item: (-item[1], item[0]))[:2]:
            signals.append(ImportBatchRecommendationSignalRead(kind="tag", label=name, confidence=round(min(score / len(candidates), 1.0), 3)))

        shared_phash = next((phash for phash, count in phash_counts.items() if count >= 2), None)
        if shared_phash:
            signals.append(ImportBatchRecommendationSignalRead(kind="visual", label="Visual match", confidence=0.9))

        for name, count in entity_counts.most_common(1):
            if count >= 2:
                signals.append(ImportBatchRecommendationSignalRead(kind="entity", label=name, confidence=round(count / len(candidates), 3)))

        for token, count in ocr_counts.most_common(1):
            if count >= 2:
                signals.append(ImportBatchRecommendationSignalRead(kind="ocr", label=token, confidence=round(count / len(candidates), 3)))

        return signals[:4]


class MediaLibraryEnrichmentService:
    def __init__(
        self,
        db: AsyncSession,
        *,
        similarity: MediaSimilarityMatcher | None = None,
    ) -> None:
        self._db = db
        self._similarity = similarity or MediaSimilarityMatcher()

    async def enrich_media(self, media_id: uuid.UUID, *, user_id: uuid.UUID) -> dict[MediaEntityType, list[str]]:
        target = await self._load_media(media_id, uploader_id=user_id)
        if target is None:
            return {}

        missing_types = [
            entity_type
            for entity_type in (MediaEntityType.character, MediaEntityType.series)
            if not self._has_non_empty_entities(target, entity_type)
        ]
        if not missing_types:
            return {}

        candidates = await self._load_candidate_media(target.id, uploader_id=user_id)
        if not candidates:
            return {}

        matches: dict[MediaEntityType, tuple[list[str], float]] = {}
        exact_phash_matches = [
            candidate for candidate in candidates
            if target.phash and candidate.phash and candidate.phash == target.phash
        ]

        for entity_type in missing_types:
            exact_match = self._pick_exact_match(exact_phash_matches, entity_type)
            if exact_match is not None:
                matches[entity_type] = exact_match
                continue

            scored_match = self._pick_scored_match(target, candidates, entity_type)
            if scored_match is not None:
                matches[entity_type] = scored_match

        if not matches:
            return {}

        entity_repo = MediaEntityRepository(self._db)
        applied: dict[MediaEntityType, list[str]] = {}
        for entity_type, (names, confidence) in matches.items():
            if not names:
                continue
            await entity_repo.add_media_entities(
                target,
                entity_type=entity_type,
                names=names,
                source="library_match",
                confidence=confidence,
                replace_existing_type=True,
            )
            applied[entity_type] = names

        if applied:
            await self._db.commit()
            logger.info(
                "Library enrichment applied media_id=%s uploader_id=%s character_names=%s series_names=%s",
                target.id,
                user_id,
                applied.get(MediaEntityType.character, []),
                applied.get(MediaEntityType.series, []),
            )

        return applied

    async def _load_media(self, media_id: uuid.UUID, *, uploader_id: uuid.UUID) -> Media | None:
        stmt = (
            select(Media)
            .options(
                selectinload(Media.entities),
                selectinload(Media.media_tags).selectinload(MediaTag.tag),
            )
            .where(
                Media.id == media_id,
                Media.uploader_id == uploader_id,
                Media.deleted_at.is_(None),
            )
        )
        return (await self._db.execute(stmt)).scalar_one_or_none()

    async def _load_candidate_media(self, media_id: uuid.UUID, *, uploader_id: uuid.UUID) -> list[Media]:
        stmt = (
            select(Media)
            .options(
                selectinload(Media.entities),
                selectinload(Media.media_tags).selectinload(MediaTag.tag),
            )
            .where(
                Media.uploader_id == uploader_id,
                Media.deleted_at.is_(None),
                Media.tagging_status == TaggingStatus.DONE,
                Media.id != media_id,
            )
        )
        return (await self._db.execute(stmt)).scalars().all()

    def _pick_exact_match(
        self,
        candidates: list[Media],
        entity_type: MediaEntityType,
    ) -> tuple[list[str], float] | None:
        if not candidates:
            return None
        grouped = self._group_candidates_by_signature(candidates, entity_type)
        if not grouped:
            return None
        if len(grouped) > 1:
            return None
        names = next(iter(grouped.values()))
        return names, EXACT_MATCH_CONFIDENCE

    def _pick_scored_match(
        self,
        target: Media,
        candidates: list[Media],
        entity_type: MediaEntityType,
    ) -> tuple[list[str], float] | None:
        target_wrapper = SimpleNamespace(media=target)
        candidate_wrappers = [SimpleNamespace(media=candidate) for candidate in candidates]
        population = [target_wrapper, *candidate_wrappers]
        batch_tag_counts = self._similarity.build_batch_tag_counts(population)
        batch_size = len(population)

        signature_scores: dict[tuple[str, ...], float] = {}
        signature_names: dict[tuple[str, ...], list[str]] = {}
        for candidate_wrapper in candidate_wrappers:
            signature = self._entity_signature(candidate_wrapper.media, entity_type)
            if not signature:
                continue
            score = self._similarity.pair_similarity(target_wrapper, candidate_wrapper, batch_tag_counts, batch_size)
            if score < LIBRARY_MATCH_SCORE_THRESHOLD:
                continue
            signature_scores[signature] = max(signature_scores.get(signature, 0.0), score)
            signature_names.setdefault(signature, self._entity_names(candidate_wrapper.media, entity_type))

        if not signature_scores:
            return None

        ranked = sorted(signature_scores.items(), key=lambda item: (-item[1], item[0]))
        top_signature, top_score = ranked[0]
        runner_up_score = ranked[1][1] if len(ranked) > 1 else None
        if runner_up_score is not None and (top_score - runner_up_score) < LIBRARY_MATCH_SCORE_MARGIN:
            return None

        return signature_names[top_signature], round(top_score, 3)

    def _group_candidates_by_signature(
        self,
        candidates: list[Media],
        entity_type: MediaEntityType,
    ) -> dict[tuple[str, ...], list[str]]:
        grouped: dict[tuple[str, ...], list[str]] = {}
        for candidate in candidates:
            signature = self._entity_signature(candidate, entity_type)
            if not signature:
                continue
            grouped.setdefault(signature, self._entity_names(candidate, entity_type))
        return grouped

    def _entity_signature(self, media: Media, entity_type: MediaEntityType) -> tuple[str, ...]:
        normalized = sorted({
            name.casefold()
            for name in self._entity_names(media, entity_type)
        })
        return tuple(normalized)

    def _entity_names(self, media: Media, entity_type: MediaEntityType) -> list[str]:
        names: list[str] = []
        seen: set[str] = set()
        for entity in media.entities:
            if entity.entity_type != entity_type:
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

    def _has_non_empty_entities(self, media: Media, entity_type: MediaEntityType) -> bool:
        return any(
            entity.entity_type == entity_type and entity.name.strip()
            for entity in media.entities
        )
