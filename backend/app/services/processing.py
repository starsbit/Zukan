from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Coroutine
from dataclasses import dataclass
from datetime import datetime, timezone
from itertools import combinations
import math
import re
import uuid
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from backend.app.errors.error import AppError
from backend.app.models.media import Media, TaggingStatus
from backend.app.models.relations import MediaEntity, MediaEntityType
from backend.app.models.processing import ImportBatch, ImportBatchItem
from backend.app.models.tags import MediaTag
from backend.app.repositories.media_interactions import UserFavoriteRepository
from backend.app.repositories.processing import ImportBatchItemRepository, ImportBatchRepository
from backend.app.schemas import (
    ImportBatchItemListResponse,
    ImportBatchListResponse,
    ImportBatchRead,
    ImportBatchRecommendationGroupRead,
    ImportBatchRecommendationSignalRead,
    ImportBatchRecommendationSuggestionRead,
    ImportBatchReviewItemRead,
    ImportBatchReviewListResponse,
)
from backend.app.utils.media_projections import build_media_read
from backend.app.utils.pagination import apply_cursor_where_expr, decode_cursor_typed, encode_cursor

TOKEN_RE = re.compile(r"[a-z0-9]+")
MAX_GROUP_SUGGESTIONS = 3
TAG_SIMILARITY_THRESHOLD = 0.34
PAIR_SCORE_THRESHOLD = 0.36

SuggestionSource = Coroutine[Any, Any, list[ImportBatchRecommendationSuggestionRead]]


@dataclass
class AniListResolution:
    candidate: ImportBatchItem
    character_name: str
    series_titles: list[str]


async def _resolved(value: list[ImportBatchRecommendationSuggestionRead]) -> list[ImportBatchRecommendationSuggestionRead]:
    return value


