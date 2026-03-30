from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timezone
from typing import Any

from fastapi import UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.config import settings
from backend.app.errors.error import AppError
from backend.app.errors.upload import upload_limit_exceeded
from backend.app.models.auth import User
from backend.app.models.media import Media, MediaType, MediaVisibility
from backend.app.models.processing import BatchStatus, BatchType, ImportBatch, ImportBatchItem, ItemStatus, ProcessingStep
from backend.app.repositories.tags import TagRepository
from backend.app.schemas import BatchUploadResponse, UploadResult
from backend.app.utils.media_common import build_tag_payloads, normalize_manual_tags
from backend.app.services.media import get_tag_queue
from backend.app.services.media.processing import MediaProcessingService
from backend.app.services.media.query import MediaQueryService
from backend.app.utils.media_metadata import extract_media_metadata
from backend.app.utils.storage import delete_media_files, save_upload
from backend.app.utils.tagging import tag_names_mark_nsfw
from backend.app.utils.thumbnails import generate_poster_and_thumbnail
from backend.app.ml.ocr import ocr_backend


@dataclass
class UploadBatchContext:
    accepted: int = 0
    duplicates: int = 0
    errors: int = 0
    pending_items: int = 0
    done_items: int = 0
    failed_items: int = 0
    queued_media_ids: list[uuid.UUID] = field(default_factory=list)
    processing_media_ids: list[uuid.UUID] = field(default_factory=list)
    results: list[UploadResult] = field(default_factory=list)


def calculate_batch_status(*, total: int, pending: int, processing: int, failed: int) -> BatchStatus:
    if pending or processing:
        return BatchStatus.running
    if failed == total and total > 0:
        return BatchStatus.failed
    if failed > 0:
        return BatchStatus.partial_failed
    return BatchStatus.done


class MediaPostProcessor:
    def __init__(self, processing: MediaProcessingService) -> None:
        self._processing = processing

    async def dispatch(self, media_ids: list[uuid.UUID]) -> None:
        if not media_ids:
            return
        queue = get_tag_queue()
        if queue:
            for media_id in media_ids:
                await queue.put(media_id)
            return
        for media_id in media_ids:
            await self._processing.run_ocr_for_media(media_id, ocr_backend)


