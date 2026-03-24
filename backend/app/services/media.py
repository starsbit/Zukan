from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from fastapi import UploadFile
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.app.config import settings
from backend.app.errors.error import AppError
from backend.app.errors.albums import album_not_found
from backend.app.errors.media import media_not_found, nsfw_hidden, nsfw_disabled
from backend.app.errors.tags import tagging_job_already_queued
from backend.app.errors.upload import upload_limit_exceeded, version_conflict
from backend.app.models.auth import User
from backend.app.models.albums import Album, AlbumMedia, AlbumShare
from backend.app.models.media import Media, MediaTag, MediaType
from backend.app.models.relations import MediaEntity, MediaExternalRef
from backend.app.models.media_interactions import UserFavorite
from backend.app.models.processing import BatchStatus, BatchType, ImportBatch, ImportBatchItem, ItemStatus, ProcessingStep
from backend.app.repositories import media_filters
from backend.app.repositories.media import MediaRepository
from backend.app.repositories.media_interactions import UserFavoriteRepository
from backend.app.repositories.relations import MediaEntityRepository, MediaExternalRefRepository
from backend.app.repositories.tags import TagRepository
from backend.app.schemas import (
    BatchUploadResponse,
    BulkResult,
    CATEGORY_NAMES,
    EntityRead,
    ExternalRefRead,
    MediaIdsRequest,
    MediaBatchUpdate,
    MediaCursorPage,
    MediaDetail,
    MediaListState,
    MediaMetadataFilter,
    MediaUpdate,
    NsfwFilter,
    TagFilterMode,
    TagWithConfidence,
    UploadResult,
)
from backend.app.utils.media_metadata import extract_media_metadata
from backend.app.utils.media_projections import build_media_read, enrich_media
from backend.app.utils.pagination import (
    apply_cursor_where,
    captured_timestamp_expr,
    decode_cursor,
    encode_cursor,
)
from backend.app.utils.storage import delete_media_files, save_upload
from backend.app.utils.tagging import tag_names_mark_nsfw
from backend.app.utils.thumbnails import generate_poster_and_thumbnail
from backend.app.ml.ocr import TesseractOCR, ocr_backend

TRASH_RETENTION_DAYS = 30

_tag_queue: asyncio.Queue | None = None


def set_tag_queue(queue: asyncio.Queue) -> None:
    global _tag_queue
    _tag_queue = queue


def get_tag_queue() -> asyncio.Queue | None:
    return _tag_queue


