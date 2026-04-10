from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timezone
from typing import Any

from fastapi import UploadFile
from sqlalchemy import inspect, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.errors.error import AppError
from backend.app.models.auth import User
from backend.app.models.media import Media, MediaType, MediaVisibility
from backend.app.models.processing import BatchStatus, BatchType, ImportBatch, ImportBatchItem, ItemStatus, ProcessingStep
from backend.app.models.relations import MediaEntity, MediaEntityType
from backend.app.repositories.tags import TagRepository
from backend.app.schemas import BatchUploadResponse, UploadResult
from backend.app.utils.media_common import build_tag_payloads, normalize_manual_tags
from backend.app.services.media import get_tag_queue
from backend.app.services.media.processing import MediaProcessingService
from backend.app.services.media.query import MediaQueryService
from backend.app.utils.media_metadata import extract_media_metadata
from backend.app.utils.storage import SavedUpload, delete_media_files, save_bytes, save_upload
from backend.app.utils.tagging import tag_names_mark_nsfw, tag_names_mark_sensitive
from backend.app.utils.thumbnails import generate_poster_and_thumbnail
from backend.app.ml.ocr import ocr_backend

logger = logging.getLogger(__name__)


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
    remaining_bytes: int | None = None


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
            logger.info("Queued media for background post-processing count=%s", len(media_ids))
            for media_id in media_ids:
                await queue.put(media_id)
            return
        logger.info("Running inline OCR post-processing count=%s", len(media_ids))
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
        captured_at_override: datetime | None = None,
        character_names: list[str] | None = None,
        series_names: list[str] | None = None,
        captured_at_values: list[datetime] | None = None,
        visibility: MediaVisibility = MediaVisibility.private,
    ) -> BatchUploadResponse:
        upload_batch = await self._create_upload_batch(user, len(files))
        logger.info(
            "Upload batch started batch_id=%s user_id=%s file_count=%s album_id=%s visibility=%s",
            upload_batch.id,
            user.id,
            len(files),
            album_id,
            visibility.value,
        )
        ctx = UploadBatchContext()
        if not user.is_admin:
            from backend.app.repositories.media import MediaRepository
            current_storage = await MediaRepository(self._db).sum_file_size(uploader_id=user.id)
            ctx.remaining_bytes = user.storage_quota_mb * 1024 * 1024 - current_storage

        for index, upload in enumerate(files):
            per_file_override = captured_at_override
            if captured_at_values and index < len(captured_at_values):
                per_file_override = captured_at_values[index]
            await self._process_single_upload(
                upload_batch=upload_batch,
                upload=upload,
                user=user,
                tags=tags,
                character_names=character_names,
                series_names=series_names,
                captured_at_override=per_file_override,
                visibility=visibility,
                ctx=ctx,
            )

        self._finalize_upload_batch(upload_batch, ctx)
        await self._db.commit()
        await self._attach_album_if_needed(album_id, ctx.queued_media_ids, user)
        await self._post_processor.dispatch(ctx.processing_media_ids)
        logger.info(
            "Upload batch finished batch_id=%s accepted=%s duplicates=%s errors=%s queued=%s",
            upload_batch.id,
            ctx.accepted,
            ctx.duplicates,
            ctx.errors,
            len(ctx.processing_media_ids),
        )
        return self._build_response(upload_batch, ctx)

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
        character_names: list[str] | None = None,
        series_names: list[str] | None = None,
        visibility: MediaVisibility,
        ctx: UploadBatchContext,
    ) -> None:
        original_name = upload.filename or "unknown"
        batch_item = self._new_batch_item(upload_batch.id, original_name)

        saved = await save_upload(upload)
        if saved is None:
            logger.warning("Upload file rejected original_name=%s", original_name)
            await self._handle_failed_upload(batch_item, original_name, ctx)
            return

        if ctx.remaining_bytes is not None and saved.file_size > ctx.remaining_bytes:
            logger.warning("Upload file rejected quota exceeded original_name=%s file_size=%s remaining=%s", original_name, saved.file_size, ctx.remaining_bytes)
            from backend.app.utils.storage import delete_media_files
            delete_media_files(str(saved.path))
            await self._handle_failed_upload(batch_item, original_name, ctx, error="Storage quota exceeded")
            return

        file_metadata = extract_media_metadata(str(saved.path), saved.media_type)
        if captured_at_override is not None:
            captured_at = _normalize_utc(captured_at_override)
        elif file_metadata.captured_at:
            captured_at = file_metadata.captured_at
        else:
            file_mtime = saved.path.stat().st_mtime
            captured_at = datetime.fromtimestamp(file_mtime, tz=UTC)

        existing = await self._query.get_media_by_sha256(saved.sha256, user.id)
        if existing is not None:
            logger.info("Upload file matched existing media original_name=%s existing_media_id=%s", original_name, existing.id)
            await self._handle_existing_media(
                batch_item=batch_item,
                existing=existing,
                original_name=original_name,
                captured_at=captured_at,
                saved_path=str(saved.path),
                tags=tags,
                character_names=character_names,
                series_names=series_names,
                ctx=ctx,
            )
            return

        if ctx.remaining_bytes is not None:
            ctx.remaining_bytes -= saved.file_size
        await self._handle_new_media(
            batch_item=batch_item,
            user=user,
            original_name=original_name,
            saved=saved,
            file_metadata=file_metadata,
            tags=tags,
            character_names=character_names,
            series_names=series_names,
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
        error: str = "Unsupported type or file too large",
    ) -> None:
        batch_item.status = ItemStatus.failed
        batch_item.error = error
        batch_item.progress_percent = 100

        self._db.add(batch_item)
        await self._db.flush()

        ctx.errors += 1
        ctx.failed_items += 1
        logger.warning("Upload file failed original_name=%s reason=%s", original_name, batch_item.error)
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
        tags: list[str] | None = None,
        character_names: list[str] | None = None,
        series_names: list[str] | None = None,
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
            logger.info("Upload duplicate skipped media_id=%s original_name=%s", existing.id, original_name)
            ctx.results.append(
                UploadResult(
                    id=existing.id,
                    batch_item_id=batch_item.id,
                    original_filename=original_name,
                    status="duplicate",
                    message=batch_item.error,
                )
            )
            return

        existing.deleted_at = None
        existing.original_filename = original_name
        normalized_tags = normalize_manual_tags(tags) if tags else []
        normalized_characters = _normalize_entity_names(character_names)
        normalized_series = _normalize_entity_names(series_names)
        has_manual_annotations = bool(normalized_tags or normalized_characters or normalized_series)
        existing.tagging_status = "done" if has_manual_annotations else "pending"
        existing.tagging_error = None
        existing.captured_at = existing.captured_at or captured_at
        if has_manual_annotations:
            await self._apply_manual_annotations(
                media=existing,
                normalized_tags=normalized_tags,
                normalized_characters=normalized_characters,
                normalized_series=normalized_series,
            )

        batch_item.media_id = existing.id
        batch_item.status = ItemStatus.done if has_manual_annotations else ItemStatus.pending
        batch_item.step = ProcessingStep.tag
        batch_item.progress_percent = 100 if has_manual_annotations else 0

        self._db.add(batch_item)
        await self._db.flush()

        ctx.accepted += 1
        if has_manual_annotations:
            ctx.done_items += 1
        else:
            ctx.pending_items += 1
        ctx.queued_media_ids.append(existing.id)
        ctx.processing_media_ids.append(existing.id)
        logger.info("Upload restored deleted media media_id=%s original_name=%s", existing.id, original_name)
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
        character_names: list[str] | None = None,
        series_names: list[str] | None = None,
        visibility: MediaVisibility,
        ctx: UploadBatchContext,
    ) -> None:
        loop = asyncio.get_running_loop()
        poster, thumb = await loop.run_in_executor(None, generate_poster_and_thumbnail, str(saved.path), saved.media_type)
        normalized_tags = normalize_manual_tags(tags) if tags else []
        normalized_characters = _normalize_entity_names(character_names)
        normalized_series = _normalize_entity_names(series_names)
        has_manual_annotations = bool(normalized_tags or normalized_characters or normalized_series)

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
            tagging_status="done" if has_manual_annotations else "pending",
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

        if has_manual_annotations:
            await self._apply_manual_annotations(
                media=media,
                normalized_tags=normalized_tags,
                normalized_characters=normalized_characters,
                normalized_series=normalized_series,
            )
        logger.info(
            "Created new media from upload media_id=%s user_id=%s original_name=%s media_type=%s visibility=%s",
            media.id,
            user.id,
            original_name,
            getattr(media.media_type, "value", media.media_type),
            getattr(media.visibility, "value", media.visibility),
        )

        batch_item.media_id = media.id
        if has_manual_annotations:
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
        logger.info(
            "Upload accepted media_id=%s original_name=%s manual_tags=%s manual_characters=%s manual_series=%s",
            media.id,
            original_name,
            len(normalized_tags),
            len(normalized_characters),
            len(normalized_series),
        )
        ctx.results.append(
            UploadResult(
                id=media.id,
                batch_item_id=batch_item.id,
                original_filename=original_name,
                status="accepted",
            )
        )

    async def _apply_manual_annotations(
        self,
        *,
        media: Media,
        normalized_tags: list[str],
        normalized_characters: list[str],
        normalized_series: list[str],
    ) -> None:
        if normalized_tags:
            await self._tags_repo.set_media_tag_links(media, build_tag_payloads(normalized_tags))
        media.is_nsfw = tag_names_mark_nsfw(normalized_tags)
        media.is_sensitive = tag_names_mark_sensitive(normalized_tags)

        state = inspect(media)
        if state.pending or not hasattr(self._db, "sync_session"):
            existing_entities: list[MediaEntity] = []
        else:
            result = await self._db.execute(
                select(MediaEntity).where(MediaEntity.media_id == media.id)
            )
            scalars = getattr(result, "scalars", None)
            if callable(scalars):
                scalar_result = scalars()
                all_rows = getattr(scalar_result, "all", None)
                existing_entities = all_rows() if callable(all_rows) else []
            else:
                existing_entities = []
        for entity in existing_entities:
            await self._db.delete(entity)
        await self._db.flush()

        entities: list[MediaEntity] = []
        for character_name in normalized_characters:
            entity = MediaEntity(
                media_id=media.id,
                entity_type=MediaEntityType.character,
                name=character_name,
                role="primary",
                source="manual",
                confidence=1.0,
            )
            entities.append(entity)
            self._db.add(entity)
        for series_name in normalized_series:
            entity = MediaEntity(
                media_id=media.id,
                entity_type=MediaEntityType.series,
                name=series_name,
                role="primary",
                source="manual",
                confidence=1.0,
            )
            entities.append(entity)
            self._db.add(entity)

    async def run_from_url(
        self,
        *,
        user: User,
        url: str,
        album_id: uuid.UUID | None,
        tags: list[str] | None,
        visibility: MediaVisibility,
    ) -> BatchUploadResponse:
        from backend.app.services.media.url_fetch import fetch_url_as_bytes
        from backend.app.repositories.media import MediaRepository

        if user.is_admin:
            max_size = 10 * 1024 ** 3
        else:
            current_storage = await MediaRepository(self._db).sum_file_size(uploader_id=user.id)
            max_size = user.storage_quota_mb * 1024 * 1024 - current_storage

        content, mime_type = await fetch_url_as_bytes(url, max_size_bytes=max(max_size, 0))
        saved = await save_bytes(content, mime_type)
        if saved is None:
            from backend.app.errors.upload import unsupported_media_type
            raise AppError(400, unsupported_media_type, "Unsupported media type or file too large")

        path_segment = url.rstrip("/").split("/")[-1].split("?")[0] or "download"
        original_name = path_segment[:255]

        upload_batch = await self._create_upload_batch(user, total_items=1)
        logger.info(
            "URL ingest batch started batch_id=%s user_id=%s url=%s",
            upload_batch.id,
            user.id,
            url,
        )
        ctx = UploadBatchContext()

        file_metadata = extract_media_metadata(str(saved.path), saved.media_type)
        captured_at = datetime.now(UTC)

        existing = await self._query.get_media_by_sha256(saved.sha256, user.id)
        batch_item = self._new_batch_item(upload_batch.id, original_name)

        if existing is not None:
            await self._handle_existing_media(
                batch_item=batch_item,
                existing=existing,
                original_name=original_name,
                captured_at=captured_at,
                saved_path=str(saved.path),
                tags=tags,
                character_names=None,
                series_names=None,
                ctx=ctx,
            )
        else:
            await self._handle_new_media(
                batch_item=batch_item,
                user=user,
                original_name=original_name,
                saved=saved,
                file_metadata=file_metadata,
                tags=tags,
                character_names=None,
                series_names=None,
                captured_at=captured_at,
                visibility=visibility,
                ctx=ctx,
            )

        self._finalize_upload_batch(upload_batch, ctx)
        await self._db.commit()
        await self._attach_album_if_needed(album_id, ctx.queued_media_ids, user)
        await self._post_processor.dispatch(ctx.processing_media_ids)
        logger.info(
            "URL ingest batch finished batch_id=%s accepted=%s duplicates=%s errors=%s",
            upload_batch.id,
            ctx.accepted,
            ctx.duplicates,
            ctx.errors,
        )
        return self._build_response(upload_batch, ctx)

    async def create_media_from_saved_upload(
        self,
        *,
        user: User,
        original_name: str,
        saved: SavedUpload,
        captured_at: datetime,
        visibility: MediaVisibility,
        tags: list[str] | None = None,
    ) -> Media:
        file_metadata = extract_media_metadata(str(saved.path), saved.media_type)
        loop = asyncio.get_running_loop()
        poster, thumb = await loop.run_in_executor(None, generate_poster_and_thumbnail, str(saved.path), saved.media_type)
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
            tagging_status="done" if normalized_tags else "pending",
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

        if normalized_tags:
            await self._tags_repo.set_media_tag_links(media, build_tag_payloads(normalized_tags))
            media.is_nsfw = tag_names_mark_nsfw(normalized_tags)
            media.is_sensitive = tag_names_mark_sensitive(normalized_tags)

        return media

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
        logger.info("Attached uploaded media to album album_id=%s user_id=%s media_count=%s", album_id, user.id, len(queued_media_ids))

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
            character_names=None,
            series_names=None,
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

    async def upload_files_with_annotations(
        self,
        user: User,
        files: list[UploadFile],
        *,
        album_id: uuid.UUID | None = None,
        tags: list[str] | None = None,
        character_names: list[str] | None = None,
        series_names: list[str] | None = None,
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
            character_names=character_names,
            series_names=series_names,
            captured_at_override=captured_at_override,
            captured_at_values=captured_at_values,
            visibility=visibility,
        )

    async def ingest_url(
        self,
        user: User,
        url: str,
        *,
        album_id: uuid.UUID | None = None,
        tags: list[str] | None = None,
        visibility: MediaVisibility = MediaVisibility.private,
    ) -> BatchUploadResponse:
        workflow = MediaUploadWorkflow(
            db=self._db,
            query=self._query,
            tags_repo=self._tags,
            post_processor=self._post_processor,
        )
        return await workflow.run_from_url(
            user=user,
            url=url,
            album_id=album_id,
            tags=tags,
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

        previous_status = batch.status

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

        if batch.type == BatchType.upload and previous_status == BatchStatus.running:
            await self._auto_compute_recommendation_groups_for_batch(batch)

    async def _auto_compute_recommendation_groups_for_batch(self, batch: ImportBatch) -> None:
        from backend.app.services.processing import ProcessingService

        try:
            await ProcessingService(self._db).list_batch_review_items(
                batch_id=batch.id,
                user_id=batch.user_id,
                include_recommendations=True,
                force_refresh=True,
            )
            logger.info("Auto-computed recommendation groups for completed upload batch batch_id=%s", batch.id)
        except Exception:
            logger.exception(
                "Failed to auto-compute recommendation groups for completed upload batch batch_id=%s",
                batch.id,
            )


def _normalize_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _normalize_entity_names(values: list[str] | None) -> list[str]:
    if not values:
        return []
    normalized: list[str] = []
    seen: set[str] = set()
    for value in values:
        cleaned = value.strip()
        if not cleaned:
            continue
        key = cleaned.casefold()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(cleaned)
    return normalized
