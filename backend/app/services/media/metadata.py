from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.errors.error import AppError
from backend.app.errors.upload import version_conflict
from backend.app.models.auth import User
from backend.app.models.relations import MediaEntityType
from backend.app.models.relations import MediaEntity, MediaExternalRef
from backend.app.repositories.relations import MediaEntityRepository
from backend.app.repositories.tags import TagRepository
from backend.app.schemas import BulkResult, MediaDetail, MediaEntityBatchUpdate, MediaUpdate
from backend.app.services.media.interactions import MediaInteractionService
from backend.app.services.media.query import MediaQueryService
from backend.app.utils.media_common import build_tag_payloads, normalize_manual_tags
from backend.app.utils.tagging import tag_names_mark_sensitive, tag_names_mark_nsfw

logger = logging.getLogger(__name__)


class MediaMetadataService:
    def __init__(
        self,
        db: AsyncSession,
        query: MediaQueryService,
        interactions: MediaInteractionService,
    ) -> None:
        self._db = db
        self._query = query
        self._interactions = interactions

    async def update_media_metadata(self, media_id: uuid.UUID, user: User, payload: MediaUpdate) -> MediaDetail:
        metadata_fields = payload.metadata.model_fields_set if payload.metadata is not None else set()
        needs_owner_access = any(field in payload.model_fields_set for field in {"tags", "entities", "metadata", "deleted", "ocr_text_override", "external_refs", "visibility", "metadata_review_dismissed"})
        if needs_owner_access:
            media = await self._query.get_owned_or_admin_media(media_id, user, trashed=None)
        else:
            media = await self._query.get_active_media(media_id)
        logger.info(
            "Updating media metadata user_id=%s media_id=%s fields=%s",
            user.id,
            media_id,
            sorted(payload.model_fields_set),
        )

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
            normalized_tags = normalize_manual_tags(payload.tags)
            await TagRepository(self._db).set_media_tag_links(media, build_tag_payloads(normalized_tags))
            media.is_nsfw = tag_names_mark_nsfw(normalized_tags)
            media.is_sensitive = tag_names_mark_sensitive(normalized_tags)

        if "entities" in payload.model_fields_set and payload.entities is not None:
            await MediaEntityRepository(self._db).replace_media_entities(
                media,
                entity_creates=payload.entities,
                source="manual",
            )
        if "metadata" in payload.model_fields_set and "captured_at" in metadata_fields:
            media.captured_at = payload.metadata.captured_at or media.uploaded_at
        if "deleted" in payload.model_fields_set:
            media.deleted_at = datetime.now(timezone.utc) if payload.deleted else None
        if "ocr_text_override" in payload.model_fields_set:
            media.ocr_text_override = payload.ocr_text_override or None
        if "metadata_review_dismissed" in payload.model_fields_set and payload.metadata_review_dismissed is not None:
            media.metadata_review_dismissed = payload.metadata_review_dismissed
        if "external_refs" in payload.model_fields_set and payload.external_refs is not None:
            for ref in await self._query.get_media_external_refs(media.id):
                await self._db.delete(ref)
            await self._db.flush()
            for ref_create in payload.external_refs:
                self._db.add(MediaExternalRef(media_id=media.id, provider=ref_create.provider, external_id=ref_create.external_id, url=ref_create.url))
        if "visibility" in payload.model_fields_set and payload.visibility is not None:
            media.visibility = payload.visibility
        if "favorited" in payload.model_fields_set:
            await self._interactions._set_favorite_state(media.id, user, payload.favorited)

        await self._db.commit()
        media = await self._query.get_media_with_relations(media_id, deleted=None)
        logger.info("Updated media metadata user_id=%s media_id=%s", user.id, media_id)
        return await self._query.build_media_detail(media, user.id)

    async def bulk_update_visibility(self, media_ids: list[uuid.UUID], user: User, visibility) -> BulkResult:
        rows = await self._query.get_media_by_ids(media_ids)
        found_ids = {row.id for row in rows}
        skipped = len(media_ids) - len(found_ids)
        processed = 0

        for media in rows:
            if media.uploader_id != user.id and not user.is_admin:
                skipped += 1
                continue
            if media.visibility == visibility:
                skipped += 1
                continue

            media.visibility = visibility
            processed += 1

        await self._db.commit()
        logger.info("Bulk updated visibility user_id=%s visibility=%s processed=%s skipped=%s", user.id, visibility, processed, skipped)
        return BulkResult(processed=processed, skipped=skipped)

    async def bulk_update_metadata_review_dismissed(
        self,
        media_ids: list[uuid.UUID],
        user: User,
        metadata_review_dismissed: bool,
    ) -> BulkResult:
        rows = await self._query.get_media_by_ids(media_ids)
        found_ids = {row.id for row in rows}
        skipped = len(media_ids) - len(found_ids)
        processed = 0

        for media in rows:
            if media.uploader_id != user.id and not user.is_admin:
                skipped += 1
                continue
            if media.metadata_review_dismissed == metadata_review_dismissed:
                skipped += 1
                continue

            media.metadata_review_dismissed = metadata_review_dismissed
            processed += 1

        await self._db.commit()
        logger.info(
            "Bulk updated metadata review dismissed user_id=%s value=%s processed=%s skipped=%s",
            user.id,
            metadata_review_dismissed,
            processed,
            skipped,
        )
        return BulkResult(processed=processed, skipped=skipped)

    async def bulk_update_entities(self, payload: MediaEntityBatchUpdate, user: User) -> BulkResult:
        rows = await self._query.get_media_by_ids(payload.media_ids)
        found_ids = {row.id for row in rows}
        skipped = len(payload.media_ids) - len(found_ids)
        processed = 0
        normalized_characters = self._normalize_entity_names(payload.character_names)
        normalized_series = self._normalize_entity_names(payload.series_names)

        for media in rows:
            if media.uploader_id != user.id and not user.is_admin:
                skipped += 1
                continue

            if payload.character_names is not None:
                await MediaEntityRepository(self._db).add_media_entities(
                    media,
                    entity_type=MediaEntityType.character,
                    names=normalized_characters,
                    source="manual",
                    replace_existing_type=True,
                )
            if payload.series_names is not None:
                await MediaEntityRepository(self._db).add_media_entities(
                    media,
                    entity_type=MediaEntityType.series,
                    names=normalized_series,
                    source="manual",
                    replace_existing_type=True,
                )

            processed += 1

        await self._db.commit()
        logger.info(
            "Bulk updated entities user_id=%s processed=%s skipped=%s character_names=%s series_names=%s",
            user.id,
            processed,
            skipped,
            len(normalized_characters),
            len(normalized_series),
        )
        return BulkResult(processed=processed, skipped=skipped)

    def _normalize_entity_names(self, names: list[str] | None) -> list[str]:
        if names is None:
            return []

        normalized: list[str] = []
        seen: set[str] = set()
        for value in names:
            name = value.strip()
            if not name:
                continue
            key = name.casefold()
            if key in seen:
                continue
            seen.add(key)
            normalized.append(name)
        return normalized
