import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models.media import Media
from backend.app.models.relations import MediaEntity, MediaEntityType, MediaExternalRef


class MediaEntityRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_by_media(self, media_id: uuid.UUID) -> list[MediaEntity]:
        return (await self.db.execute(select(MediaEntity).where(MediaEntity.media_id == media_id))).scalars().all()

    async def get_tagger_entities(self, media_id: uuid.UUID, entity_type: MediaEntityType) -> list[MediaEntity]:
        return (
            await self.db.execute(
                select(MediaEntity).where(
                    MediaEntity.media_id == media_id,
                    MediaEntity.entity_type == entity_type,
                    MediaEntity.source == "tagger",
                )
            )
        ).scalars().all()

    async def get_tagger_char_entities(self, media_id: uuid.UUID) -> list[MediaEntity]:
        return await self.get_tagger_entities(media_id, MediaEntityType.character)

    async def get_tagger_series_entities(self, media_id: uuid.UUID) -> list[MediaEntity]:
        return await self.get_tagger_entities(media_id, MediaEntityType.series)

    async def get_char_entities_by_name(self, media_ids: set[uuid.UUID], character_name: str) -> list[MediaEntity]:
        return (
            await self.db.execute(
                select(MediaEntity).where(
                    MediaEntity.media_id.in_(media_ids),
                    MediaEntity.entity_type == MediaEntityType.character,
                    MediaEntity.name == character_name,
                )
            )
        ).scalars().all()

    async def get_series_entities_by_name(self, media_ids: set[uuid.UUID], series_name: str) -> list[MediaEntity]:
        return (
            await self.db.execute(
                select(MediaEntity).where(
                    MediaEntity.media_id.in_(media_ids),
                    MediaEntity.entity_type == MediaEntityType.series,
                    MediaEntity.name == series_name,
                )
            )
        ).scalars().all()

    async def list_character_suggestions(self, *, query: str, limit: int, show_nsfw: bool, is_admin: bool) -> list[dict]:
        return await self._list_entity_suggestions(
            entity_type=MediaEntityType.character,
            query=query,
            limit=limit,
            show_nsfw=show_nsfw,
            is_admin=is_admin,
        )

    async def list_series_suggestions(self, *, query: str, limit: int, show_nsfw: bool, is_admin: bool) -> list[dict]:
        return await self._list_entity_suggestions(
            entity_type=MediaEntityType.series,
            query=query,
            limit=limit,
            show_nsfw=show_nsfw,
            is_admin=is_admin,
        )

    async def _list_entity_suggestions(
        self,
        *,
        entity_type: MediaEntityType,
        query: str,
        limit: int,
        show_nsfw: bool,
        is_admin: bool,
    ) -> list[dict]:
        stmt = (
            select(
                MediaEntity.name.label("name"),
                func.count(MediaEntity.media_id.distinct()).label("media_count"),
            )
            .join(Media, Media.id == MediaEntity.media_id)
            .where(
                MediaEntity.entity_type == entity_type,
                Media.deleted_at.is_(None),
                MediaEntity.name.ilike(f"{query}%"),
            )
            .group_by(MediaEntity.name)
            .order_by(func.count(MediaEntity.media_id.distinct()).desc(), MediaEntity.name.asc())
            .limit(limit)
        )
        if not show_nsfw and not is_admin:
            stmt = stmt.where(Media.is_nsfw == False)
        rows = (await self.db.execute(stmt)).all()
        return [{"name": row.name, "media_count": row.media_count} for row in rows]


class MediaExternalRefRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_by_media(self, media_id: uuid.UUID) -> list[MediaExternalRef]:
        return (
            await self.db.execute(select(MediaExternalRef).where(MediaExternalRef.media_id == media_id))
        ).scalars().all()
