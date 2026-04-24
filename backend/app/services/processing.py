from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Coroutine
from datetime import datetime, timezone
from itertools import combinations
import logging
import math
import re
import uuid
from typing import Any

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from backend.app.errors.error import AppError
from backend.app.models.auth import User
from backend.app.models.media import Media, TaggingStatus
from backend.app.models.relations import MediaEntity, MediaEntityType
from backend.app.models.processing import BatchStatus, BatchType, ImportBatch, ImportBatchItem, ItemStatus, ProcessingStep
from backend.app.models.tags import MediaTag
from backend.app.repositories.media_interactions import UserFavoriteRepository
from backend.app.repositories.processing import ImportBatchItemRepository, ImportBatchRepository
from backend.app.services.library_classification import MediaLibraryEnrichmentService
from backend.app.services.library_matching import MediaSimilarityMatcher
from backend.app.schemas import (
    ImportBatchItemListResponse,
    ImportBatchListResponse,
    ImportBatchMergedReviewResponse,
    ImportBatchRead,
    ImportBatchRecommendationGroupRead,
    ImportBatchRecommendationSignalRead,
    ImportBatchRecommendationSuggestionRead,
    ImportBatchReviewItemRead,
    ImportBatchReviewListResponse,
    ImportBatchReviewSummaryResponse,
)
from backend.app.utils.media_projections import build_media_read
from backend.app.utils.pagination import apply_cursor_where_expr, decode_cursor_typed, encode_cursor

TOKEN_RE = re.compile(r"[a-z0-9]+")
MAX_GROUP_SUGGESTIONS = 3
TAG_SIMILARITY_THRESHOLD = 0.34
PAIR_SCORE_THRESHOLD = 0.36

logger = logging.getLogger(__name__)

SuggestionSource = Coroutine[Any, Any, list[ImportBatchRecommendationSuggestionRead]]


async def _resolved(value: list[ImportBatchRecommendationSuggestionRead]) -> list[ImportBatchRecommendationSuggestionRead]:
    return value


