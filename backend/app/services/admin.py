from __future__ import annotations

import logging
import uuid
from collections import defaultdict
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.app.errors.auth import duplicate_username, forbidden, user_not_found
from backend.app.errors.error import AppError
from backend.app.ml.embedding import EMBEDDING_MODEL_VERSION
from backend.app.models.auth import User
from backend.app.models.embeddings import MediaEmbedding
from backend.app.models.library_classification import LibraryClassificationFeedback, LibraryClassificationFeedbackAction
from backend.app.models.media import Media, TaggingStatus
from backend.app.models.processing import BatchStatus, BatchType, ImportBatch, ImportBatchItem, ItemStatus, ProcessingStep
from backend.app.repositories.auth import UserRepository
from backend.app.repositories.media import MediaRepository
from backend.app.runtime import health_monitor
from backend.app.schemas import (
    AdminEmbeddingBackfillResponse,
    AdminEmbeddingBackfillStatus,
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
from backend.app.services.media import get_tag_queue
from backend.app.services.media.lifecycle import MediaLifecycleService
from backend.app.services.media.query import MediaQueryService
from backend.app.utils.passwords import hash_password

logger = logging.getLogger("backend.app.admin")


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

    def _assert_not_self(self, actor: User, target: User) -> None:
        if actor.id == target.id:
            raise AppError(status_code=403, code=forbidden, detail="You cannot perform this action on your own account")


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