class ProcessingService:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def list_batches(
        self,
        user_id: uuid.UUID,
        *,
        after: str | None = None,
        page_size: int = 20,
    ) -> ImportBatchListResponse:
        repo = ImportBatchRepository(self._db)
        total = await repo.count_for_user(user_id)
        stmt = select(ImportBatch).where(ImportBatch.user_id == user_id)

        if after:
            decoded = decode_cursor_typed(after, "datetime")
            if decoded is not None:
                cursor_val, cursor_id = decoded
                stmt = apply_cursor_where_expr(
                    stmt,
                    sort_expr=ImportBatch.created_at,
                    id_expr=ImportBatch.id,
                    sort_order="desc",
                    cursor_val=cursor_val,
                    cursor_id=cursor_id,
                )

        rows = (await self._db.execute(stmt.order_by(ImportBatch.created_at.desc(), ImportBatch.id.desc()).limit(page_size + 1))).scalars().all()
        has_more = len(rows) > page_size
        rows = rows[:page_size]

        next_cursor = None
        if has_more and rows:
            last = rows[-1]
            next_cursor = encode_cursor(last.created_at, last.id)

        return ImportBatchListResponse(
            total=total,
            next_cursor=next_cursor,
            has_more=has_more,
            page_size=page_size,
            items=list(rows),
        )

    async def get_batch_for_user(self, batch_id: uuid.UUID, user_id: uuid.UUID) -> ImportBatch:
        batch = await ImportBatchRepository(self._db).get_by_id_for_user(batch_id, user_id)
        if batch is None:
            raise AppError(status_code=404, code="batch_not_found", detail="Batch not found")
        return batch

    async def list_batch_items(
        self,
        batch_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        after: str | None = None,
        page_size: int = 50,
    ) -> ImportBatchItemListResponse:
        await self.get_batch_for_user(batch_id, user_id)
        total = await ImportBatchItemRepository(self._db).count_for_batch(batch_id)
        stmt = select(ImportBatchItem).where(ImportBatchItem.batch_id == batch_id)

        if after:
            decoded = decode_cursor_typed(after, "datetime")
            if decoded is not None:
                cursor_val, cursor_id = decoded
                stmt = apply_cursor_where_expr(
                    stmt,
                    sort_expr=ImportBatchItem.updated_at,
                    id_expr=ImportBatchItem.id,
                    sort_order="desc",
                    cursor_val=cursor_val,
                    cursor_id=cursor_id,
                )

        rows = (
            await self._db.execute(
                stmt.order_by(ImportBatchItem.updated_at.desc(), ImportBatchItem.id.desc()).limit(page_size + 1)
            )
        ).scalars().all()
        has_more = len(rows) > page_size
        rows = rows[:page_size]

        next_cursor = None
        if has_more and rows:
            last = rows[-1]
            next_cursor = encode_cursor(last.updated_at, last.id)

        return ImportBatchItemListResponse(
            total=total,
            next_cursor=next_cursor,
            has_more=has_more,
            page_size=page_size,
            items=list(rows),
        )

    async def list_batch_review_items(
        self,
        batch_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        include_recommendations: bool = False,
        force_refresh: bool = False,
    ) -> ImportBatchReviewListResponse:
        batch = await self.get_batch_for_user(batch_id, user_id)
        candidates = await ImportBatchItemRepository(self._db).list_review_candidates_for_batch(batch_id)
        media_ids = [item.media.id for item in candidates if item.media is not None]
        favorite_repo = UserFavoriteRepository(self._db)
        favorited = await favorite_repo.get_favorited_ids(user_id, media_ids)
        favorite_counts = await favorite_repo.get_favorite_counts(media_ids)

        items: list[ImportBatchReviewItemRead] = []
        for item in candidates:
            media = item.media
            if media is None or media.deleted_at is not None or media.tagging_status != TaggingStatus.DONE:
                continue
            if media.metadata_review_dismissed:
                continue

            has_character = any(entity.entity_type == MediaEntityType.character and entity.name.strip() for entity in media.entities)
            has_series = any(entity.entity_type == MediaEntityType.series and entity.name.strip() for entity in media.entities)
            if has_character and has_series:
                continue

            items.append(
                ImportBatchReviewItemRead(
                    batch_item_id=item.id,
                    media=build_media_read(media, media.id in favorited, favorite_counts.get(media.id, 0)),
                    entities=[
                        {
                            "id": entity.id,
                            "entity_type": entity.entity_type,
                            "entity_id": entity.entity_id,
                            "name": entity.name,
                            "role": entity.role,
                            "source": entity.source,
                            "confidence": entity.confidence,
                        }
                        for entity in media.entities
                    ],
                    source_filename=item.source_filename,
                    missing_character=not has_character,
                    missing_series=not has_series,
                )
            )

        recommendation_groups: list[ImportBatchRecommendationGroupRead] = []
        if include_recommendations:
            if not force_refresh and isinstance(batch.recommendation_groups, list):
                recommendation_groups = [
                    ImportBatchRecommendationGroupRead.model_validate(g)
                    for g in batch.recommendation_groups
                ]
            else:
                recommendation_groups = await self._build_recommendation_groups(items, candidates, user_id)
                serialized = [g.model_dump(mode="json") for g in recommendation_groups]
                await self._db.execute(
                    update(ImportBatch)
                    .where(ImportBatch.id == batch_id)
                    .values(
                        recommendation_groups=serialized,
                        recommendations_computed_at=datetime.now(timezone.utc),
                    )
                )
                await self._db.commit()

        return ImportBatchReviewListResponse(
            total=len(items),
            items=items,
            recommendation_groups=recommendation_groups,
        )

    async def _build_recommendation_groups(
        self,
        review_items: list[ImportBatchReviewItemRead],
        candidates: list[ImportBatchItem],
        user_id: uuid.UUID,
    ) -> list[ImportBatchRecommendationGroupRead]:
        review_item_by_media_id = {item.media.id: item for item in review_items}
        review_candidates = [candidate for candidate in candidates if candidate.media and candidate.media.id in review_item_by_media_id]
        if len(review_candidates) < 2:
            return []

        groups: list[ImportBatchRecommendationGroupRead] = []

        anilist_token = await self._get_anilist_token(user_id)
        anilist_groups, grouped_ids = await self._build_anilist_series_groups(
            review_candidates, review_item_by_media_id, user_id, anilist_token, len(groups)
        )
        groups.extend(anilist_groups)

        remaining = [c for c in review_candidates if c.media.id not in grouped_ids]
        if len(remaining) >= 2:
            entity_groups, entity_grouped_ids = await self._build_entity_name_groups(
                remaining, review_item_by_media_id, len(groups), user_id
            )
            groups.extend(entity_groups)
            grouped_ids |= entity_grouped_ids

        remaining = [c for c in review_candidates if c.media.id not in grouped_ids]
        if len(remaining) >= 2:
            groups.extend(await self._build_similarity_groups(remaining, review_item_by_media_id, len(groups), user_id))

        groups.sort(key=lambda group: (-group.confidence, -group.item_count, group.id))
        return groups

    async def _build_anilist_series_groups(
        self,
        candidates: list[ImportBatchItem],
        review_item_by_media_id: dict[uuid.UUID, ImportBatchReviewItemRead],
        user_id: uuid.UUID,
        anilist_token: str | None,
        group_index_start: int,
    ) -> tuple[list[ImportBatchRecommendationGroupRead], set[uuid.UUID]]:
        from backend.app.services.anilist import search_character_series

        eligible = [
            c for c in candidates
            if review_item_by_media_id[c.media.id].missing_series
            and not review_item_by_media_id[c.media.id].missing_character
        ]
        if len(eligible) < 2:
            return [], set()

        resolutions: list[AniListResolution] = []
        char_buckets: dict[str, list[ImportBatchItem]] = defaultdict(list)
        series_titles_by_character: dict[str, list[str]] = {}
        for candidate in eligible:
            char_name = next(
                (e.name.strip() for e in candidate.media.entities if e.entity_type == MediaEntityType.character and e.name.strip()),
                None,
            )
            if char_name is None:
                continue
            char_key = char_name.casefold()
            series_titles = series_titles_by_character.get(char_key)
            if series_titles is None:
                series_titles = await search_character_series(char_name, token=anilist_token)
                series_titles_by_character[char_key] = series_titles
            resolutions.append(AniListResolution(candidate=candidate, character_name=char_name, series_titles=series_titles))
            char_buckets[char_key].append(candidate)

        groups: list[ImportBatchRecommendationGroupRead] = []
        grouped_ids: set[uuid.UUID] = set()
        exact_char_media_ids = {
            candidate.media.id
            for bucket in char_buckets.values()
            if len(bucket) >= 2
            for candidate in bucket
        }

        series_buckets: dict[str, dict[str, Any]] = {}
        for resolution in resolutions:
            for rank, title in enumerate(resolution.series_titles):
                key = title.casefold()
                bucket = series_buckets.setdefault(key, {
                    "series_title": title,
                    "resolutions": [],
                    "series_rank_sum": 0,
                })
                bucket["resolutions"].append(resolution)
                bucket["series_rank_sum"] += rank

        ranked_buckets: list[tuple[float, dict[str, Any]]] = []
        for bucket in series_buckets.values():
            bucket_resolutions: list[AniListResolution] = bucket["resolutions"]
            media_ids = {resolution.candidate.media.id for resolution in bucket_resolutions}
            if len(media_ids) < 2:
                continue

            distinct_characters = {resolution.character_name.casefold() for resolution in bucket_resolutions}
            average_rank = bucket["series_rank_sum"] / len(bucket_resolutions)
            repeated_character_matches = sum(
                1 for resolution in bucket_resolutions if resolution.candidate.media.id in exact_char_media_ids
            )
            score = (
                len(media_ids) * 1.0
                + len(distinct_characters) * 0.45
                + repeated_character_matches * 0.2
                + max(0.0, 1.0 - average_rank * 0.25)
            )
            ranked_buckets.append((score, bucket))

        ranked_buckets.sort(
            key=lambda item: (
                -item[0],
                -len({resolution.candidate.media.id for resolution in item[1]["resolutions"]}),
                item[1]["series_title"].casefold(),
            )
        )

        for score, bucket in ranked_buckets:
            bucket_resolutions = [
                resolution for resolution in bucket["resolutions"]
                if resolution.candidate.media.id not in grouped_ids
            ]
            media_ids = {resolution.candidate.media.id for resolution in bucket_resolutions}
            if len(media_ids) < 2:
                continue

            unique_candidates = list({
                resolution.candidate.media.id: resolution.candidate
                for resolution in bucket_resolutions
            }.values())
            confidences = [1.0, 0.9, 0.8]
            extra_series_suggestions = [
                ImportBatchRecommendationSuggestionRead(name=bucket["series_title"], confidence=confidences[0])
            ]
            related_titles = [
                title
                for title in self._merge_suggestions(
                    [],
                    [
                        ImportBatchRecommendationSuggestionRead(name=title, confidence=confidences[min(rank, len(confidences) - 1)])
                        for resolution in bucket_resolutions
                        for rank, title in enumerate(resolution.series_titles)
                    ],
                )
                if title.name.casefold() != bucket["series_title"].casefold()
            ]
            extra_series_suggestions.extend(related_titles[: MAX_GROUP_SUGGESTIONS - 1])
            confidence = min(0.999, round(0.55 + min(score, 4.0) * 0.1, 3))

            group = await self._build_recommendation_group(
                unique_candidates,
                review_item_by_media_id,
                {},
                group_index_start + len(groups),
                user_id,
                extra_series_suggestions=extra_series_suggestions,
                confidence_override=confidence,
            )
            groups.append(group)
            grouped_ids.update(media_ids)

        return groups, grouped_ids

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
        batch_tag_counts = Counter()
        for candidate in candidates:
            for tag_name, _, _ in self._iter_groupable_tags(candidate):
                batch_tag_counts[tag_name] += 1

        adjacency: dict[uuid.UUID, set[uuid.UUID]] = defaultdict(set)
        pair_scores: dict[frozenset[uuid.UUID], float] = {}

        for left, right in combinations(candidates, 2):
            score = self._pair_similarity(left, right, batch_tag_counts, len(candidates))
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

            component_candidates = [c for c in candidates if c.media.id in set(component_ids)]
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
        pair_values = [
            pair_scores[key]
            for key in pair_scores
            if key.issubset(set(media_ids))
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

    async def _get_anilist_token(self, user_id: uuid.UUID) -> str | None:
        from backend.app.repositories.integrations import UserIntegrationRepository
        from backend.app.models.integrations import IntegrationService
        record = await UserIntegrationRepository(self._db).get_by_user_and_service(user_id, IntegrationService.anilist)
        return record.token if record else None

    async def _infer_entity_suggestions_from_library(
        self,
        user_id: uuid.UUID,
        candidates: list[ImportBatchItem],
        entity_type: MediaEntityType,
    ) -> list[ImportBatchRecommendationSuggestionRead]:
        shared_tag_weights = self._shared_tag_weights(candidates)
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
                for _, media_tag, weight in self._iter_groupable_tags(candidate, include_common=True):
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

    def _build_shared_signals(self, candidates: list[ImportBatchItem]) -> list[ImportBatchRecommendationSignalRead]:
        tag_scores: dict[str, float] = defaultdict(float)
        phash_counts = Counter(candidate.media.phash for candidate in candidates if candidate.media.phash)
        entity_counts: Counter[str] = Counter()
        ocr_counts: Counter[str] = Counter()

        for candidate in candidates:
            for tag_name, _, weight in self._iter_groupable_tags(candidate, include_common=True):
                tag_scores[tag_name] += weight
            for entity in candidate.media.entities:
                if entity.name.strip():
                    entity_counts[entity.name.strip()] += 1
            for token in self._ocr_tokens(candidate.media.ocr_text):
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

    def _pair_similarity(
        self,
        left: ImportBatchItem,
        right: ImportBatchItem,
        batch_tag_counts: Counter[str],
        batch_size: int,
    ) -> float:
        left_tags = self._tag_weight_map(left, batch_tag_counts, batch_size)
        right_tags = self._tag_weight_map(right, batch_tag_counts, batch_size)
        similarity = self._weighted_jaccard(left_tags, right_tags)
        if similarity >= TAG_SIMILARITY_THRESHOLD:
            similarity += 0.08

        left_media = left.media
        right_media = right.media
        if left_media.phash and left_media.phash == right_media.phash:
            similarity += 0.22

        similarity += 0.16 * self._token_jaccard(self._ocr_tokens(left_media.ocr_text), self._ocr_tokens(right_media.ocr_text))
        similarity += 0.24 * self._token_jaccard(self._entity_tokens(left_media), self._entity_tokens(right_media))
        return min(similarity, 0.99)

    def _iter_groupable_tags(
        self,
        candidate: ImportBatchItem,
        *,
        include_common: bool = False,
    ) -> list[tuple[str, object, float]]:
        tags: list[tuple[str, object, float]] = []
        for media_tag in candidate.media.media_tags:
            tag = media_tag.tag
            normalized = self._normalize_token(tag.name)
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

    def _tag_weight_map(
        self,
        candidate: ImportBatchItem,
        batch_tag_counts: Counter[str],
        batch_size: int,
    ) -> dict[str, float]:
        weights: dict[str, float] = {}
        common_threshold = max(3, math.ceil(batch_size * 0.6))
        for normalized, _, weight in self._iter_groupable_tags(candidate):
            if batch_tag_counts[normalized] >= common_threshold:
                continue
            weights[normalized] = max(weights.get(normalized, 0.0), weight)
        return weights

    def _shared_tag_weights(self, candidates: list[ImportBatchItem]) -> dict[int, float]:
        if len(candidates) < 2:
            return {}

        tag_weights: dict[int, float] = defaultdict(float)
        tag_counts: Counter[int] = Counter()
        for candidate in candidates:
            per_candidate_weights: dict[int, float] = {}
            for _, media_tag, weight in self._iter_groupable_tags(candidate):
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

    def _entity_tokens(self, media) -> set[str]:
        tokens: set[str] = set()
        for entity in media.entities:
            normalized = self._normalize_token(entity.name)
            if normalized:
                tokens.add(normalized)
        return tokens

    def _ocr_tokens(self, text: str | None) -> set[str]:
        if not text:
            return set()
        return {token for token in TOKEN_RE.findall(text.casefold()) if len(token) >= 3}

    def _weighted_jaccard(self, left: dict[str, float], right: dict[str, float]) -> float:
        if not left or not right:
            return 0.0
        keys = set(left) | set(right)
        intersection = sum(min(left.get(key, 0.0), right.get(key, 0.0)) for key in keys)
        union = sum(max(left.get(key, 0.0), right.get(key, 0.0)) for key in keys)
        return intersection / union if union else 0.0

    def _token_jaccard(self, left: set[str], right: set[str]) -> float:
        if not left or not right:
            return 0.0
        return len(left & right) / len(left | right)

    def _normalize_token(self, value: str | None) -> str:
        if not value:
            return ""
        normalized = " ".join(TOKEN_RE.findall(value.replace("_", " ").casefold()))
        return normalized.strip()
