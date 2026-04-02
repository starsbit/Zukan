from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.errors.error import AppError
from backend.app.errors.upload import version_conflict
from backend.app.models.auth import User
from backend.app.models.relations import MediaEntityType
from backend.app.models.relations import MediaEntity, MediaExternalRef
from backend.app.repositories.tags import TagRepository
from backend.app.schemas import BulkResult, MediaDetail, MediaEntityBatchUpdate, MediaUpdate
from backend.app.services.media.interactions import MediaInteractionService
from backend.app.services.media.query import MediaQueryService
from backend.app.utils.media_common import build_tag_payloads, normalize_manual_tags
from backend.app.utils.tagging import tag_names_mark_nsfw


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
        needs_owner_access = any(field in payload.model_fields_set for field in {"tags", "entities", "metadata", "deleted", "ocr_text_override", "external_refs", "visibility"})
        if needs_owner_access:
            media = await self._query.get_owned_or_admin_media(media_id, user, trashed=None)
        else:
            media = await self._query.get_active_media(media_id)

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

        if "entities" in payload.model_fields_set and payload.entities is not None:
            for entity in await self._query.get_media_entities(media.id):
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

            existing_entities = await self._query.get_media_entities(media.id)
            to_delete: list[MediaEntity] = []

            if payload.character_names is not None:
                to_delete.extend([entity for entity in existing_entities if entity.entity_type == MediaEntityType.character])
            if payload.series_names is not None:
                to_delete.extend([entity for entity in existing_entities if entity.entity_type == MediaEntityType.series])

            for entity in to_delete:
                await self._db.delete(entity)

            if to_delete:
                await self._db.flush()

            if payload.character_names is not None:
                self._add_manual_entities(media.id, MediaEntityType.character, normalized_characters)
            if payload.series_names is not None:
                self._add_manual_entities(media.id, MediaEntityType.series, normalized_series)

            processed += 1

        await self._db.commit()
        return BulkResult(processed=processed, skipped=skipped)

    def _add_manual_entities(self, media_id: uuid.UUID, entity_type: MediaEntityType, names: list[str]) -> None:
        for name in names:
            self._db.add(MediaEntity(
                media_id=media_id,
                entity_type=entity_type,
                name=name,
                role="primary",
                source="manual",
            ))

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
