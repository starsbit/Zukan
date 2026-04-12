import uuid

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models.auth import User
from backend.app.models.media import Media, MediaVisibility
from backend.app.models.relations import MediaEntity, MediaEntityType, MediaExternalRef
from backend.app.schemas import MetadataListScope


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

    async def get_entities_by_name_for_media_ids(
        self,
        media_ids: set[uuid.UUID],
        *,
        entity_type: MediaEntityType,
        name: str,
    ) -> list[MediaEntity]:
        if not media_ids:
            return []
        return (
            await self.db.execute(
                select(MediaEntity).where(
                    MediaEntity.media_id.in_(media_ids),
                    MediaEntity.entity_type == entity_type,
                    MediaEntity.name == name,
                )
            )
        ).scalars().all()

    async def source_name_exists(self, *, entity_type: MediaEntityType, name: str) -> bool:
        stmt = select(MediaEntity.id).where(
            MediaEntity.entity_type == entity_type,
            MediaEntity.name == name,
        ).limit(1)
        return (await self.db.execute(stmt)).scalar_one_or_none() is not None

    async def list_character_suggestions(
        self,
        *,
        user: User,
        query: str,
        limit: int,
        scope: MetadataListScope = MetadataListScope.ACCESSIBLE,
    ) -> list[dict]:
        return await self._list_entity_suggestions(
            user=user,
            entity_type=MediaEntityType.character,
            query=query,
            limit=limit,
            scope=scope,
        )

    async def list_series_suggestions(
        self,
        *,
        user: User,
        query: str,
        limit: int,
        scope: MetadataListScope = MetadataListScope.ACCESSIBLE,
    ) -> list[dict]:
        return await self._list_entity_suggestions(
            user=user,
            entity_type=MediaEntityType.series,
            query=query,
            limit=limit,
            scope=scope,
        )

    async def _list_entity_suggestions(
        self,
        *,
        user: User,
        entity_type: MediaEntityType,
        query: str,
        limit: int,
        scope: MetadataListScope,
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
        if scope == MetadataListScope.OWNER:
            stmt = stmt.where(Media.uploader_id == user.id)
        elif not user.is_admin:
            stmt = stmt.where(
                or_(
                    Media.uploader_id == user.id,
                    and_(
                        Media.visibility == MediaVisibility.public,
                        Media.is_nsfw.is_(False) if not user.show_nsfw else True,
                        Media.is_sensitive.is_(False) if not user.show_sensitive else True,
                    ),
                )
            )
        rows = (await self.db.execute(stmt)).all()
        return [{"name": row.name, "media_count": row.media_count} for row in rows]

    def _entity_name_count_stmt(
        self,
        *,
        user: User,
        entity_type: MediaEntityType,
        query: str | None,
        scope: MetadataListScope,
    ):
        stmt = (
            select(
                MediaEntity.name.label("name"),
                func.count(MediaEntity.media_id.distinct()).label("media_count"),
            )
            .join(Media, Media.id == MediaEntity.media_id)
            .where(
                MediaEntity.entity_type == entity_type,
                Media.deleted_at.is_(None),
            )
            .group_by(MediaEntity.name)
        )
        if query:
            stmt = stmt.where(MediaEntity.name.ilike(f"{query}%"))
        if scope == MetadataListScope.OWNER:
            stmt = stmt.where(Media.uploader_id == user.id)
        elif not user.is_admin:
            stmt = stmt.where(
                or_(
                    Media.uploader_id == user.id,
                    and_(
                        Media.visibility == MediaVisibility.public,
                        Media.is_nsfw.is_(False) if not user.show_nsfw else True,
                        Media.is_sensitive.is_(False) if not user.show_sensitive else True,
                    ),
                )
            )
        return stmt

    async def count_entity_names(
        self,
        *,
        user: User,
        entity_type: MediaEntityType,
        query: str | None,
        scope: MetadataListScope = MetadataListScope.ACCESSIBLE,
    ) -> int:
        base_stmt = self._entity_name_count_stmt(user=user, entity_type=entity_type, query=query, scope=scope)
        return (await self.db.execute(select(func.count()).select_from(base_stmt.subquery()))).scalar_one()

    async def list_entity_names(
        self,
        *,
        user: User,
        entity_type: MediaEntityType,
        query: str | None,
        scope: MetadataListScope = MetadataListScope.ACCESSIBLE,
    ):
        stmt = self._entity_name_count_stmt(user=user, entity_type=entity_type, query=query, scope=scope)
        return (await self.db.execute(stmt)).all()


class MediaExternalRefRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_by_media(self, media_id: uuid.UUID) -> list[MediaExternalRef]:
        return (
            await self.db.execute(select(MediaExternalRef).where(MediaExternalRef.media_id == media_id))
        ).scalars().all()

    async def get_for_user_by_provider_and_external_id(
        self,
        *,
        user_id: uuid.UUID,
        provider: str,
        external_id: str,
    ) -> MediaExternalRef | None:
        stmt = (
            select(MediaExternalRef)
            .join(Media, Media.id == MediaExternalRef.media_id)
            .where(
                Media.uploader_id == user_id,
                Media.deleted_at.is_(None),
                MediaExternalRef.provider == provider,
                MediaExternalRef.external_id == external_id,
            )
            .limit(1)
        )
        return (await self.db.execute(stmt)).scalar_one_or_none()