class ProcessingService:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db
        self._library_enrichment = MediaLibraryEnrichmentService(db)
        self._similarity = MediaSimilarityMatcher()

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

    async def list_all_review_items(
        self,
        user_id: uuid.UUID,
        *,
        include_recommendations: bool = False,
    ) -> ImportBatchReviewListResponse:
        candidates = await ImportBatchItemRepository(self._db).list_all_review_candidates_for_user(
            user_id,
            batch_types=[BatchType.upload],
        )
        items, review_candidates = await self._build_review_items_from_candidates(
            candidates,
            user_id,
            include_suggestions=include_recommendations,
        )

        recommendation_groups: list[ImportBatchRecommendationGroupRead] = []
        if include_recommendations:
            logger.info(
                "Building cross-batch recommendations user_id=%s review_item_count=%d",
                user_id,
                len(items),
            )
            recommendation_groups = await self._build_recommendation_groups(items, review_candidates, user_id)

        return ImportBatchReviewListResponse(
            total=len(items),
            items=items,
            recommendation_groups=recommendation_groups,
        )

    async def merge_review_batches(
        self,
        user_id: uuid.UUID,
        *,
        include_recommendations: bool = False,
        force_refresh: bool = False,
    ) -> ImportBatchMergedReviewResponse:
        batch_repo = ImportBatchRepository(self._db)
        merged_batch = await batch_repo.get_latest_for_user_by_type(user_id, BatchType.review_merge)

        if merged_batch is None:
            merged_batch = ImportBatch(
                user_id=user_id,
                type=BatchType.review_merge,
                status=BatchStatus.done,
                total_items=0,
                queued_items=0,
                processing_items=0,
                done_items=0,
                failed_items=0,
            )
            self._db.add(merged_batch)
            await self._db.flush()
            force_refresh = True

        if not force_refresh and await self._merged_review_batch_needs_refresh(merged_batch, user_id):
            force_refresh = True

        if force_refresh:
            await self._refresh_merged_review_batch(merged_batch, user_id)

        review = await self.list_batch_review_items(
            merged_batch.id,
            user_id,
            include_recommendations=include_recommendations,
            force_refresh=force_refresh,
        )
        return ImportBatchMergedReviewResponse(
            merged_batch_id=merged_batch.id,
            **review.model_dump(),
        )

    async def get_review_summary(self, user_id: uuid.UUID) -> ImportBatchReviewSummaryResponse:
        rows = await ImportBatchItemRepository(self._db).list_review_summary_for_user(user_id)
        unresolved_count = sum(unresolved for _, _, unresolved in rows)
        review_batch_ids = [batch_id for batch_id, _, _ in rows]

        latest_batch_id: uuid.UUID | None = None
        latest_batch_created_at: datetime | None = None
        if rows:
            latest_batch_id, latest_batch_created_at, _ = rows[0]

        return ImportBatchReviewSummaryResponse(
            unresolved_count=unresolved_count,
            review_batch_ids=review_batch_ids,
            latest_batch_id=latest_batch_id,
            latest_batch_created_at=latest_batch_created_at,
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
        items, review_candidates = await self._build_review_items_from_candidates(
            candidates,
            user_id,
            include_suggestions=include_recommendations,
        )

        recommendation_groups: list[ImportBatchRecommendationGroupRead] = []
        if include_recommendations:
            if not force_refresh and isinstance(batch.recommendation_groups, list):
                logger.info(
                    "Recommendations served from cache batch_id=%s group_count=%d",
                    batch_id,
                    len(batch.recommendation_groups),
                )
                recommendation_groups = [
                    ImportBatchRecommendationGroupRead.model_validate(g)
                    for g in batch.recommendation_groups
                ]
            else:
                logger.info(
                    "Building recommendations batch_id=%s review_item_count=%d force_refresh=%s",
                    batch_id,
                    len(items),
                    force_refresh,
                )
                recommendation_groups = await self._build_recommendation_groups(items, review_candidates, user_id)
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

    async def _build_review_items_from_candidates(
        self,
        candidates: list[ImportBatchItem],
        user_id: uuid.UUID,
        *,
        include_suggestions: bool = False,
    ) -> tuple[list[ImportBatchReviewItemRead], list[ImportBatchItem]]:
        media_ids = [item.media.id for item in candidates if item.media is not None]
        favorite_repo = UserFavoriteRepository(self._db)
        favorited = await favorite_repo.get_favorited_ids(user_id, media_ids)
        favorite_counts = await favorite_repo.get_favorite_counts(media_ids)
        library_suggestions_enabled = include_suggestions and await self._is_library_classification_enabled(user_id)

        items: list[ImportBatchReviewItemRead] = []
        review_candidates: list[ImportBatchItem] = []
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

            suggested_characters: list[ImportBatchRecommendationSuggestionRead] = []
            suggested_series: list[ImportBatchRecommendationSuggestionRead] = []
            if library_suggestions_enabled and media.uploader_id == user_id:
                result = await self._library_enrichment.enrich_media(
                    media.id,
                    user_id=user_id,
                    apply=False,
                    target_media=media,
                )
                suggested_characters = result.suggestions.get(MediaEntityType.character, [])
                suggested_series = result.suggestions.get(MediaEntityType.series, [])

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
                    suggested_characters=suggested_characters,
                    suggested_series=suggested_series,
                )
            )
            review_candidates.append(item)

        if include_suggestions:
            await self._db.commit()

        return items, review_candidates

    async def _is_library_classification_enabled(self, user_id: uuid.UUID) -> bool:
        user = await self._db.get(User, user_id)
        return isinstance(user, User) and bool(user.library_classification_enabled)

    async def _load_deduped_review_candidates_for_user(self, user_id: uuid.UUID) -> list[ImportBatchItem]:
        candidates = await ImportBatchItemRepository(self._db).list_all_review_candidates_for_user(
            user_id,
            batch_types=[BatchType.upload],
        )
        _, review_candidates = await self._build_review_items_from_candidates(candidates, user_id)

        deduped_candidates: list[ImportBatchItem] = []
        seen_media_ids: set[uuid.UUID] = set()
        for candidate in review_candidates:
            media = candidate.media
            if media is None or media.id in seen_media_ids:
                continue
            seen_media_ids.add(media.id)
            deduped_candidates.append(candidate)

        return deduped_candidates

    async def _merged_review_batch_needs_refresh(self, merged_batch: ImportBatch, user_id: uuid.UUID) -> bool:
        deduped_candidates = await self._load_deduped_review_candidates_for_user(user_id)
        current_media_ids = {candidate.media.id for candidate in deduped_candidates if candidate.media is not None}
        existing_media_ids = [
            media_id
            for media_id in (
                await self._db.execute(
                    select(ImportBatchItem.media_id)
                    .where(ImportBatchItem.batch_id == merged_batch.id, ImportBatchItem.media_id.is_not(None))
                    .order_by(ImportBatchItem.updated_at.desc(), ImportBatchItem.id.desc())
                )
            ).scalars().all()
            if media_id is not None
        ]
        return set(existing_media_ids) != current_media_ids

    async def _refresh_merged_review_batch(self, merged_batch: ImportBatch, user_id: uuid.UUID) -> None:
        deduped_candidates = await self._load_deduped_review_candidates_for_user(user_id)

        await self._db.execute(
            delete(ImportBatchItem).where(ImportBatchItem.batch_id == merged_batch.id)
        )
        for candidate in deduped_candidates:
            self._db.add(
                ImportBatchItem(
                    batch_id=merged_batch.id,
                    media_id=candidate.media_id,
                    source_filename=candidate.source_filename,
                    status=ItemStatus.done,
                    step=ProcessingStep.tag,
                    progress_percent=100,
                )
            )

        now = datetime.now(timezone.utc)
        merged_batch.status = BatchStatus.done
        merged_batch.total_items = len(deduped_candidates)
        merged_batch.queued_items = 0
        merged_batch.processing_items = 0
        merged_batch.done_items = len(deduped_candidates)
        merged_batch.failed_items = 0
        merged_batch.started_at = now
        merged_batch.finished_at = now
        merged_batch.last_heartbeat_at = now
        merged_batch.error_summary = None
        merged_batch.recommendation_groups = None
        merged_batch.recommendations_computed_at = None
        await self._db.commit()

    async def _build_recommendation_groups(
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
                remaining, review_item_by_media_id, len(groups), user_id
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

        for bucket_candidates in sorted(character_buckets.values(), key=len, reverse=True):
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
        rows = self._result_rows(await self._db.execute(stmt))
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
        rows = self._result_rows(await self._db.execute(stmt))
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
        return self._similarity.pair_similarity(left, right, batch_tag_counts, batch_size)

    def _iter_groupable_tags(
        self,
        candidate: ImportBatchItem,
        *,
        include_common: bool = False,
    ) -> list[tuple[str, object, float]]:
        return self._similarity.iter_groupable_tags(candidate, include_common=include_common)

    def _tag_weight_map(
        self,
        candidate: ImportBatchItem,
        batch_tag_counts: Counter[str],
        batch_size: int,
    ) -> dict[str, float]:
        return self._similarity.tag_weight_map(candidate, batch_tag_counts, batch_size)

    def _shared_tag_weights(self, candidates: list[ImportBatchItem]) -> dict[int, float]:
        return self._similarity.shared_tag_weights(candidates)

    def _entity_tokens(self, media) -> set[str]:
        return self._similarity.entity_tokens(media)

    def _ocr_tokens(self, text: str | None) -> set[str]:
        return self._similarity.ocr_tokens(text)

    def _weighted_jaccard(self, left: dict[str, float], right: dict[str, float]) -> float:
        return self._similarity.weighted_jaccard(left, right)

    def _token_jaccard(self, left: set[str], right: set[str]) -> float:
        return self._similarity.token_jaccard(left, right)

    def _result_rows(self, result: Any) -> list[Any]:
        if result is None:
            return []
        all_rows = getattr(result, "all", None)
        if callable(all_rows):
            return list(all_rows())
        return []