class MediaUploadWorkflow:
    def __init__(
        self,
        *,
        db: AsyncSession,
        query: MediaQueryService,
        tags_repo: TagRepository,
        post_processor: MediaPostProcessor,
    ) -> None:
        self._db = db
        self._query = query
        self._tags_repo = tags_repo
        self._post_processor = post_processor

    async def run(
        self,
        *,
        user: User,
        files: list[UploadFile],
        album_id: uuid.UUID | None,
        tags: list[str] | None,
        captured_at_override: datetime | None,
        captured_at_values: list[datetime] | None = None,
        visibility: MediaVisibility = MediaVisibility.private,
    ) -> BatchUploadResponse:
        self._validate_batch_size(files)
        upload_batch = await self._create_upload_batch(user, len(files))
        ctx = UploadBatchContext()

        for index, upload in enumerate(files):
            per_file_override = captured_at_override
            if captured_at_values and index < len(captured_at_values):
                per_file_override = captured_at_values[index]
            await self._process_single_upload(
                upload_batch=upload_batch,
                upload=upload,
                user=user,
                tags=tags,
                captured_at_override=per_file_override,
                visibility=visibility,
                ctx=ctx,
            )

        self._finalize_upload_batch(upload_batch, ctx)
        await self._db.commit()
        await self._attach_album_if_needed(album_id, ctx.queued_media_ids, user)
        await self._post_processor.dispatch(ctx.processing_media_ids)
        return self._build_response(upload_batch, ctx)

    def _validate_batch_size(self, files: list[UploadFile]) -> None:
        if len(files) > settings.max_batch_size:
            raise AppError(status_code=400, code=upload_limit_exceeded, detail=f"Max {settings.max_batch_size} files per request")

    async def _create_upload_batch(self, user: User, total_items: int) -> ImportBatch:
        now = datetime.now(timezone.utc)
        upload_batch = ImportBatch(
            user_id=user.id,
            type=BatchType.upload,
            status=BatchStatus.running,
            total_items=total_items,
            started_at=now,
            last_heartbeat_at=now,
        )
        self._db.add(upload_batch)
        await self._db.flush()
        return upload_batch

    async def _process_single_upload(
        self,
        *,
        upload_batch: ImportBatch,
        upload: UploadFile,
        user: User,
        tags: list[str] | None,
        captured_at_override: datetime | None,
        visibility: MediaVisibility,
        ctx: UploadBatchContext,
    ) -> None:
        original_name = upload.filename or "unknown"
        batch_item = self._new_batch_item(upload_batch.id, original_name)

        saved = await save_upload(upload)
        if saved is None:
            await self._handle_failed_upload(batch_item, original_name, ctx)
            return

        file_metadata = extract_media_metadata(str(saved.path), saved.media_type)
        if captured_at_override is not None:
            captured_at = _normalize_utc(captured_at_override)
        elif file_metadata.captured_at:
            captured_at = file_metadata.captured_at
        else:
            file_mtime = saved.path.stat().st_mtime
            captured_at = datetime.fromtimestamp(file_mtime, tz=UTC)

        existing = await self._query.get_media_by_sha256(saved.sha256)
        if existing is not None:
            await self._handle_existing_media(
                batch_item=batch_item,
                existing=existing,
                original_name=original_name,
                captured_at=captured_at,
                saved_path=str(saved.path),
                ctx=ctx,
            )
            return

        await self._handle_new_media(
            batch_item=batch_item,
            user=user,
            original_name=original_name,
            saved=saved,
            file_metadata=file_metadata,
            tags=tags,
            captured_at=captured_at_override or captured_at,
            visibility=visibility,
            ctx=ctx,
        )

    def _new_batch_item(self, batch_id: uuid.UUID, original_name: str) -> ImportBatchItem:
        return ImportBatchItem(
            batch_id=batch_id,
            source_filename=original_name,
            status=ItemStatus.pending,
            step=ProcessingStep.ingest,
            progress_percent=0,
        )

    async def _handle_failed_upload(
        self,
        batch_item: ImportBatchItem,
        original_name: str,
        ctx: UploadBatchContext,
    ) -> None:
        batch_item.status = ItemStatus.failed
        batch_item.error = "Unsupported type or file too large"
        batch_item.progress_percent = 100

        self._db.add(batch_item)
        await self._db.flush()

        ctx.errors += 1
        ctx.failed_items += 1
        ctx.results.append(
            UploadResult(
                id=None,
                batch_item_id=batch_item.id,
                original_filename=original_name,
                status="error",
                message=batch_item.error,
            )
        )

    async def _handle_existing_media(
        self,
        *,
        batch_item: ImportBatchItem,
        existing: Media,
        original_name: str,
        captured_at: datetime,
        saved_path: str,
        ctx: UploadBatchContext,
    ) -> None:
        delete_media_files(saved_path)

        if existing.deleted_at is None:
            batch_item.media_id = existing.id
            batch_item.status = ItemStatus.skipped
            batch_item.error = "Media already exists"
            batch_item.progress_percent = 100

            self._db.add(batch_item)
            await self._db.flush()

            ctx.duplicates += 1
            ctx.done_items += 1
            ctx.results.append(
                UploadResult(
                    id=None,
                    batch_item_id=batch_item.id,
                    original_filename=original_name,
                    status="duplicate",
                    message=batch_item.error,
                )
            )
            return

        existing.deleted_at = None
        existing.original_filename = original_name
        existing.tagging_status = "pending"
        existing.tagging_error = None
        existing.captured_at = existing.captured_at or captured_at

        batch_item.media_id = existing.id
        batch_item.status = ItemStatus.pending
        batch_item.step = ProcessingStep.tag
        batch_item.progress_percent = 0

        self._db.add(batch_item)
        await self._db.flush()

        ctx.accepted += 1
        ctx.pending_items += 1
        ctx.queued_media_ids.append(existing.id)
        ctx.processing_media_ids.append(existing.id)
        ctx.results.append(
            UploadResult(
                id=existing.id,
                batch_item_id=batch_item.id,
                original_filename=original_name,
                status="accepted",
            )
        )

    async def _handle_new_media(
        self,
        *,
        batch_item: ImportBatchItem,
        user: User,
        original_name: str,
        saved: Any,
        file_metadata: Any,
        tags: list[str] | None,
        captured_at: datetime,
        visibility: MediaVisibility,
        ctx: UploadBatchContext,
    ) -> None:
        poster, thumb = generate_poster_and_thumbnail(str(saved.path), saved.media_type)
        normalized_tags = normalize_manual_tags(tags) if tags else []

        media = Media(
            uploader_id=user.id,
            filename=saved.path.name,
            original_filename=original_name,
            filepath=str(saved.path),
            file_size=saved.file_size,
            sha256=saved.sha256,
            mime_type=saved.mime_type,
            media_type=saved.media_type,
            width=file_metadata.width,
            height=file_metadata.height,
            duration_seconds=file_metadata.duration_seconds,
            frame_count=file_metadata.frame_count,
            tagging_status="pending",
            tagging_error=None,
            thumbnail_path=str(thumb) if thumb else None,
            thumbnail_status="done" if thumb else "failed",
            poster_path=str(poster) if poster else None,
            poster_status="done" if poster or saved.media_type == MediaType.IMAGE else "failed",
            captured_at=captured_at,
            visibility=visibility,
        )
        self._db.add(media)
        await self._db.flush()

        batch_item.media_id = media.id
        if normalized_tags:
            await self._tags_repo.set_media_tag_links(media, build_tag_payloads(normalized_tags))
            media.is_nsfw = tag_names_mark_nsfw(normalized_tags)
            media.tagging_status = "done"
            batch_item.status = ItemStatus.done
            batch_item.step = ProcessingStep.tag
            batch_item.progress_percent = 100
            ctx.done_items += 1
        else:
            batch_item.status = ItemStatus.pending
            batch_item.step = ProcessingStep.tag
            batch_item.progress_percent = 0
            ctx.pending_items += 1

        self._db.add(batch_item)
        await self._db.flush()

        ctx.accepted += 1
        ctx.queued_media_ids.append(media.id)
        ctx.processing_media_ids.append(media.id)
        ctx.results.append(
            UploadResult(
                id=media.id,
                batch_item_id=batch_item.id,
                original_filename=original_name,
                status="accepted",
            )
        )

    def _finalize_upload_batch(self, upload_batch: ImportBatch, ctx: UploadBatchContext) -> None:
        upload_batch.queued_items = ctx.pending_items
        upload_batch.processing_items = 0
        upload_batch.done_items = ctx.done_items
        upload_batch.failed_items = ctx.failed_items
        upload_batch.last_heartbeat_at = datetime.now(timezone.utc)
        status = calculate_batch_status(
            total=upload_batch.total_items,
            pending=ctx.pending_items,
            processing=0,
            failed=ctx.failed_items,
        )
        upload_batch.status = status
        if status == BatchStatus.running:
            upload_batch.finished_at = None
        else:
            upload_batch.finished_at = datetime.now(timezone.utc)

    async def _attach_album_if_needed(
        self,
        album_id: uuid.UUID | None,
        queued_media_ids: list[uuid.UUID],
        user: User,
    ) -> None:
        if album_id is None or not queued_media_ids:
            return
        from backend.app.services.albums import AlbumService

        await AlbumService(self._db).add_media_to_album(album_id, queued_media_ids, user)

    def _build_response(self, upload_batch: ImportBatch, ctx: UploadBatchContext) -> BatchUploadResponse:
        return BatchUploadResponse(
            batch_id=upload_batch.id,
            batch_url=f"/api/v1/me/import-batches/{upload_batch.id}",
            batch_items_url=f"/api/v1/me/import-batches/{upload_batch.id}/items",
            accepted=ctx.accepted,
            duplicates=ctx.duplicates,
            errors=ctx.errors,
            results=ctx.results,
        )


