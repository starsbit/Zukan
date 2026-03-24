from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models.media import Media
from backend.app.models.relations import MediaEntity, MediaEntityType
from backend.app.repositories.relations import MediaEntityRepository
from backend.app.schemas import EntityCreate, ExternalRefCreate, TagManagementResult


class RelationService:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def replace_entities(self, media: Media, entity_creates: list[EntityCreate]) -> None:
        for entity in await MediaEntityRepository(self._db).get_by_media(media.id):
            await self._db.delete(entity)
        await self._db.flush()
        for entity_create in entity_creates:
            self._db.add(MediaEntity(
                media_id=media.id,
                entity_type=entity_create.entity_type,
                entity_id=entity_create.entity_id,
                name=entity_create.name,
                role=entity_create.role,
                source="manual",
                confidence=entity_create.confidence,
            ))

    async def replace_external_refs(self, media: Media, ref_creates: list[ExternalRefCreate]) -> None:
        from backend.app.models.relations import MediaExternalRef
        from backend.app.repositories.relations import MediaExternalRefRepository
        for ref in await MediaExternalRefRepository(self._db).get_by_media(media.id):
            await self._db.delete(ref)
        await self._db.flush()
        for ref_create in ref_creates:
            self._db.add(MediaExternalRef(
                media_id=media.id,
                provider=ref_create.provider,
                external_id=ref_create.external_id,
                url=ref_create.url,
            ))

    async def clear_character_name(self, user, *, character_name: str) -> TagManagementResult:
        from backend.app.services.media import MediaService
        await MediaService(self._db).purge_expired_trash()

        char_media_ids = select(MediaEntity.media_id).where(
            MediaEntity.entity_type == MediaEntityType.character,
            MediaEntity.name == character_name,
        )
        media_rows = (
            await self._db.execute(_accessible_media_stmt(user).where(Media.id.in_(char_media_ids)))
        ).scalars().all()
        accessible_ids = {m.id for m in media_rows}
        entities = await MediaEntityRepository(self._db).get_char_entities_by_name(accessible_ids, character_name)
        for entity in entities:
            await self._db.delete(entity)
        await self._db.commit()
        return TagManagementResult(matched_media=len(media_rows), updated_media=len(media_rows))

    async def trash_media_by_character_name(self, user, *, character_name: str) -> TagManagementResult:
        from backend.app.services.media import MediaService
        await MediaService(self._db).purge_expired_trash()

        char_media_ids = select(MediaEntity.media_id).where(
            MediaEntity.entity_type == MediaEntityType.character,
            MediaEntity.name == character_name,
        )
        matches = (
            await self._db.execute(_accessible_media_stmt(user).where(Media.id.in_(char_media_ids)))
        ).scalars().all()
        trashed = 0
        already_trashed = 0
        now = datetime.now(timezone.utc)
        for media in matches:
            if media.deleted_at is None:
                media.deleted_at = now
                trashed += 1
            else:
                already_trashed += 1
        await self._db.commit()
        return TagManagementResult(matched_media=len(matches), trashed_media=trashed, already_trashed=already_trashed)


def _accessible_media_stmt(user):
    stmt = select(Media)
    if not user.is_admin:
        stmt = stmt.where(Media.uploader_id == user.id)
    return stmt
