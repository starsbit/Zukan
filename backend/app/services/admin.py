from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import uuid
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.app.database import AsyncSessionLocal
from backend.app.config import settings
from backend.app.errors.auth import duplicate_username, forbidden, user_not_found
from backend.app.errors.error import AppError
from backend.app.ml.embedding import EMBEDDING_MODEL_VERSION
from backend.app.models.auth import User
from backend.app.models.embeddings import MediaEmbedding
from backend.app.models.library_classification import LibraryClassificationFeedback, LibraryClassificationFeedbackAction
from backend.app.models.media import Media, TaggingStatus
from backend.app.models.processing import BatchStatus, BatchType, ImportBatch, ImportBatchItem, ItemStatus, ProcessingStep
from backend.app.models.relations import MediaEntity, MediaEntityType
from backend.app.models.tags import MediaTag
from backend.app.repositories.auth import UserRepository
from backend.app.repositories.media import MediaRepository
from backend.app.runtime import health_monitor
from backend.app.schemas import (
    AdminEmbeddingBackfillResponse,
    AdminEmbeddingBackfillStatus,
    AdminEmbeddingClusterListResponse,
    AdminEmbeddingClusterRead,
    AdminEmbeddingClusterSampleRead,
    AdminEmbeddingScoreBreakdownRead,
    AdminHealthResponse,
    AdminHealthSample,
    AdminLibraryClassificationMetricsResponse,
    AdminLibraryClassificationSourceMetricsRead,
    AdminStatsResponse,
    AdminUserDetail,
    AdminUserListResponse,
    AdminUserSummary,
    AdminUserUpdate,
    UserRead,
)
from backend.app.services.embedding_backfill import get_embedding_backfill_queue
from backend.app.services.embeddings import MediaEmbeddingService
from backend.app.services.hybrid_similarity import (
    HybridScore,
    HybridScoreBreakdown,
    HybridSimilarityScorer,
    MediaSimilarityProfile,
    centroid,
    cosine_similarity,
)
from backend.app.services.media import get_tag_queue
from backend.app.services.media.lifecycle import MediaLifecycleService
from backend.app.services.media.query import MediaQueryService
from backend.app.utils.passwords import hash_password

logger = logging.getLogger("backend.app.admin")

_EMBEDDING_CLUSTER_CACHE_TTL = timedelta(hours=24)


@dataclass
class _EmbeddingClusterCacheEntry:
    generated_at: datetime
    payload: Any


