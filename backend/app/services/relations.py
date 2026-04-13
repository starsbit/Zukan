from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models.media import Media
from backend.app.models.relations import MediaEntity, MediaEntityType
from backend.app.repositories.relations import MediaEntityRepository, OwnedEntityRepository
from backend.app.repositories.tags import effective_media_owner_id
from backend.app.schemas import EntityCreate, ExternalRefCreate, MetadataListScope, MetadataNameListResponse, MetadataNameRead, TagManagementResult
from backend.app.utils.pagination import decode_cursor_typed, encode_cursor

logger = logging.getLogger(__name__)


class RelationService:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def replace_entities(self, media: Media, entity_creates: list[EntityCreate]) -> None:
        logger.info("Replacing entities media_id=%s entity_count=%s", media.id, len(entity_creates))
        await MediaEntityRepository(self._db).replace_media_entities(
            media,
            entity_creates=entity_creates,
            source="manual",
        )

    async def replace_external_refs(self, media: Media, ref_creates: list[ExternalRefCreate]) -> None:
        from backend.app.models.relations import MediaExternalRef
        from backend.app.repositories.relations import MediaExternalRefRepository
        logger.info("Replacing external refs media_id=%s ref_count=%s", media.id, len(ref_creates))
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
        return await self._clear_entity_name(user, entity_type=MediaEntityType.character, name=character_name)

    async def clear_series_name(self, user, *, series_name: str) -> TagManagementResult:
        return await self._clear_entity_name(user, entity_type=MediaEntityType.series, name=series_name)

    async def merge_character_name(self, user, *, character_name: str, target_name: str) -> TagManagementResult:
        return await self._merge_entity_name(
            user,
            entity_type=MediaEntityType.character,
            source_name=character_name,
            target_name=target_name,
        )

    async def merge_series_name(self, user, *, series_name: str, target_name: str) -> TagManagementResult:
        return await self._merge_entity_name(
            user,
            entity_type=MediaEntityType.series,
            source_name=series_name,
            target_name=target_name,
        )

    async def list_character_names(
        self,
        user,
        *,
        after: str | None = None,
        page_size: int = 100,
        query: str | None = None,
        sort_by: str = "media_count",
        sort_order: str = "desc",
        scope: MetadataListScope = MetadataListScope.ACCESSIBLE,
    ) -> MetadataNameListResponse:
        return await self._list_entity_names(
            user,
            entity_type=MediaEntityType.character,
            after=after,
            page_size=page_size,
            query=query,
            sort_by=sort_by,
            sort_order=sort_order,
            scope=scope,
        )

    async def list_series_names(
        self,
        user,
        *,
        after: str | None = None,
        page_size: int = 100,
        query: str | None = None,
        sort_by: str = "media_count",
        sort_order: str = "desc",
        scope: MetadataListScope = MetadataListScope.ACCESSIBLE,
    ) -> MetadataNameListResponse:
        return await self._list_entity_names(
            user,
            entity_type=MediaEntityType.series,
            after=after,
            page_size=page_size,
            query=query,
            sort_by=sort_by,
            sort_order=sort_order,
            scope=scope,
        )

    async def trash_media_by_character_name(self, user, *, character_name: str) -> TagManagementResult:
        char_media_ids = select(MediaEntity.media_id).where(
            MediaEntity.entity_type == MediaEntityType.character,
            MediaEntity.name == character_name,
        )
        matches = (
            await self._db.execute(_manageable_media_stmt(user).where(Media.id.in_(char_media_ids)))
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
        logger.info(
            "Trashed media by character name user_id=%s character_name=%s trashed=%s already_trashed=%s",
            user.id,
            character_name,
            trashed,
            already_trashed,
        )
        return TagManagementResult(matched_media=len(matches), trashed_media=trashed, already_trashed=already_trashed)

    async def _clear_entity_name(self, user, *, entity_type: MediaEntityType, name: str) -> TagManagementResult:
        owned_entity = await OwnedEntityRepository(self._db).get_by_owner_type_name(
            owner_user_id=user.id,
            entity_type=entity_type,
            name=name,
        )
        if owned_entity is None:
            return TagManagementResult(matched_media=0, updated_media=0, deleted_source=True)

        media_rows = await self._media_rows_for_owned_entity(user, owned_entity_id=owned_entity.id)
        accessible_ids = {m.id for m in media_rows}
        repo = MediaEntityRepository(self._db)
        entities = await repo.get_entities_for_owned_entity(owned_entity.id, media_ids=accessible_ids)
        for entity in entities:
            await self._db.delete(entity)
        await self._db.flush()
        await OwnedEntityRepository(self._db).recount_entity_ids({owned_entity.id})
        deleted_source = await OwnedEntityRepository(self._db).get_by_id(owned_entity.id) is None
        await self._db.commit()
        logger.info(
            "Cleared entities user_id=%s entity_type=%s name=%s matched_media=%s deleted_source=%s",
            user.id,
            entity_type,
            name,
            len(media_rows),
            deleted_source,
        )
        return TagManagementResult(
            matched_media=len(media_rows),
            updated_media=len(media_rows),
            deleted_source=deleted_source,
        )

    async def _merge_entity_name(
        self,
        user,
        *,
        entity_type: MediaEntityType,
        source_name: str,
        target_name: str,
    ) -> TagManagementResult:
        normalized_target = target_name.strip()
        if not normalized_target or normalized_target == source_name:
            return TagManagementResult(matched_media=0, updated_media=0)

        owner_user_id = user.id
        owned_repo = OwnedEntityRepository(self._db)
        source_entity = await owned_repo.get_by_owner_type_name(
            owner_user_id=owner_user_id,
            entity_type=entity_type,
            name=source_name,
        )
        if source_entity is None:
            return TagManagementResult(matched_media=0, updated_media=0, deleted_source=True)

        target_entity = await owned_repo.get_or_create(
            owner_user_id=owner_user_id,
            entity_type=entity_type,
            name=normalized_target,
        )
        if target_entity.id == source_entity.id:
            return TagManagementResult(matched_media=0, updated_media=0)

        source_media_rows = await self._media_rows_for_owned_entity(user, owned_entity_id=source_entity.id)
        source_media_ids = {media.id for media in source_media_rows}
        repo = MediaEntityRepository(self._db)
        source_links = await repo.get_entities_for_owned_entity(source_entity.id, media_ids=source_media_ids)
        target_links = await repo.get_entities_for_owned_entity(target_entity.id, media_ids=source_media_ids)
        target_by_media_id = {entity.media_id: entity for entity in target_links}
        updated_media_ids: set[uuid.UUID] = set()

        for source_link in source_links:
            target_link = target_by_media_id.get(source_link.media_id)
            if target_link is not None:
                if target_link.confidence is None and source_link.confidence is not None:
                    target_link.confidence = source_link.confidence
                await self._db.delete(source_link)
            else:
                source_link.entity_id = target_entity.id
                source_link.name = target_entity.name
            updated_media_ids.add(source_link.media_id)

        await self._db.flush()
        await owned_repo.recount_entity_ids({source_entity.id, target_entity.id})
        deleted_source = await owned_repo.get_by_id(source_entity.id) is None
        await self._db.commit()
        logger.info(
            "Merged entities user_id=%s entity_type=%s source_name=%s target_name=%s matched_media=%s updated_media=%s deleted_source=%s",
            user.id,
            entity_type,
            source_name,
            normalized_target,
            len(source_media_rows),
            len(updated_media_ids),
            deleted_source,
        )
        return TagManagementResult(
            matched_media=len(source_media_rows),
            updated_media=len(updated_media_ids),
            deleted_source=deleted_source,
        )

    async def _media_rows_for_owned_entity(self, user, *, owned_entity_id) -> list[Media]:
        media_ids = select(MediaEntity.media_id).where(MediaEntity.entity_id == owned_entity_id)
        return (
            await self._db.execute(_manageable_media_stmt(user).where(Media.id.in_(media_ids)))
        ).scalars().all()

    async def _list_entity_names(
        self,
        user,
        *,
        entity_type: MediaEntityType,
        after: str | None,
        page_size: int,
        query: str | None,
        sort_by: str,
        sort_order: str,
        scope: MetadataListScope,
    ) -> MetadataNameListResponse:
        repo = MediaEntityRepository(self._db)
        total = await repo.count_entity_names(user=user, entity_type=entity_type, query=query, scope=scope)
        rows = await repo.list_entity_names(user=user, entity_type=entity_type, query=query, scope=scope)

        reverse = sort_order == "desc"
        if sort_by == "name":
            rows = sorted(rows, key=lambda row: row.name, reverse=reverse)
        else:
            rows = sorted(rows, key=lambda row: (row.media_count, row.name), reverse=reverse)

        if after:
            value_type = "str" if sort_by == "name" else "int"
            decoded = decode_cursor_typed(after, value_type, id_type="str")
            if decoded is not None:
                cursor_val, cursor_name = decoded
                rows = [
                    row for row in rows
                    if _name_row_after_cursor(
                        row,
                        sort_by=sort_by,
                        sort_order=sort_order,
                        cursor_val=cursor_val,
                        cursor_name=cursor_name,
                    )
                ]

        has_more = len(rows) > page_size
        rows = rows[:page_size]

        next_cursor = None
        if has_more and rows:
            last = rows[-1]
            sort_val = last.name if sort_by == "name" else last.media_count
            next_cursor = encode_cursor(sort_val, last.name)

        return MetadataNameListResponse(
            total=total,
            next_cursor=next_cursor,
            has_more=has_more,
            page_size=page_size,
            items=[MetadataNameRead(id=getattr(row, "id", None), name=row.name, media_count=row.media_count) for row in rows],
        )


def _manageable_media_stmt(user):
    stmt = select(Media)
    if not user.is_admin:
        stmt = stmt.where((Media.uploader_id == user.id) | (Media.owner_id == user.id))
    return stmt


def _name_row_after_cursor(row, *, sort_by: str, sort_order: str, cursor_val, cursor_name: str) -> bool:
    row_val = row.name if sort_by == "name" else row.media_count
    if sort_order == "asc":
        return row_val > cursor_val or (row_val == cursor_val and row.name > cursor_name)
    return row_val < cursor_val or (row_val == cursor_val and row.name < cursor_name)
