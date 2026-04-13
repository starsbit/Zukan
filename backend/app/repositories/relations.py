import uuid
from dataclasses import dataclass

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models.auth import User
from backend.app.models.media import Media, MediaVisibility
from backend.app.models.relations import MediaEntity, MediaEntityType, MediaExternalRef, OwnedEntity
from backend.app.schemas import MetadataListScope
from backend.app.utils.search import normalize_metadata_search


@dataclass
class MetadataNameRow:
    id: uuid.UUID | None
    name: str
    media_count: int


def _effective_media_owner_id(media) -> uuid.UUID:
    owner_user_id = getattr(media, "owner_id", None) or getattr(media, "uploader_id", None)
    if owner_user_id is None:
        raise ValueError(f"Media {getattr(media, 'id', '<unknown>')} has no effective owner for entity operations")
    return owner_user_id


class MediaEntityRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_by_media(self, media_id: uuid.UUID) -> list[MediaEntity]:
        return (await self.db.execute(select(MediaEntity).where(MediaEntity.media_id == media_id))).scalars().all()

    async def get_entity_ids_by_media(self, media_id: uuid.UUID) -> set[uuid.UUID]:
        rows = (
            await self.db.execute(
                select(MediaEntity.entity_id).where(
                    MediaEntity.media_id == media_id,
                    MediaEntity.entity_id.is_not(None),
                )
            )
        ).scalars().all()
        return set(rows)

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

    async def get_entities_for_owned_entity(self, owned_entity_id: uuid.UUID, *, media_ids: set[uuid.UUID] | None = None) -> list[MediaEntity]:
        stmt = select(MediaEntity).where(MediaEntity.entity_id == owned_entity_id)
        if media_ids is not None:
            if not media_ids:
                return []
            stmt = stmt.where(MediaEntity.media_id.in_(media_ids))
        return (await self.db.execute(stmt)).scalars().all()

    async def source_name_exists(self, *, entity_type: MediaEntityType, name: str) -> bool:
        stmt = select(MediaEntity.id).where(
            MediaEntity.entity_type == entity_type,
            MediaEntity.name == name,
        ).limit(1)
        return (await self.db.execute(stmt)).scalar_one_or_none() is not None

    async def replace_media_entities(
        self,
        media: Media,
        *,
        entity_creates,
        source: str,
    ) -> None:
        existing_entities = await self.get_by_media(media.id)
        touched_entity_ids = {entity.entity_id for entity in existing_entities if entity.entity_id is not None}
        for entity in existing_entities:
            await self.db.delete(entity)
        await self.db.flush()

        owner_user_id = _effective_media_owner_id(media)
        created_entity_ids: set[uuid.UUID] = set()
        for entity_create in entity_creates:
            owned_entity = await OwnedEntityRepository(self.db).get_or_create(
                owner_user_id=owner_user_id,
                entity_type=entity_create.entity_type,
                name=entity_create.name,
            )
            created_entity_ids.add(owned_entity.id)
            self.db.add(MediaEntity(
                media_id=media.id,
                entity_type=entity_create.entity_type,
                entity_id=owned_entity.id,
                name=owned_entity.name,
                role=entity_create.role,
                source=source,
                confidence=entity_create.confidence,
            ))

        await self.db.flush()
        await OwnedEntityRepository(self.db).recount_entity_ids(touched_entity_ids | created_entity_ids)

    async def add_media_entities(
        self,
        media: Media,
        *,
        entity_type: MediaEntityType,
        names: list[str],
        source: str,
        confidence: float | None = None,
        replace_existing_type: bool = False,
    ) -> None:
        owned_repo = OwnedEntityRepository(self.db)
        touched_entity_ids = set()
        if replace_existing_type:
            existing = (
                await self.db.execute(
                    select(MediaEntity).where(
                        MediaEntity.media_id == media.id,
                        MediaEntity.entity_type == entity_type,
                    )
                )
            ).scalars().all()
            touched_entity_ids |= {entity.entity_id for entity in existing if entity.entity_id is not None}
            for entity in existing:
                await self.db.delete(entity)
            if existing:
                await self.db.flush()

        owner_user_id = _effective_media_owner_id(media)
        created_entity_ids: set[uuid.UUID] = set()
        for name in names:
            owned_entity = await owned_repo.get_or_create(
                owner_user_id=owner_user_id,
                entity_type=entity_type,
                name=name,
            )
            created_entity_ids.add(owned_entity.id)
            self.db.add(MediaEntity(
                media_id=media.id,
                entity_type=entity_type,
                entity_id=owned_entity.id,
                name=owned_entity.name,
                role="primary",
                source=source,
                confidence=confidence,
            ))

        await self.db.flush()
        await owned_repo.recount_entity_ids(touched_entity_ids | created_entity_ids)

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
        entity_type_expr = func.coalesce(OwnedEntity.entity_type, MediaEntity.entity_type)
        name_expr = func.coalesce(OwnedEntity.name, MediaEntity.name)
        normalized_name_expr = func.coalesce(OwnedEntity.normalized_name, _normalized_media_entity_name_expr())
        normalized_query = normalize_metadata_search(query)
        conditions = [name_expr.ilike(f"%{query}%")]
        if normalized_query:
            conditions.append(normalized_name_expr.contains(normalized_query))
        stmt = (
            select(
                name_expr.label("name"),
                func.count(MediaEntity.media_id.distinct()).label("media_count"),
            )
            .select_from(MediaEntity)
            .outerjoin(OwnedEntity, OwnedEntity.id == MediaEntity.entity_id)
            .join(Media, Media.id == MediaEntity.media_id)
            .where(
                entity_type_expr == entity_type,
                Media.deleted_at.is_(None),
                or_(*conditions),
            )
            .group_by(name_expr)
            .order_by(func.count(MediaEntity.media_id.distinct()).desc(), name_expr.asc())
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
        if scope == MetadataListScope.OWNER:
            stmt = select(
                OwnedEntity.id.label("id"),
                OwnedEntity.name.label("name"),
                OwnedEntity.media_count.label("media_count"),
            ).where(
                OwnedEntity.owner_user_id == user.id,
                OwnedEntity.entity_type == entity_type,
            )
            if query:
                normalized_query = normalize_metadata_search(query)
                conditions = [OwnedEntity.name.ilike(f"%{query}%")]
                if normalized_query:
                    conditions.append(OwnedEntity.normalized_name.contains(normalized_query))
                stmt = stmt.where(or_(*conditions))
            return stmt

        entity_type_expr = func.coalesce(OwnedEntity.entity_type, MediaEntity.entity_type)
        name_expr = func.coalesce(OwnedEntity.name, MediaEntity.name)
        normalized_name_expr = func.coalesce(OwnedEntity.normalized_name, _normalized_media_entity_name_expr())
        stmt = (
            select(
                func.min(OwnedEntity.id).label("id"),
                name_expr.label("name"),
                func.count(MediaEntity.media_id.distinct()).label("media_count"),
            )
            .select_from(MediaEntity)
            .outerjoin(OwnedEntity, MediaEntity.entity_id == OwnedEntity.id)
            .join(Media, Media.id == MediaEntity.media_id)
            .where(
                entity_type_expr == entity_type,
                Media.deleted_at.is_(None),
            )
            .group_by(name_expr)
        )
        if query:
            normalized_query = normalize_metadata_search(query)
            conditions = [name_expr.ilike(f"%{query}%")]
            if normalized_query:
                conditions.append(normalized_name_expr.contains(normalized_query))
            stmt = stmt.where(or_(*conditions))
        if not user.is_admin:
            stmt = stmt.where(
                or_(
                    func.coalesce(OwnedEntity.owner_user_id, Media.owner_id, Media.uploader_id) == user.id,
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


class OwnedEntityRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_by_id(self, entity_id: uuid.UUID) -> OwnedEntity | None:
        return await self.db.get(OwnedEntity, entity_id)

    async def get_by_owner_type_name(
        self,
        *,
        owner_user_id: uuid.UUID,
        entity_type: MediaEntityType,
        name: str,
    ) -> OwnedEntity | None:
        normalized_name = normalize_metadata_search(name) or name.strip().casefold()
        stmt = select(OwnedEntity).where(
            OwnedEntity.owner_user_id == owner_user_id,
            OwnedEntity.entity_type == entity_type,
            OwnedEntity.normalized_name == normalized_name,
        )
        result = (await self.db.execute(stmt)).scalar_one_or_none()
        return result if isinstance(result, OwnedEntity) else None

    async def get_or_create(
        self,
        *,
        owner_user_id: uuid.UUID,
        entity_type: MediaEntityType,
        name: str,
    ) -> OwnedEntity:
        cleaned_name = name.strip()
        normalized_name = normalize_metadata_search(cleaned_name) or cleaned_name.casefold()
        existing = await self.get_by_owner_type_name(
            owner_user_id=owner_user_id,
            entity_type=entity_type,
            name=cleaned_name,
        )
        if existing is not None:
            if existing.name != cleaned_name:
                existing.name = cleaned_name
            return existing

        created = OwnedEntity(
            owner_user_id=owner_user_id,
            entity_type=entity_type,
            name=cleaned_name,
            normalized_name=normalized_name,
        )
        self.db.add(created)
        await self.db.flush()
        return created

    async def recount_entity_ids(self, entity_ids: set[uuid.UUID]) -> None:
        if not entity_ids:
            return

        counts = {
            row.entity_id: int(row.media_count)
            for row in (
                await self.db.execute(
                    select(
                        MediaEntity.entity_id.label("entity_id"),
                        func.count(MediaEntity.media_id.distinct()).label("media_count"),
                    )
                    .join(Media, Media.id == MediaEntity.media_id)
                    .where(
                        MediaEntity.entity_id.in_(entity_ids),
                        Media.deleted_at.is_(None),
                    )
                    .group_by(MediaEntity.entity_id)
                )
            ).all()
        }

        entities = (
            await self.db.execute(select(OwnedEntity).where(OwnedEntity.id.in_(entity_ids)))
        ).scalars().all()
        for entity in entities:
            entity.media_count = counts.get(entity.id, 0)
            if entity.media_count <= 0:
                await self.db.delete(entity)


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


def _normalized_media_entity_name_expr():
    return func.btrim(
        func.regexp_replace(func.lower(func.coalesce(MediaEntity.name, "")), r"[^a-z0-9]+", "_", "g"),
        "_",
    )