def _embedding_cluster_cache_key(*, kind: str, parts: dict[str, Any]) -> str:
    encoded = json.dumps(parts, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(encoded.encode("utf-8")).hexdigest()
    return f"{kind}-{digest}"


class _EmbeddingClusterCache:
    def __init__(self, root: Path, ttl: timedelta) -> None:
        self._root = root
        self._ttl = ttl
        self._locks: dict[str, asyncio.Lock] = {}
        self._refresh_tasks: set[asyncio.Task[None]] = set()
        self._refreshing_keys: set[str] = set()

    def _cache_dir(self, kind: str) -> Path:
        return self._root / kind

    def _response_path(self, key: str) -> Path:
        return self._cache_dir("responses") / f"{key}.json"

    def _plot_path(self, key: str) -> Path:
        return self._cache_dir("plots") / f"{key}.png"

    def _plot_meta_path(self, key: str) -> Path:
        return self._cache_dir("plots") / f"{key}.meta.json"

    def _lock_for(self, key: str) -> asyncio.Lock:
        lock = self._locks.get(key)
        if lock is None:
            lock = asyncio.Lock()
            self._locks[key] = lock
        return lock

    def _is_fresh(self, generated_at: datetime) -> bool:
        return datetime.now(timezone.utc) - generated_at < self._ttl

    def _load_response_entry(self, path: Path) -> _EmbeddingClusterCacheEntry | None:
        if not path.exists():
            return None
        raw = json.loads(path.read_text(encoding="utf-8"))
        return _EmbeddingClusterCacheEntry(
            generated_at=datetime.fromisoformat(raw["generated_at"]),
            payload=AdminEmbeddingClusterListResponse.model_validate(raw["response"]),
        )

    def _write_response_entry(self, path: Path, response: AdminEmbeddingClusterListResponse) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "response": response.model_dump(mode="json"),
        }
        path.write_text(json.dumps(payload, sort_keys=True, separators=(",", ":")), encoding="utf-8")

    def _load_plot_entry(self, key: str) -> _EmbeddingClusterCacheEntry | None:
        meta_path = self._plot_meta_path(key)
        plot_path = self._plot_path(key)
        if not meta_path.exists() or not plot_path.exists():
            return None
        raw = json.loads(meta_path.read_text(encoding="utf-8"))
        return _EmbeddingClusterCacheEntry(
            generated_at=datetime.fromisoformat(raw["generated_at"]),
            payload=plot_path.read_bytes(),
        )

    def _write_plot_entry(self, key: str, image: bytes) -> None:
        meta_path = self._plot_meta_path(key)
        plot_path = self._plot_path(key)
        plot_path.parent.mkdir(parents=True, exist_ok=True)
        plot_path.write_bytes(image)
        meta_path.write_text(
            json.dumps({"generated_at": datetime.now(timezone.utc).isoformat()}, sort_keys=True, separators=(",", ":")),
            encoding="utf-8",
        )

    def _track_refresh_task(self, task: asyncio.Task[None]) -> None:
        self._refresh_tasks.add(task)

        def _cleanup(done_task: asyncio.Task[None]) -> None:
            self._refresh_tasks.discard(done_task)

        task.add_done_callback(_cleanup)

    async def get_cluster_response(
        self,
        *,
        key: str,
        build: Callable[["AdminService"], Awaitable[AdminEmbeddingClusterListResponse]],
    ) -> AdminEmbeddingClusterListResponse:
        path = self._response_path(key)
        cached = self._load_response_entry(path)
        if cached is not None:
            if not self._is_fresh(cached.generated_at):
                self._schedule_response_refresh(key=key, build=build)
            return cached.payload

        async with self._lock_for(key):
            cached = self._load_response_entry(path)
            if cached is not None:
                if not self._is_fresh(cached.generated_at):
                    self._schedule_response_refresh(key=key, build=build)
                return cached.payload

            response = await self._build_response(build)
            self._write_response_entry(path, response)
            return response

    async def get_plot(
        self,
        *,
        key: str,
        build: Callable[["AdminService"], Awaitable[bytes]],
    ) -> bytes:
        cached = self._load_plot_entry(key)
        if cached is not None:
            if not self._is_fresh(cached.generated_at):
                self._schedule_plot_refresh(key=key, build=build)
            return cached.payload

        async with self._lock_for(key):
            cached = self._load_plot_entry(key)
            if cached is not None:
                if not self._is_fresh(cached.generated_at):
                    self._schedule_plot_refresh(key=key, build=build)
                return cached.payload

            image = await self._build_plot(build)
            self._write_plot_entry(key, image)
            return image

    def _schedule_response_refresh(
        self,
        *,
        key: str,
        build: Callable[["AdminService"], Awaitable[AdminEmbeddingClusterListResponse]],
    ) -> None:
        if key in self._refreshing_keys:
            return
        self._refreshing_keys.add(key)

        async def _refresh() -> None:
            try:
                async with AsyncSessionLocal() as db:
                    response = await build(AdminService(db))
                    self._write_response_entry(self._response_path(key), response)
            except Exception:
                logger.exception("Embedding cluster response refresh failed key=%s", key)
            finally:
                self._refreshing_keys.discard(key)

        self._track_refresh_task(asyncio.create_task(_refresh()))

    def _schedule_plot_refresh(
        self,
        *,
        key: str,
        build: Callable[["AdminService"], Awaitable[bytes]],
    ) -> None:
        if key in self._refreshing_keys:
            return
        self._refreshing_keys.add(key)

        async def _refresh() -> None:
            try:
                async with AsyncSessionLocal() as db:
                    image = await build(AdminService(db))
                    self._write_plot_entry(key, image)
            except Exception:
                logger.exception("Embedding cluster plot refresh failed key=%s", key)
            finally:
                self._refreshing_keys.discard(key)

        self._track_refresh_task(asyncio.create_task(_refresh()))

    async def _build_response(
        self,
        build: Callable[["AdminService"], Awaitable[AdminEmbeddingClusterListResponse]],
    ) -> AdminEmbeddingClusterListResponse:
        async with AsyncSessionLocal() as db:
            return await build(AdminService(db))

    async def _build_plot(
        self,
        build: Callable[["AdminService"], Awaitable[bytes]],
    ) -> bytes:
        async with AsyncSessionLocal() as db:
            return await build(AdminService(db))


_embedding_cluster_cache = _EmbeddingClusterCache(settings.storage_dir / "admin_embedding_clusters", _EMBEDDING_CLUSTER_CACHE_TTL)