class MediaUploadService:
    def __init__(self, db: AsyncSession, processing: MediaProcessingService, query: MediaQueryService) -> None:
        self._db = db
        self._processing = processing
        self._query = query
        self._tags = TagRepository(db)
        self._post_processor = MediaPostProcessor(processing)

    async def upload_files(
        self,
        user: User,
        files: list[UploadFile],
        *,
        album_id: uuid.UUID | None = None,
        tags: list[str] | None = None,
        captured_at_override: datetime | None = None,
        captured_at_values: list[datetime] | None = None,
        visibility: MediaVisibility = MediaVisibility.private,
    ) -> BatchUploadResponse:
        workflow = MediaUploadWorkflow(
            db=self._db,
            query=self._query,
            tags_repo=self._tags,
            post_processor=self._post_processor,
        )
        return await workflow.run(
            user=user,
            files=files,
            album_id=album_id,
            tags=tags,
            captured_at_override=captured_at_override,
            captured_at_values=captured_at_values,
            visibility=visibility,
        )

    async def build_upload_response(
        self,
        user: User,
        files: list[UploadFile],
        *,
        album_id: uuid.UUID | None = None,
        tags: list[str] | None = None,
        captured_at_override: datetime | None = None,
        captured_at_values: list[datetime] | None = None,
        visibility: MediaVisibility = MediaVisibility.private,
    ) -> BatchUploadResponse:
        return await self.upload_files(
            user,
            files,
            album_id=album_id,
            tags=tags,
            captured_at_override=captured_at_override,
            captured_at_values=captured_at_values,
            visibility=visibility,
        )

    async def mark_upload_batch_item_done(self, media_id: uuid.UUID) -> None:
        item = await self._query.get_upload_batch_item_for_media(media_id)
        if item is None:
            return
        item.status = ItemStatus.done
        item.step = ProcessingStep.tag
        item.progress_percent = 100
        item.error = None
        await self._refresh_import_batch_status(item.batch_id)
        await self._db.commit()

    async def mark_upload_batch_item_failed(self, media_id: uuid.UUID, error_message: str) -> None:
        item = await self._query.get_upload_batch_item_for_media(media_id)
        if item is None:
            return
        item.status = ItemStatus.failed
        item.step = ProcessingStep.tag
        item.progress_percent = 100
        item.error = error_message
        await self._refresh_import_batch_status(item.batch_id)
        await self._db.commit()

    async def _refresh_import_batch_status(self, batch_id: uuid.UUID) -> None:
        batch = await self._query.get_import_batch(batch_id)
        if batch is None:
            return

        statuses = await self._query.get_import_batch_statuses(batch_id)
        batch.total_items = len(statuses)
        batch.queued_items = sum(1 for status in statuses if status == ItemStatus.pending)
        batch.processing_items = sum(1 for status in statuses if status == ItemStatus.processing)
        batch.done_items = sum(1 for status in statuses if status in {ItemStatus.done, ItemStatus.skipped})
        batch.failed_items = sum(1 for status in statuses if status == ItemStatus.failed)
        batch.last_heartbeat_at = datetime.now(timezone.utc)

        if batch.queued_items > 0 or batch.processing_items > 0:
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


def _normalize_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)