class MediaService:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def purge_expired_trash(self, now: datetime | None = None) -> int:
        cutoff = (now or datetime.now(timezone.utc)) - timedelta(days=TRASH_RETENTION_DAYS)
        expired = await MediaRepository(self._db).get_expired_trash(cutoff)
        for media in expired:
            await self.purge_media_record(media)
        if expired:
            await self._db.commit()
        return len(expired)

    async def purge_media_record(self, media: Media) -> None:
        await MediaRepository(self._db).delete(media)
        delete_media_files(media.filepath, media.poster_path, media.thumbnail_path)

    async def get_owned_or_admin_media(self, media_id: uuid.UUID, user: User, trashed: bool | None) -> Media:
        media = await MediaRepository(self._db).get_by_id(media_id)
        if media is not None:
            if trashed is True and media.deleted_at is None:
                media = None
            elif trashed is False and media.deleted_at is not None:
                media = None
        if media is None:
            detail = "Not found in trash" if trashed is True else "Not found"
            raise AppError(status_code=404, code=media_not_found, detail=detail)
        if media.uploader_id != user.id and not user.is_admin:
            raise AppError(status_code=403, code=media_not_found, detail="Forbidden")
        return media

    async def get_active_media(self, media_id: uuid.UUID) -> Media:
        media = await MediaRepository(self._db).get_by_id(media_id)
        if media is None or media.deleted_at is not None:
            raise AppError(status_code=404, code=media_not_found, detail="Not found")
        return media

    async def get_visible_media(self, media_id: uuid.UUID, user: User) -> Media:
        await self.purge_expired_trash()
        media = await MediaRepository(self._db).get_by_id(media_id)
        if media is None:
            raise AppError(status_code=404, code=media_not_found, detail="Not found")
        if media.deleted_at is not None and media.uploader_id != user.id and not user.is_admin:
            raise AppError(status_code=404, code=media_not_found, detail="Not found")
        if media.is_nsfw and not user.show_nsfw and not user.is_admin:
            raise AppError(status_code=403, code=nsfw_hidden, detail="NSFW content hidden")
        return media

    async def get_media_detail(self, media_id: uuid.UUID, user: User) -> MediaDetail:
        await self.purge_expired_trash()
        media = await MediaRepository(self._db).get_by_id_with_relations(media_id, deleted=False)
        if media is None:
            raise AppError(status_code=404, code=media_not_found, detail="Not found")
        if media.is_nsfw and not user.show_nsfw and not user.is_admin:
            raise AppError(status_code=403, code=nsfw_hidden, detail="NSFW content hidden")
        return await self.build_media_detail(media, user.id)

    async def build_media_detail(self, media: Media, user_id: uuid.UUID) -> MediaDetail:
        is_favorited = await UserFavoriteRepository(self._db).get(media.id, user_id) is not None
        tag_details = [
            TagWithConfidence(
                name=item.tag.name,
                category=item.tag.category,
                category_name=CATEGORY_NAMES.get(item.tag.category, "unknown"),
                category_key=CATEGORY_NAMES.get(item.tag.category, "unknown"),
                confidence=item.confidence,
            )
            for item in sorted(media.media_tags, key=lambda item: item.confidence, reverse=True)
        ]
        external_refs = [
            ExternalRefRead(id=ref.id, provider=ref.provider, external_id=ref.external_id, url=ref.url)
            for ref in media.external_refs
        ]
        entities = [
            EntityRead(
                id=entity.id,
                entity_type=entity.entity_type,
                entity_id=entity.entity_id,
                name=entity.name,
                role=entity.role,
                source=entity.source,
                confidence=entity.confidence,
            )
            for entity in media.entities
        ]
        base = build_media_read(media, is_favorited)
        return MediaDetail(**base.model_dump(), tag_details=tag_details, external_refs=external_refs, entities=entities)

    async def list_media(
        self,
        user: User,
        state: MediaListState,
        tags: list[str] | None,
        character_name: str | None,
        exclude_tags: list[str] | None,
        mode: TagFilterMode,
        nsfw: NsfwFilter,
        status_filter: str | None,
        metadata: MediaMetadataFilter,
        favorited: bool | None,
        media_type: list[str] | None = None,
        album_id: uuid.UUID | None = None,
        after: str | None = None,
        page_size: int = 20,
        sort_by: str = "captured_at",
        sort_order: str = "desc",
        ocr_text: str | None = None,
        include_total: bool = True,
    ) -> MediaCursorPage:
        await self.purge_expired_trash()
        stmt = select(Media).options(selectinload(Media.media_tags).selectinload(MediaTag.tag))
        if album_id is not None:
            await self._ensure_album_is_visible(user, album_id)
            stmt = stmt.join(AlbumMedia, AlbumMedia.media_id == Media.id).where(AlbumMedia.album_id == album_id)
        if state == MediaListState.TRASHED:
            stmt = stmt.where(Media.deleted_at.is_not(None))
            if not user.is_admin:
                stmt = stmt.where(Media.uploader_id == user.id)
        else:
            stmt = stmt.where(Media.deleted_at.is_(None))
            if nsfw == NsfwFilter.ONLY and not user.show_nsfw and not user.is_admin:
                raise AppError(status_code=403, code=nsfw_disabled, detail="Enable NSFW in your profile first")
            stmt = media_filters.apply_nsfw_list_filter(stmt, user, nsfw)
        status_values = [v for v in _parse_csv_values(status_filter) if v != "any"]
        if status_values:
            stmt = stmt.where(Media.tagging_status.in_(status_values))
        if favorited is True:
            stmt = stmt.join(UserFavorite, and_(UserFavorite.media_id == Media.id, UserFavorite.user_id == user.id))

        stmt = media_filters.apply_tag_filters(stmt, tags, exclude_tags, mode)
        stmt = media_filters.apply_character_name_filter(stmt, character_name)
        stmt = media_filters.apply_media_type_filters(stmt, media_type)
        stmt = media_filters.apply_captured_at_filters(stmt, metadata)
        stmt = media_filters.apply_ocr_text_filter(stmt, ocr_text)

        total = (await self._db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one() if include_total else None

        if after is not None:
            decoded = decode_cursor(after, sort_by)
            if decoded is not None:
                cursor_val, cursor_id = decoded
                stmt = apply_cursor_where(stmt, sort_by, sort_order, cursor_val, cursor_id)

        sort_col = {
            "captured_at": captured_timestamp_expr(),
            "created_at": Media.created_at,
            "filename": Media.filename,
            "file_size": Media.file_size,
        }[sort_by]
        order_exprs = [sort_col.desc(), Media.id.desc()] if sort_order == "desc" else [sort_col.asc(), Media.id.asc()]

        rows = (await self._db.execute(stmt.order_by(*order_exprs).limit(page_size + 1))).scalars().all()
        has_more = len(rows) > page_size
        rows = rows[:page_size]
        favs = await UserFavoriteRepository(self._db).get_favorited_ids(user.id, [row.id for row in rows])

        next_cursor = None
        if has_more and rows:
            last = rows[-1]
            sv = (last.captured_at or last.created_at) if sort_by == "captured_at" else getattr(last, sort_by)
            next_cursor = encode_cursor(sv, last.id)

        return MediaCursorPage(total=total, next_cursor=next_cursor, has_more=has_more, page_size=page_size, items=enrich_media(rows, favs))

    async def list_character_suggestions(self, user: User, *, q: str, limit: int) -> list[dict[str, int | str]]:
        await self.purge_expired_trash()
        query = q.strip()
        if not query:
            return []
        return await MediaEntityRepository(self._db).list_character_suggestions(
            query=query,
            limit=limit,
            show_nsfw=user.show_nsfw,
            is_admin=user.is_admin,
        )

    async def build_upload_response(
        self,
        user: User,
        files: list[UploadFile],
        *,
        album_id: uuid.UUID | None = None,
        tags: list[str] | None = None,
        captured_at_override: datetime | None = None,
    ) -> BatchUploadResponse:
        await self.purge_expired_trash()
        if len(files) > settings.max_batch_size:
            raise AppError(status_code=400, code=upload_limit_exceeded, detail=f"Max {settings.max_batch_size} files per request")

        now = datetime.now(timezone.utc)
        upload_batch = ImportBatch(
            user_id=user.id,
            type=BatchType.upload,
            status=BatchStatus.running,
            total_items=len(files),
            started_at=now,
            last_heartbeat_at=now,
        )
        self._db.add(upload_batch)
        await self._db.flush()

        queue = get_tag_queue()
        results: list[UploadResult] = []
        accepted = duplicates = errors = 0
        pending_items = done_items = failed_items = processing_items = 0
        queued_media_ids: list[uuid.UUID] = []
        processing_media_ids: list[uuid.UUID] = []
        media_repo = MediaRepository(self._db)
        tags_repo = TagRepository(self._db)

        for upload in files:
            original_name = upload.filename or "unknown"
            batch_item = ImportBatchItem(
                batch_id=upload_batch.id,
                source_filename=original_name,
                status=ItemStatus.pending,
                step=ProcessingStep.ingest,
                progress_percent=0,
            )
            saved = await save_upload(upload)
            if saved is None:
                batch_item.status = ItemStatus.failed
                batch_item.error = "Unsupported type or file too large"
                batch_item.progress_percent = 100
                self._db.add(batch_item)
                await self._db.flush()
                results.append(
                    UploadResult(
                        id=None,
                        batch_item_id=batch_item.id,
                        original_filename=original_name,
                        status="error",
                        message=batch_item.error,
                    )
                )
                errors += 1
                failed_items += 1
                continue

            file_metadata = extract_media_metadata(str(saved.path), saved.media_type)
            captured_at = file_metadata.captured_at or datetime.now(timezone.utc)
            existing = await media_repo.get_by_sha256(saved.sha256)
            if existing is not None:
                delete_media_files(str(saved.path))
                if existing.deleted_at is None:
                    batch_item.media_id = existing.id
                    batch_item.status = ItemStatus.skipped
                    batch_item.error = "Media already exists"
                    batch_item.progress_percent = 100
                    self._db.add(batch_item)
                    await self._db.flush()
                    results.append(
                        UploadResult(
                            id=None,
                            batch_item_id=batch_item.id,
                            original_filename=original_name,
                            status="duplicate",
                            message=batch_item.error,
                        )
                    )
                    duplicates += 1
                    done_items += 1
                    continue
                existing.deleted_at = None
                existing.original_filename = original_name
                existing.tagging_status = "pending"
                existing.tagging_error = None
                existing.captured_at = existing.captured_at or captured_at
                await self._db.flush()
                batch_item.media_id = existing.id
                batch_item.status = ItemStatus.pending
                batch_item.step = ProcessingStep.tag
                batch_item.progress_percent = 0
                self._db.add(batch_item)
                await self._db.flush()
                queued_media_ids.append(existing.id)
                processing_media_ids.append(existing.id)
                results.append(
                    UploadResult(
                        id=existing.id,
                        batch_item_id=batch_item.id,
                        original_filename=original_name,
                        status="accepted",
                    )
                )
                accepted += 1
                pending_items += 1
                continue

            poster, thumb = generate_poster_and_thumbnail(str(saved.path), saved.media_type)
            normalized_tags = _normalize_manual_tags(tags) if tags else []
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
                captured_at=captured_at_override or captured_at,
            )
            self._db.add(media)
            await self._db.flush()
            batch_item.media_id = media.id
            if normalized_tags:
                await tags_repo.set_media_tag_links(media, _build_tag_payloads(normalized_tags))
                media.is_nsfw = tag_names_mark_nsfw(normalized_tags)
                media.tagging_status = "done"
                batch_item.status = ItemStatus.done
                batch_item.step = ProcessingStep.tag
                batch_item.progress_percent = 100
                processing_media_ids.append(media.id)
                done_items += 1
            else:
                processing_media_ids.append(media.id)
                batch_item.status = ItemStatus.pending
                batch_item.step = ProcessingStep.tag
                batch_item.progress_percent = 0
                pending_items += 1
            self._db.add(batch_item)
            await self._db.flush()
            queued_media_ids.append(media.id)
            results.append(
                UploadResult(
                    id=media.id,
                    batch_item_id=batch_item.id,
                    original_filename=original_name,
                    status="accepted",
                )
            )
            accepted += 1

        upload_batch.queued_items = pending_items
        upload_batch.processing_items = processing_items
        upload_batch.done_items = done_items
        upload_batch.failed_items = failed_items
        upload_batch.last_heartbeat_at = datetime.now(timezone.utc)
        if pending_items or processing_items:
            upload_batch.status = BatchStatus.running
            upload_batch.finished_at = None
        elif failed_items == upload_batch.total_items and upload_batch.total_items > 0:
            upload_batch.status = BatchStatus.failed
            upload_batch.finished_at = datetime.now(timezone.utc)
        elif failed_items > 0:
            upload_batch.status = BatchStatus.partial_failed
            upload_batch.finished_at = datetime.now(timezone.utc)
        else:
            upload_batch.status = BatchStatus.done
            upload_batch.finished_at = datetime.now(timezone.utc)

        await self._db.commit()
        if album_id is not None and queued_media_ids:
            from backend.app.services.albums import AlbumService
            await AlbumService(self._db).add_media_to_album(album_id, queued_media_ids, user)
        if queue:
            for media_id in processing_media_ids:
                await queue.put(media_id)
        elif processing_media_ids:
            for media_id in processing_media_ids:
                await self.run_ocr_for_media(media_id, ocr_backend)
        return BatchUploadResponse(
            batch_id=upload_batch.id,
            batch_url=f"/api/v1/me/import-batches/{upload_batch.id}",
            batch_items_url=f"/api/v1/me/import-batches/{upload_batch.id}/items",
            accepted=accepted,
            duplicates=duplicates,
            errors=errors,
            results=results,
        )

    async def mark_upload_batch_item_done(self, media_id: uuid.UUID) -> None:
        item = (
            await self._db.execute(
                select(ImportBatchItem)
                .join(ImportBatch, ImportBatch.id == ImportBatchItem.batch_id)
                .where(
                    ImportBatch.type == BatchType.upload,
                    ImportBatchItem.media_id == media_id,
                    ImportBatchItem.status.in_([ItemStatus.pending, ItemStatus.processing]),
                )
                .order_by(ImportBatch.created_at.desc(), ImportBatchItem.updated_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if item is None:
            return
        item.status = ItemStatus.done
        item.step = ProcessingStep.tag
        item.progress_percent = 100
        item.error = None
        await self._refresh_import_batch_status(item.batch_id)
        await self._db.commit()

    async def mark_upload_batch_item_failed(self, media_id: uuid.UUID, error_message: str) -> None:
        item = (
            await self._db.execute(
                select(ImportBatchItem)
                .join(ImportBatch, ImportBatch.id == ImportBatchItem.batch_id)
                .where(
                    ImportBatch.type == BatchType.upload,
                    ImportBatchItem.media_id == media_id,
                    ImportBatchItem.status.in_([ItemStatus.pending, ItemStatus.processing]),
                )
                .order_by(ImportBatch.created_at.desc(), ImportBatchItem.updated_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if item is None:
            return
        item.status = ItemStatus.failed
        item.step = ProcessingStep.tag
        item.progress_percent = 100
        item.error = error_message
        await self._refresh_import_batch_status(item.batch_id)
        await self._db.commit()

    async def _refresh_import_batch_status(self, batch_id: uuid.UUID) -> None:
        batch = await self._db.get(ImportBatch, batch_id)
        if batch is None:
            return

        statuses = (
            await self._db.execute(select(ImportBatchItem.status).where(ImportBatchItem.batch_id == batch_id))
        ).scalars().all()
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

    async def get_downloadable_media(self, user: User, media_ids: list[uuid.UUID]) -> list[Media]:
        await self.purge_expired_trash()
        rows = await MediaRepository(self._db).get_by_ids(media_ids)
        rows = [row for row in rows if row.deleted_at is None]
        if not user.is_admin:
            rows = [row for row in rows if row.uploader_id == user.id]
        if not rows:
            raise AppError(status_code=404, code=media_not_found, detail="No accessible media found")
        return rows

    async def update_media_metadata(self, media_id: uuid.UUID, user: User, payload: MediaUpdate) -> MediaDetail:
        await self.purge_expired_trash()
        metadata_fields = payload.metadata.model_fields_set if payload.metadata is not None else set()
        needs_owner_access = any(field in payload.model_fields_set for field in {"tags", "entities", "metadata", "deleted", "ocr_text_override", "external_refs"})
        if needs_owner_access:
            media = await self.get_owned_or_admin_media(media_id, user, trashed=None)
        else:
            media = await self.get_active_media(media_id)

        if "version" in payload.model_fields_set and payload.version is not None and payload.version != media.version:
            raise AppError(
                status_code=409,
                code=version_conflict,
                detail="Version conflict: resource was modified by another request",
                details={
                    "current_version": media.version,
                    "provided_version": payload.version,
                },
            )

        if "tags" in payload.model_fields_set and payload.tags is not None:
            normalized_tags = _normalize_manual_tags(payload.tags)
            await TagRepository(self._db).set_media_tag_links(media, _build_tag_payloads(normalized_tags))
            media.is_nsfw = tag_names_mark_nsfw(normalized_tags)

        if "entities" in payload.model_fields_set and payload.entities is not None:
            for entity in await MediaEntityRepository(self._db).get_by_media(media.id):
                await self._db.delete(entity)
            await self._db.flush()
            for entity_create in payload.entities:
                self._db.add(MediaEntity(
                    media_id=media.id,
                    entity_type=entity_create.entity_type,
                    entity_id=entity_create.entity_id,
                    name=entity_create.name,
                    role=entity_create.role,
                    source="manual",
                    confidence=entity_create.confidence,
                ))
        if "metadata" in payload.model_fields_set and "captured_at" in metadata_fields:
            media.captured_at = payload.metadata.captured_at or media.created_at
        if "deleted" in payload.model_fields_set:
            media.deleted_at = datetime.now(timezone.utc) if payload.deleted else None
        if "ocr_text_override" in payload.model_fields_set:
            media.ocr_text_override = payload.ocr_text_override or None
        if "external_refs" in payload.model_fields_set and payload.external_refs is not None:
            for ref in await MediaExternalRefRepository(self._db).get_by_media(media.id):
                await self._db.delete(ref)
            await self._db.flush()
            for ref_create in payload.external_refs:
                self._db.add(MediaExternalRef(media_id=media.id, provider=ref_create.provider, external_id=ref_create.external_id, url=ref_create.url))
        if "favorited" in payload.model_fields_set:
            await self._set_favorite_state(media.id, user, payload.favorited)

        await self._db.commit()
        media = await MediaRepository(self._db).get_by_id_with_relations(media_id, deleted=None)
        return await self.build_media_detail(media, user.id)

    async def soft_delete_media(self, media_id: uuid.UUID, user: User) -> None:
        await self.purge_expired_trash()
        media = await self.get_owned_or_admin_media(media_id, user, trashed=False)
        media.deleted_at = datetime.now(timezone.utc)
        await self._db.commit()

    async def restore_media(self, media_id: uuid.UUID, user: User) -> None:
        await self.purge_expired_trash()
        media = await self.get_owned_or_admin_media(media_id, user, trashed=True)
        media.deleted_at = None
        await self._db.commit()

    async def purge_media(self, media_id: uuid.UUID, user: User) -> None:
        await self.purge_expired_trash()
        media = await self.get_owned_or_admin_media(media_id, user, trashed=None)
        await self.purge_media_record(media)
        await self._db.commit()

    async def retag_media(self, media_id: uuid.UUID, user: User) -> int:
        await self.purge_expired_trash()
        media = await self.get_owned_or_admin_media(media_id, user, trashed=False)
        if media.tagging_status in ("pending", "processing"):
            raise AppError(status_code=409, code=tagging_job_already_queued, detail="Tagging job is already queued or running")
        media.tagging_status = "pending"
        media.tagging_error = None
        await self._db.commit()
        queue = get_tag_queue()
        if queue:
            await queue.put(media_id)
        return 1

    async def mark_tagging_failure(self, media_id: uuid.UUID, exc: Exception) -> None:
        media = await MediaRepository(self._db).get_by_id(media_id)
        if media is None:
            return
        media.tagging_status = "failed"
        media.tagging_error = _format_tagging_error(exc)
        await self._db.commit()

    async def run_ocr_for_media(self, media_id: uuid.UUID, ocr_model: TesseractOCR | None) -> None:
        if ocr_model is None:
            return
        media = await MediaRepository(self._db).get_by_id(media_id)
        if media is None or media.deleted_at is not None:
            return
        try:
            media.ocr_text = await ocr_model.extract_text(media.filepath, media.media_type)
            await self._db.commit()
        except Exception as exc:
            # OCR is best-effort and should not fail the upload/tag pipeline.
            media.ocr_text = None
            await self._db.commit()
            print(f"OCR failed for {media_id}: {exc}")

    async def empty_trash(self, user: User) -> None:
        await self.purge_expired_trash()
        stmt = select(Media).where(Media.deleted_at.is_not(None))
        if not user.is_admin:
            stmt = stmt.where(Media.uploader_id == user.id)
        for media in (await self._db.execute(stmt)).scalars().all():
            await self.purge_media_record(media)
        await self._db.commit()

    async def favorite_media(self, media_id: uuid.UUID, user: User) -> None:
        await self.purge_expired_trash()
        await self._set_favorite_state(media_id, user, True)
        await self._db.commit()

    async def unfavorite_media(self, media_id: uuid.UUID, user: User) -> None:
        await self.purge_expired_trash()
        favorite = await UserFavoriteRepository(self._db).get(media_id, user.id)
        if favorite is None:
            raise AppError(status_code=404, code=media_not_found, detail="Not in favorites")
        await self._db.delete(favorite)
        await self._db.commit()

    async def batch_update_media(self, payload: MediaBatchUpdate, user: User) -> BulkResult:
        await self.purge_expired_trash()
        processed = skipped = 0
        if payload.deleted is not None:
            processed, skipped = await self._batch_update_deleted_state(payload.media_ids, payload.deleted, user)
        elif payload.favorited is not None:
            processed, skipped = await self._batch_update_favorite_state(payload.media_ids, payload.favorited, user)
        return BulkResult(processed=processed, skipped=skipped)

    async def batch_delete_media(self, payload: MediaIdsRequest, user: User) -> BulkResult:
        await self.purge_expired_trash()
        processed, skipped = await self._batch_update_deleted_state(payload.media_ids, True, user)
        return BulkResult(processed=processed, skipped=skipped)

    async def bulk_delete_media(self, media_ids: list[uuid.UUID], user: User) -> BulkResult:
        await self.purge_expired_trash()
        processed, skipped = await self._batch_update_deleted_state(media_ids, True, user)
        return BulkResult(processed=processed, skipped=skipped)

    async def bulk_restore_media(self, media_ids: list[uuid.UUID], user: User) -> BulkResult:
        await self.purge_expired_trash()
        processed, skipped = await self._batch_update_deleted_state(media_ids, False, user)
        return BulkResult(processed=processed, skipped=skipped)

    async def bulk_purge_media(self, media_ids: list[uuid.UUID], user: User) -> BulkResult:
        await self.purge_expired_trash()
        rows = await MediaRepository(self._db).get_by_ids(media_ids)
        found_ids = {row.id for row in rows}
        skipped = len(media_ids) - len(found_ids)
        processed = 0
        for media in rows:
            if media.uploader_id == user.id or user.is_admin:
                await self.purge_media_record(media)
                processed += 1
            else:
                skipped += 1
        await self._db.commit()
        return BulkResult(processed=processed, skipped=skipped)

    async def bulk_favorite_media(self, media_ids: list[uuid.UUID], user: User) -> BulkResult:
        await self.purge_expired_trash()
        processed, skipped = await self._batch_update_favorite_state(media_ids, True, user)
        return BulkResult(processed=processed, skipped=skipped)

    async def bulk_unfavorite_media(self, media_ids: list[uuid.UUID], user: User) -> BulkResult:
        await self.purge_expired_trash()
        processed, skipped = await self._batch_update_favorite_state(media_ids, False, user)
        return BulkResult(processed=processed, skipped=skipped)

    async def batch_purge_media(self, payload: MediaIdsRequest, user: User) -> BulkResult:
        await self.purge_expired_trash()
        rows = await MediaRepository(self._db).get_by_ids(payload.media_ids)
        found_ids = {row.id for row in rows}
        skipped = len(payload.media_ids) - len(found_ids)
        processed = 0
        for media in rows:
            if media.uploader_id == user.id or user.is_admin:
                await self.purge_media_record(media)
                processed += 1
            else:
                skipped += 1
        await self._db.commit()
        return BulkResult(processed=processed, skipped=skipped)

    async def _ensure_album_is_visible(self, user: User, album_id: uuid.UUID) -> None:
        album = (await self._db.execute(select(Album).where(Album.id == album_id))).scalar_one_or_none()
        if album is None:
            raise AppError(status_code=404, code=album_not_found, detail="Album not found")
        if album.owner_id == user.id or user.is_admin:
            return
        share = (
            await self._db.execute(select(AlbumShare).where(AlbumShare.album_id == album_id, AlbumShare.user_id == user.id))
        ).scalar_one_or_none()
        if share is None:
            raise AppError(status_code=404, code=album_not_found, detail="Album not found")

    async def _set_favorite_state(self, media_id: uuid.UUID, user: User, favorited: bool | None) -> bool:
        await self.get_active_media(media_id)
        existing = await UserFavoriteRepository(self._db).get(media_id, user.id)
        if favorited is True and existing is None:
            self._db.add(UserFavorite(user_id=user.id, media_id=media_id))
            return True
        if favorited is False and existing is not None:
            await self._db.delete(existing)
            return True
        return False

    async def _batch_update_deleted_state(self, media_ids: list[uuid.UUID], deleted: bool, user: User) -> tuple[int, int]:
        rows = await MediaRepository(self._db).get_by_ids(media_ids)
        found_ids = {row.id for row in rows}
        skipped = len(media_ids) - len(found_ids)
        processed = 0
        now = datetime.now(timezone.utc)
        for media in rows:
            if media.uploader_id != user.id and not user.is_admin:
                skipped += 1
                continue
            if deleted and media.deleted_at is None:
                media.deleted_at = now
                processed += 1
            elif not deleted and media.deleted_at is not None:
                media.deleted_at = None
                processed += 1
            else:
                skipped += 1
        await self._db.commit()
        return processed, skipped

    async def _batch_update_favorite_state(self, media_ids: list[uuid.UUID], favorited: bool, user: User) -> tuple[int, int]:
        active_ids = await MediaRepository(self._db).get_active_ids(media_ids)
        favorites_repo = UserFavoriteRepository(self._db)
        existing_favorites = await favorites_repo.get_by_user_and_media_ids(user.id, media_ids)
        existing_ids = {f.media_id for f in existing_favorites}
        if favorited:
            to_change = active_ids - existing_ids
            for media_id in to_change:
                self._db.add(UserFavorite(user_id=user.id, media_id=media_id))
        else:
            to_change = existing_ids
            for favorite in existing_favorites:
                await self._db.delete(favorite)
        await self._db.commit()
        return len(to_change), len(media_ids) - len(to_change)


def _parse_csv_values(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def _normalize_manual_tags(tags: list[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for tag in tags:
        cleaned = tag.strip()
        if not cleaned or cleaned in seen:
            continue
        normalized.append(cleaned)
        seen.add(cleaned)
    return normalized


def _build_tag_payloads(
    tag_names: list[str],
    *,
    default_category: int = 0,
    default_confidence: float = 1.0,
) -> list[tuple[str, int, float]]:
    return [(tag_name, default_category, default_confidence) for tag_name in _normalize_manual_tags(tag_names)]


def _format_tagging_error(exc: Exception) -> str:
    message = str(exc).strip() or exc.__class__.__name__
    return f"{exc.__class__.__name__}: {message}"[:1024]