class AdminService:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def get_admin_stats(self) -> AdminStatsResponse:
        media = MediaRepository(self._db)
        return AdminStatsResponse(
            total_users=await UserRepository(self._db).count(),
            total_media=await media.count_active(),
            total_storage_bytes=await media.sum_file_size(),
            pending_tagging=await media.count_by_tagging_status("pending"),
            failed_tagging=await media.count_by_tagging_status("failed"),
            trashed_media=await media.count_trashed(),
            storage_by_user=await UserRepository(self._db).list_storage_summaries(),
        )

    async def list_users(
        self,
        page: int,
        page_size: int,
        sort_by: str = "created_at",
        sort_order: str = "desc",
    ) -> AdminUserListResponse:
        sort_col = User.username if sort_by == "username" else User.created_at
        order_expr = sort_col.asc() if sort_order == "asc" else sort_col.desc()
        logger.info(
            "Listing admin users page=%s page_size=%s sort_by=%s sort_order=%s",
            page,
            page_size,
            sort_by,
            sort_order,
        )
        users_repo = UserRepository(self._db)
        total = await users_repo.count()
        rows = await users_repo.list_with_media_stats(
            offset=(page - 1) * page_size,
            limit=page_size,
            order_expr=order_expr,
        )
        users = [
            AdminUserSummary.model_validate(
                {
                    **UserRead.model_validate(row["user"]).model_dump(),
                    "media_count": row["media_count"],
                    "storage_used_mb": int(row["storage_used_bytes"]) // (1024 * 1024),
                }
            )
            for row in rows
        ]
        logger.info("Admin users query returned %s rows out of %s total users", len(users), total)
        return AdminUserListResponse(total=total, page=page, page_size=page_size, items=users)

    async def get_user_detail(self, user_id: uuid.UUID) -> AdminUserDetail:
        target = await UserRepository(self._db).get_by_id(user_id)
        if target is None:
            raise AppError(status_code=404, code=user_not_found, detail="User not found")
        media = MediaRepository(self._db)
        media_count = await media.count_by_uploader(user_id)
        storage_bytes = await media.sum_file_size(uploader_id=user_id)
        return AdminUserDetail.model_validate({**UserRead.model_validate(target).model_dump(), "media_count": media_count, "storage_used_mb": int(storage_bytes) // (1024 * 1024)})

    async def update_user(self, actor: User, user_id: uuid.UUID, body: AdminUserUpdate):
        users = UserRepository(self._db)
        target = await users.get_by_id(user_id)
        if target is None:
            raise AppError(status_code=404, code=user_not_found, detail="User not found")
        if body.username is not None:
            existing = await users.get_by_username(body.username)
            if existing is not None and existing.id != target.id:
                raise AppError(status_code=409, code=duplicate_username, detail="Username already taken")
            target.username = body.username
        if "is_admin" in body.model_fields_set:
            target.is_admin = body.is_admin
        if "show_nsfw" in body.model_fields_set:
            target.show_nsfw = body.show_nsfw
        if "show_sensitive" in body.model_fields_set:
            target.show_sensitive = body.show_sensitive
        if "tag_confidence_threshold" in body.model_fields_set:
            target.tag_confidence_threshold = body.tag_confidence_threshold
        if body.storage_quota_mb is not None:
            target.storage_quota_mb = body.storage_quota_mb
        if body.password is not None:
            target.hashed_password = hash_password(body.password)
        await self._db.commit()
        await self._db.refresh(target)
        storage_bytes = await MediaRepository(self._db).sum_file_size(uploader_id=target.id)
        return UserRead.model_validate(target).model_copy(update={"storage_used_mb": int(storage_bytes) // (1024 * 1024)})

    async def delete_user(self, actor: User, user_id: uuid.UUID, delete_media: bool = False) -> None:
        target = await UserRepository(self._db).get_by_id(user_id)
        if target is None:
            raise AppError(status_code=404, code=user_not_found, detail="User not found")
        self._assert_not_self(actor, target)
        if delete_media:
            await self.delete_user_media(actor, user_id)
        await self._db.delete(target)
        await self._db.commit()

    async def retag_all_media(self, user_id: uuid.UUID) -> int:
        target = await UserRepository(self._db).get_by_id(user_id)
        if target is None:
            raise AppError(status_code=404, code=user_not_found, detail="User not found")
        media_items = await MediaRepository(self._db).get_active_by_uploader(user_id)
        for media in media_items:
            media.tagging_status = "pending"
        await self._db.commit()
        queue = get_tag_queue()
        if queue:
            for media in media_items:
                await queue.put(media.id)
        return len(media_items)

    async def start_embedding_backfill(self, user_id: uuid.UUID) -> AdminEmbeddingBackfillResponse:
        target = await UserRepository(self._db).get_by_id(user_id)
        if target is None:
            raise AppError(status_code=404, code=user_not_found, detail="User not found")

        active_batch = (
            await self._db.execute(
                select(ImportBatch)
                .where(
                    ImportBatch.user_id == user_id,
                    ImportBatch.type == BatchType.embedding_backfill,
                    ImportBatch.status.in_([BatchStatus.pending, BatchStatus.running]),
                )
                .order_by(ImportBatch.created_at.desc(), ImportBatch.id.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if active_batch is not None:
            return AdminEmbeddingBackfillResponse(
                batch_id=active_batch.id,
                queued=active_batch.queued_items + active_batch.processing_items,
                already_current=0,
            )

        rows = (
            await self._db.execute(
                select(Media)
                .outerjoin(MediaEmbedding, MediaEmbedding.media_id == Media.id)
                .where(
                    Media.uploader_id == user_id,
                    Media.deleted_at.is_(None),
                    Media.tagging_status == TaggingStatus.DONE,
                )
                .order_by(Media.uploaded_at.desc(), Media.id.desc())
            )
        ).scalars().all()
        current_ids = set(
            (
                await self._db.execute(
                    select(MediaEmbedding.media_id).where(
                        MediaEmbedding.uploader_id == user_id,
                        MediaEmbedding.model_version == EMBEDDING_MODEL_VERSION,
                    )
                )
            ).scalars().all()
        )
        media_items = [media for media in rows if media.id not in current_ids]
        already_current = max(0, len(rows) - len(media_items))
        now = datetime.now(timezone.utc)
        batch = ImportBatch(
            user_id=user_id,
            type=BatchType.embedding_backfill,
            status=BatchStatus.running if media_items else BatchStatus.done,
            total_items=len(media_items),
            queued_items=len(media_items),
            processing_items=0,
            done_items=0,
            failed_items=0,
            started_at=now,
            finished_at=None if media_items else now,
            last_heartbeat_at=now,
        )
        self._db.add(batch)
        await self._db.flush()

        items: list[ImportBatchItem] = []
        for media in media_items:
            item = ImportBatchItem(
                batch_id=batch.id,
                media_id=media.id,
                source_filename=media.original_filename or media.filename,
                status=ItemStatus.pending,
                step=ProcessingStep.embedding,
                progress_percent=0,
            )
            self._db.add(item)
            items.append(item)
        await self._db.flush()
        await self._db.commit()

        queue = get_embedding_backfill_queue()
        if queue is not None:
            for item in items:
                await queue.put(item.id)
        logger.info(
            "Queued embedding backfill user_id=%s batch_id=%s queued=%s already_current=%s",
            user_id,
            batch.id,
            len(items),
            already_current,
        )
        return AdminEmbeddingBackfillResponse(batch_id=batch.id, queued=len(items), already_current=already_current)

    async def get_embedding_backfill_status(self, batch_id: uuid.UUID) -> AdminEmbeddingBackfillStatus:
        batch = await self._db.get(ImportBatch, batch_id)
        if batch is None or batch.type != BatchType.embedding_backfill:
            raise AppError(status_code=404, code="embedding_backfill_not_found", detail="Embedding backfill not found")
        failed_items = (
            await self._db.execute(
                select(ImportBatchItem)
                .where(
                    ImportBatchItem.batch_id == batch_id,
                    ImportBatchItem.status == ItemStatus.failed,
                )
                .order_by(ImportBatchItem.updated_at.desc(), ImportBatchItem.id.desc())
                .limit(5)
            )
        ).scalars().all()
        return AdminEmbeddingBackfillStatus(
            batch_id=batch.id,
            user_id=batch.user_id,
            status=batch.status.value if hasattr(batch.status, "value") else str(batch.status),
            total_items=batch.total_items,
            queued_items=batch.queued_items,
            processing_items=batch.processing_items,
            done_items=batch.done_items,
            failed_items=batch.failed_items,
            started_at=batch.started_at,
            finished_at=batch.finished_at,
            error_summary=batch.error_summary,
            recent_failed_items=[
                f"{item.source_filename}: {item.error or 'failed'}"
                for item in failed_items
            ],
        )

    async def run_embedding_backfill_item(self, item_id: uuid.UUID) -> None:
        item = await self._load_embedding_backfill_item(item_id)
        if item is None:
            return
        batch_id = item.batch_id
        item.status = ItemStatus.processing
        item.step = ProcessingStep.embedding
        item.progress_percent = 10
        item.error = None
        await self._refresh_batch_counts(batch_id)
        await self._db.commit()

        item = await self._load_embedding_backfill_item(item_id)
        if item is None:
            return
        try:
            media = item.media
            if media is None or media.deleted_at is not None or media.tagging_status != TaggingStatus.DONE:
                raise ValueError("Media is not eligible for embedding backfill")
            embedding = await MediaEmbeddingService(self._db).ensure_for_media(media, force=False)
            if embedding is None or embedding.model_version != EMBEDDING_MODEL_VERSION:
                raise ValueError("Embedding was not created")
            item.status = ItemStatus.done
            item.progress_percent = 100
            item.error = None
        except Exception as exc:
            item.status = ItemStatus.failed
            item.progress_percent = 100
            item.error = str(exc)[:1024]
            logger.warning("Embedding backfill item failed item_id=%s error=%s", item_id, exc)
        await self._refresh_batch_counts(batch_id)
        await self._db.commit()

    async def _build_embedding_clusters_response(
        self,
        user_id: uuid.UUID,
        *,
        mode: str,
        limit: int | None,
        sample_size: int,
        min_cluster_size: int,
        discovery_mode: bool = False,
    ) -> AdminEmbeddingClusterListResponse:
        target = await UserRepository(self._db).get_by_id(user_id)
        if target is None:
            raise AppError(status_code=404, code=user_not_found, detail="User not found")
        rows = await self._load_embedding_cluster_rows(user_id, limit=limit)
        scorer = HybridSimilarityScorer()
        clusters = (
            self._build_label_clusters(
                rows,
                sample_size=sample_size,
                min_cluster_size=min_cluster_size,
                scorer=scorer,
                discovery_mode=discovery_mode,
            )
            if mode == "label"
            else self._build_unsupervised_clusters(
                rows,
                sample_size=sample_size,
                min_cluster_size=min_cluster_size,
                scorer=scorer,
                discovery_mode=discovery_mode,
            )
        )
        return AdminEmbeddingClusterListResponse(
            mode=mode,
            discovery_mode=discovery_mode,
            model_version=EMBEDDING_MODEL_VERSION,
            total_embeddings=len(rows),
            clusters=clusters,
        )

    async def _build_embedding_cluster_plot_image(
        self,
        user_id: uuid.UUID,
        *,
        mode: str,
        min_cluster_size: int,
        discovery_mode: bool = False,
    ) -> bytes:
        target = await UserRepository(self._db).get_by_id(user_id)
        if target is None:
            raise AppError(status_code=404, code=user_not_found, detail="User not found")
        rows = await self._load_embedding_cluster_rows(user_id, limit=None)
        return _render_embedding_cluster_plot(
            rows,
            mode=mode,
            min_cluster_size=min_cluster_size,
            discovery_mode=discovery_mode,
        )

    async def get_embedding_clusters(
        self,
        user_id: uuid.UUID,
        *,
        mode: str,
        limit: int | None,
        sample_size: int,
        min_cluster_size: int,
        discovery_mode: bool = False,
    ) -> AdminEmbeddingClusterListResponse:
        cache_key = _embedding_cluster_cache_key(
            kind="cluster-response",
            parts={
                "user_id": str(user_id),
                "mode": mode,
                "limit": limit,
                "sample_size": sample_size,
                "min_cluster_size": min_cluster_size,
                "discovery_mode": discovery_mode,
            },
        )
        return await _embedding_cluster_cache.get_cluster_response(
            key=cache_key,
            build=lambda service: service._build_embedding_clusters_response(
                user_id,
                mode=mode,
                limit=limit,
                sample_size=sample_size,
                min_cluster_size=min_cluster_size,
                discovery_mode=discovery_mode,
            ),
        )

    async def get_embedding_cluster_plot(
        self,
        user_id: uuid.UUID,
        *,
        mode: str,
        min_cluster_size: int,
        discovery_mode: bool = False,
    ) -> bytes:
        cache_key = _embedding_cluster_cache_key(
            kind="cluster-plot",
            parts={
                "user_id": str(user_id),
                "mode": mode,
                "min_cluster_size": min_cluster_size,
                "discovery_mode": discovery_mode,
            },
        )
        return await _embedding_cluster_cache.get_plot(
            key=cache_key,
            build=lambda service: service._build_embedding_cluster_plot_image(
                user_id,
                mode=mode,
                min_cluster_size=min_cluster_size,
                discovery_mode=discovery_mode,
            ),
        )

    async def get_library_classification_metrics(
        self,
        user_id: uuid.UUID,
        *,
        model_version: str | None,
    ) -> AdminLibraryClassificationMetricsResponse:
        target = await UserRepository(self._db).get_by_id(user_id)
        if target is None:
            raise AppError(status_code=404, code=user_not_found, detail="User not found")

        version = model_version or EMBEDDING_MODEL_VERSION
        source_expr = func.coalesce(LibraryClassificationFeedback.source, "unknown")
        rows = (
            await self._db.execute(
                select(
                    source_expr.label("source"),
                    LibraryClassificationFeedback.action,
                    func.count(LibraryClassificationFeedback.id).label("count"),
                )
                .where(
                    LibraryClassificationFeedback.user_id == user_id,
                    LibraryClassificationFeedback.model_version == version,
                )
                .group_by(source_expr, LibraryClassificationFeedback.action)
            )
        ).all()

        totals = _empty_feedback_counts()
        by_source: dict[str, dict[str, int]] = defaultdict(_empty_feedback_counts)
        for source, action, count in rows:
            action_value = _feedback_action_value(action)
            if action_value not in totals:
                continue
            source_name = str(source or "unknown")
            amount = int(count or 0)
            totals[action_value] += amount
            by_source[source_name][action_value] += amount

        return AdminLibraryClassificationMetricsResponse(
            user_id=user_id,
            model_version=version,
            reviewed=totals["accepted"] + totals["rejected"],
            accepted=totals["accepted"],
            rejected=totals["rejected"],
            auto_applied=totals["auto_applied"],
            acceptance_rate=_ratio(totals["accepted"], totals["accepted"] + totals["rejected"]),
            rejection_rate=_ratio(totals["rejected"], totals["accepted"] + totals["rejected"]),
            by_source=[
                AdminLibraryClassificationSourceMetricsRead(
                    source=source,
                    reviewed=counts["accepted"] + counts["rejected"],
                    accepted=counts["accepted"],
                    rejected=counts["rejected"],
                    auto_applied=counts["auto_applied"],
                    acceptance_rate=_ratio(counts["accepted"], counts["accepted"] + counts["rejected"]),
                )
                for source, counts in sorted(
                    by_source.items(),
                    key=lambda item: (-(item[1]["accepted"] + item[1]["rejected"] + item[1]["auto_applied"]), item[0]),
                )
            ],
        )

    async def delete_user_media(self, actor: User, user_id: uuid.UUID) -> int:
        target = await UserRepository(self._db).get_by_id(user_id)
        if target is None:
            raise AppError(status_code=404, code=user_not_found, detail="User not found")
        self._assert_not_self(actor, target)

        query = MediaQueryService(self._db)
        lifecycle = MediaLifecycleService(self._db, query)
        media_items = await MediaRepository(self._db).get_by_uploader(user_id)
        for media in media_items:
            await lifecycle.purge_media_record(media)
        await self._db.commit()
        return len(media_items)

    async def get_health(self) -> AdminHealthResponse:
        latest = health_monitor.capture_sample()
        total_memory, used_memory = health_monitor.system_memory()
        queue = get_tag_queue()
        return AdminHealthResponse(
            generated_at=latest.captured_at,
            uptime_seconds=round(health_monitor.uptime_seconds(), 2),
            cpu_percent=latest.cpu_percent,
            memory_rss_bytes=latest.memory_rss_bytes,
            system_memory_total_bytes=total_memory,
            system_memory_used_bytes=used_memory,
            tagging_queue_depth=queue.qsize() if queue is not None else 0,
            samples=[
                AdminHealthSample(
                    captured_at=sample.captured_at,
                    cpu_percent=sample.cpu_percent,
                    memory_rss_bytes=sample.memory_rss_bytes,
                )
                for sample in health_monitor.samples()
            ],
        )

    async def _load_embedding_backfill_item(self, item_id: uuid.UUID) -> ImportBatchItem | None:
        return (
            await self._db.execute(
                select(ImportBatchItem)
                .options(selectinload(ImportBatchItem.media))
                .where(ImportBatchItem.id == item_id)
            )
        ).scalar_one_or_none()

    async def _refresh_batch_counts(self, batch_id: uuid.UUID) -> None:
        batch = await self._db.get(ImportBatch, batch_id)
        if batch is None:
            return
        statuses = (
            await self._db.execute(
                select(ImportBatchItem.status).where(ImportBatchItem.batch_id == batch_id)
            )
        ).scalars().all()
        batch.total_items = len(statuses)
        batch.queued_items = sum(1 for status in statuses if status == ItemStatus.pending)
        batch.processing_items = sum(1 for status in statuses if status == ItemStatus.processing)
        batch.done_items = sum(1 for status in statuses if status in {ItemStatus.done, ItemStatus.skipped})
        batch.failed_items = sum(1 for status in statuses if status == ItemStatus.failed)
        batch.last_heartbeat_at = datetime.now(timezone.utc)
        if batch.queued_items or batch.processing_items:
            batch.status = BatchStatus.running
            batch.finished_at = None
            return
        if batch.failed_items == batch.total_items and batch.total_items > 0:
            batch.status = BatchStatus.failed
        elif batch.failed_items > 0:
            batch.status = BatchStatus.partial_failed
        else:
            batch.status = BatchStatus.done
        batch.finished_at = datetime.now(timezone.utc)

    async def _load_embedding_cluster_rows(self, user_id: uuid.UUID, *, limit: int | None) -> list[dict]:
        stmt = (
            select(Media, MediaEmbedding.embedding)
            .options(
                selectinload(Media.media_tags).selectinload(MediaTag.tag),
                selectinload(Media.entities),
            )
            .join(MediaEmbedding, MediaEmbedding.media_id == Media.id)
            .where(
                Media.uploader_id == user_id,
                Media.deleted_at.is_(None),
                MediaEmbedding.model_version == EMBEDDING_MODEL_VERSION,
            )
            .order_by(Media.uploaded_at.desc(), Media.id.desc())
        )
        if limit is not None:
            stmt = stmt.limit(limit)
        rows = (await self._db.execute(stmt)).all()
        media_ids = [row[0].id for row in rows]
        labels_by_media: dict[uuid.UUID, list[MediaEntity]] = defaultdict(list)
        if media_ids:
            entity_rows = (
                await self._db.execute(
                    select(MediaEntity).where(
                        MediaEntity.media_id.in_(media_ids),
                        MediaEntity.entity_type == MediaEntityType.character,
                        MediaEntity.source == "manual",
                        MediaEntity.name != "",
                    )
                )
            ).scalars().all()
            for entity in entity_rows:
                labels_by_media[entity.media_id].append(entity)
        return [
            {
                "media": row[0],
                "embedding": normalized,
                "labels": labels_by_media.get(row[0].id, []),
            }
            for row in rows
            for normalized in [_normalized(row[1])]
            if normalized
        ]

    def _build_label_clusters(
        self,
        rows: list[dict],
        *,
        sample_size: int,
        min_cluster_size: int,
        scorer: HybridSimilarityScorer,
        discovery_mode: bool,
    ) -> list[AdminEmbeddingClusterRead]:
        grouped: dict[tuple[uuid.UUID | None, str], list[dict]] = defaultdict(list)
        for row in rows:
            for label in row["labels"]:
                grouped[(label.entity_id, label.name)].append(row)
        clusters: list[AdminEmbeddingClusterRead] = []
        for (entity_id, name), items in grouped.items():
            distinct_ids = {item["media"].id for item in items}
            if len(distinct_ids) < min_cluster_size:
                continue
            profiles = [
                _media_profile_for_cluster_item(scorer, item, support_count=1)
                for item in items
            ]
            prototype_profile = scorer.prototype_profile(profiles)
            prototype_profile.support_count = len(distinct_ids)
            scored = sorted(
                [
                    (
                        item,
                        scorer.score(
                            _media_profile_for_cluster_item(scorer, item, support_count=10),
                            prototype_profile,
                            discovery_mode=discovery_mode,
                        ),
                    )
                    for item in items
                ],
                key=lambda pair: pair[1].score,
                reverse=True,
            )
            similarities = [score.score for _, score in scored]
            outliers = list(reversed(scored))[: min(sample_size, max(0, len(scored) // 5 or 1))]
            clusters.append(AdminEmbeddingClusterRead(
                id=str(entity_id or name),
                label=name,
                entity_id=entity_id,
                size=len(items),
                distinct_media_support=len(distinct_ids),
                prototype_count=_prototype_count([item["embedding"] for item in items]),
                cohesion=round(sum(similarities) / len(similarities), 3) if similarities else None,
                min_similarity=round(min(similarities), 3) if similarities else None,
                max_similarity=round(max(similarities), 3) if similarities else None,
                score_breakdown=_average_breakdown([score.breakdown for _, score in scored]),
                nearest_labels=[name],
                samples=[
                    _cluster_sample(item, similarity=score, label=name)
                    for item, score in scored[:sample_size]
                ],
                outliers=[
                    _cluster_sample(item, similarity=score, label=name)
                    for item, score in outliers
                ],
            ))
        return sorted(clusters, key=lambda cluster: (-cluster.distinct_media_support, cluster.label or ""))[:100]

    def _build_unsupervised_clusters(
        self,
        rows: list[dict],
        *,
        sample_size: int,
        min_cluster_size: int,
        scorer: HybridSimilarityScorer,
        discovery_mode: bool,
    ) -> list[AdminEmbeddingClusterRead]:
        clusters: list[dict] = []
        threshold = 0.78
        for row in rows:
            best = max(
                clusters,
                key=lambda cluster: _cosine_similarity(row["embedding"], cluster["centroid"]),
                default=None,
            )
            if best is not None and cosine_similarity(row["embedding"], best["centroid"]) >= threshold:
                best["items"].append(row)
                best["centroid"] = centroid([item["embedding"] for item in best["items"]])
            else:
                clusters.append({"items": [row], "centroid": row["embedding"]})

        result: list[AdminEmbeddingClusterRead] = []
        for index, cluster in enumerate(clusters, start=1):
            items = cluster["items"]
            if len(items) < min_cluster_size:
                continue
            profiles = [
                _media_profile_for_cluster_item(scorer, item, support_count=1)
                for item in items
            ]
            prototype_profile = scorer.prototype_profile(profiles)
            prototype_profile.support_count = len({item["media"].id for item in items})
            label_counts = Counter(
                label.name
                for item in items
                for label in item["labels"]
            )
            scored = sorted(
                [
                    (
                        item,
                        scorer.score(
                            _media_profile_for_cluster_item(scorer, item, support_count=10),
                            prototype_profile,
                            discovery_mode=discovery_mode,
                        ),
                    )
                    for item in items
                ],
                key=lambda pair: pair[1].score,
                reverse=True,
            )
            similarities = [score.score for _, score in scored]
            result.append(AdminEmbeddingClusterRead(
                id=f"cluster-{index}",
                label=label_counts.most_common(1)[0][0] if label_counts else None,
                size=len(items),
                distinct_media_support=len({item["media"].id for item in items}),
                prototype_count=1,
                cohesion=round(sum(similarities) / len(similarities), 3) if similarities else None,
                min_similarity=round(min(similarities), 3) if similarities else None,
                max_similarity=round(max(similarities), 3) if similarities else None,
                score_breakdown=_average_breakdown([score.breakdown for _, score in scored]),
                nearest_labels=[name for name, _ in label_counts.most_common(3)],
                samples=[
                    _cluster_sample(item, similarity=score, label=None)
                    for item, score in scored[:sample_size]
                ],
                outliers=[
                    _cluster_sample(item, similarity=score, label=None)
                    for item, score in list(reversed(scored))[:sample_size]
                ],
            ))
        return sorted(result, key=lambda cluster: (-cluster.size, cluster.id))[:100]

    def _assert_not_self(self, actor: User, target: User) -> None:
        if actor.id == target.id:
            raise AppError(status_code=403, code=forbidden, detail="You cannot perform this action on your own account")


def _normalized(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(float(value) * float(value) for value in vector))
    if norm <= 0:
        return []
    return [float(value) / norm for value in vector]


def _centroid(vectors: list[list[float]]) -> list[float]:
    if not vectors:
        return []
    length = min(len(vector) for vector in vectors)
    return _normalized([
        sum(vector[index] for vector in vectors) / len(vectors)
        for index in range(length)
    ])


def _cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right:
        return 0.0
    limit = min(len(left), len(right))
    return sum(left[index] * right[index] for index in range(limit))


def _prototype_count(vectors: list[list[float]]) -> int:
    prototypes: list[list[float]] = []
    for vector in vectors:
        best = max((_cosine_similarity(vector, prototype) for prototype in prototypes), default=0.0)
        if best < 0.82:
            prototypes.append(vector)
    return max(1, len(prototypes))


def _cluster_sample(item: dict, *, similarity: HybridScore | float | None, label: str | None) -> AdminEmbeddingClusterSampleRead:
    media = item["media"]
    score_value: float | None
    breakdown: AdminEmbeddingScoreBreakdownRead | None = None
    if isinstance(similarity, HybridScore):
        score_value = similarity.score
        breakdown = _score_breakdown_read(similarity.breakdown)
    else:
        score_value = similarity
    return AdminEmbeddingClusterSampleRead(
        media_id=media.id,
        filename=media.original_filename or media.filename,
        similarity=round(score_value, 3) if score_value is not None else None,
        label=label,
        score_breakdown=breakdown,
    )


def _media_profile_for_cluster_item(
    scorer: HybridSimilarityScorer,
    item: dict,
    *,
    support_count: int,
) -> MediaSimilarityProfile:
    profile = scorer.media_profile(item["media"], item["embedding"])
    profile.support_count = support_count
    return profile


def _score_breakdown_read(breakdown: HybridScoreBreakdown | None) -> AdminEmbeddingScoreBreakdownRead | None:
    if breakdown is None:
        return None
    return AdminEmbeddingScoreBreakdownRead(
        visual=_round_optional(breakdown.visual),
        tags=_round_optional(breakdown.tags),
        color=_round_optional(breakdown.color),
        confidence=_round_optional(breakdown.confidence),
        series_penalty=_round_optional(breakdown.series_penalty),
    )


def _average_breakdown(breakdowns: list[HybridScoreBreakdown]) -> AdminEmbeddingScoreBreakdownRead | None:
    if not breakdowns:
        return None

    def average(values: list[float | None]) -> float | None:
        numeric = [value for value in values if value is not None]
        if not numeric:
            return None
        return round(sum(numeric) / len(numeric), 3)

    return AdminEmbeddingScoreBreakdownRead(
        visual=average([breakdown.visual for breakdown in breakdowns]),
        tags=average([breakdown.tags for breakdown in breakdowns]),
        color=average([breakdown.color for breakdown in breakdowns]),
        confidence=average([breakdown.confidence for breakdown in breakdowns]),
        series_penalty=average([breakdown.series_penalty for breakdown in breakdowns]),
    )


def _round_optional(value: float | None) -> float | None:
    return round(value, 3) if value is not None else None


def _empty_feedback_counts() -> dict[str, int]:
    return {
        LibraryClassificationFeedbackAction.accepted.value: 0,
        LibraryClassificationFeedbackAction.rejected.value: 0,
        LibraryClassificationFeedbackAction.auto_applied.value: 0,
    }


def _feedback_action_value(action: LibraryClassificationFeedbackAction | str) -> str:
    return action.value if isinstance(action, LibraryClassificationFeedbackAction) else str(action)


def _ratio(numerator: int, denominator: int) -> float | None:
    if denominator <= 0:
        return None
    return round(numerator / denominator, 4)


def _render_embedding_cluster_plot(rows: list[dict], *, mode: str, min_cluster_size: int, discovery_mode: bool) -> bytes:
    import io

    try:
        import matplotlib
    except ModuleNotFoundError as exc:
        raise AppError(
            status_code=503,
            code="embedding_plot_dependency_missing",
            detail="Matplotlib is required to render embedding cluster plots.",
        ) from exc
    matplotlib.use("Agg")
    from matplotlib import pyplot as plt

    projected = _project_embeddings_2d([row["embedding"] for row in rows])
    labels = _plot_labels(rows, mode=mode, min_cluster_size=min_cluster_size)
    fig, ax = plt.subplots(figsize=(11, 7), dpi=150)
    fig.patch.set_facecolor("#ffffff")
    ax.set_facecolor("#f8fafc")
    ax.grid(True, color="#dbe3ed", linewidth=0.5, alpha=0.9)

    if not projected:
        ax.text(0.5, 0.5, "No current embeddings to plot", ha="center", va="center", transform=ax.transAxes)
        ax.set_axis_off()
    else:
        top_labels = _top_plot_labels(labels)
        palette = plt.get_cmap("tab20")
        color_by_label = {label: palette(index % 20) for index, label in enumerate(top_labels)}
        for label in [*top_labels, "Other"]:
            points = [
                point
                for point, point_label in zip(projected, labels, strict=False)
                if (point_label if point_label in color_by_label else "Other") == label
            ]
            if not points:
                continue
            xs = [point[0] for point in points]
            ys = [point[1] for point in points]
            ax.scatter(
                xs,
                ys,
                s=22 if label != "Other" else 14,
                alpha=0.86 if label != "Other" else 0.34,
                linewidths=0.2,
                edgecolors="#0f172a",
                color=color_by_label.get(label, "#94a3b8"),
                label=label,
            )
        ax.set_xlabel("PCA 1")
        ax.set_ylabel("PCA 2")
        title_suffix = ", discovery" if discovery_mode else ""
        ax.set_title(f"Embedding map ({mode}{title_suffix}, all current embeddings: {len(projected)})")
        handles, legend_labels = ax.get_legend_handles_labels()
        if handles:
            ax.legend(
                handles,
                legend_labels,
                loc="best",
                fontsize=8,
                frameon=True,
                framealpha=0.88,
                borderpad=0.6,
                markerscale=1.3,
            )

    fig.tight_layout()
    buffer = io.BytesIO()
    fig.savefig(buffer, format="png", bbox_inches="tight")
    plt.close(fig)
    return buffer.getvalue()


def _project_embeddings_2d(vectors: list[list[float]]) -> list[tuple[float, float]]:
    if not vectors:
        return []
    import numpy as np

    matrix = np.asarray(vectors, dtype=np.float32)
    if matrix.ndim != 2 or matrix.shape[0] == 0:
        return []
    if matrix.shape[0] == 1:
        return [(0.0, 0.0)]
    matrix = matrix - matrix.mean(axis=0, keepdims=True)
    _, _, vt = np.linalg.svd(matrix, full_matrices=False)
    components = vt[:2].T
    projected = matrix @ components
    if projected.shape[1] == 1:
        projected = np.concatenate([projected, np.zeros((projected.shape[0], 1), dtype=projected.dtype)], axis=1)
    spread = projected.std(axis=0, keepdims=True)
    projected = projected / np.where(spread == 0, 1.0, spread)
    return [(float(point[0]), float(point[1])) for point in projected]


def _plot_labels(rows: list[dict], *, mode: str, min_cluster_size: int) -> list[str]:
    if mode == "unsupervised":
        return _unsupervised_plot_labels(rows, min_cluster_size=min_cluster_size)
    labels = []
    for row in rows:
        row_labels = [label.name for label in row["labels"] if label.name]
        labels.append(row_labels[0] if row_labels else "Unlabeled")
    return labels


def _unsupervised_plot_labels(rows: list[dict], *, min_cluster_size: int) -> list[str]:
    clusters: list[dict] = []
    threshold = 0.78
    for index, row in enumerate(rows):
        best = max(
            clusters,
            key=lambda cluster: _cosine_similarity(row["embedding"], cluster["centroid"]),
            default=None,
        )
        if best is not None and _cosine_similarity(row["embedding"], best["centroid"]) >= threshold:
            best["items"].append(index)
            best["vectors"].append(row["embedding"])
            best["centroid"] = _centroid(best["vectors"])
        else:
            clusters.append({"items": [index], "vectors": [row["embedding"]], "centroid": row["embedding"]})

    labels = ["Other" for _ in rows]
    kept = [cluster for cluster in clusters if len(cluster["items"]) >= min_cluster_size]
    kept.sort(key=lambda cluster: len(cluster["items"]), reverse=True)
    for cluster_index, cluster in enumerate(kept, start=1):
        for item_index in cluster["items"]:
            labels[item_index] = f"Cluster {cluster_index}"
    return labels


def _top_plot_labels(labels: list[str]) -> list[str]:
    counts = Counter(label for label in labels if label and label not in {"Other", "Unlabeled"})
    return [
        label
        for label, count in counts.most_common(12)
        if count >= 2
    ]


def _trusted_entity_sql_filter(model):
    return or_(
        model.source == "manual",
        and_(
            model.source == "tagger",
            model.confidence.is_not(None),
            model.confidence >= settings.library_classification_trusted_tagger_min_confidence,
        ),
    )
