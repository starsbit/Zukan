import uuid
from dataclasses import dataclass

from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models.auth import User
from backend.app.models.media import Media, MediaVisibility
from backend.app.models.relations import MediaEntity, MediaEntityType, MediaExternalRef, OwnedEntity
from backend.app.schemas import MetadataListScope
from backend.app.utils.media_common import normalize_manual_entity_names
from backend.app.utils.media_classification import effective_nsfw_expr, effective_sensitive_expr
from backend.app.utils.search import normalize_metadata_search, normalized_token_sequence_like_patterns


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
        seen_entity_keys: set[tuple[MediaEntityType, str]] = set()
        for entity_create in entity_creates:
            cleaned_name = entity_create.name.strip()
            normalized_name = normalize_metadata_search(cleaned_name) or cleaned_name.casefold()
            entity_key = (entity_create.entity_type, normalized_name)
            if not cleaned_name or entity_key in seen_entity_keys:
                continue
            seen_entity_keys.add(entity_key)
            owned_entity = await OwnedEntityRepository(self.db).get_or_create(
                owner_user_id=owner_user_id,
                entity_type=entity_create.entity_type,
                name=cleaned_name,
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
        for name in normalize_manual_entity_names(names):
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
        conditions = _metadata_name_query_conditions(name_expr, normalized_name_expr, query)
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
            nsfw_expr = effective_nsfw_expr()
            sensitive_expr = effective_sensitive_expr()
            stmt = stmt.where(
                or_(
                    Media.uploader_id == user.id,
                    and_(
                        Media.visibility == MediaVisibility.public,
                        nsfw_expr.is_(False) if not user.show_nsfw else True,
                        sensitive_expr.is_(False) if not user.show_sensitive else True,
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
                conditions = _metadata_name_query_conditions(OwnedEntity.name, OwnedEntity.normalized_name, query)
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
            conditions = _metadata_name_query_conditions(name_expr, normalized_name_expr, query)
            stmt = stmt.where(or_(*conditions))
        if not user.is_admin:
            nsfw_expr = effective_nsfw_expr()
            sensitive_expr = effective_sensitive_expr()
            stmt = stmt.where(
                or_(
                    func.coalesce(OwnedEntity.owner_user_id, Media.owner_id, Media.uploader_id) == user.id,
                    and_(
                        Media.visibility == MediaVisibility.public,
                        nsfw_expr.is_(False) if not user.show_nsfw else True,
                        sensitive_expr.is_(False) if not user.show_sensitive else True,
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
        cleaned_name = name.strip()
        normalized_name = normalize_metadata_search(cleaned_name) or cleaned_name.casefold()
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
        if not hasattr(self.db, "sync_session"):
            created = OwnedEntity(
                owner_user_id=owner_user_id,
                entity_type=entity_type,
                name=cleaned_name,
                normalized_name=normalized_name,
            )
            self.db.add(created)
            await self.db.flush()
            return created

        stmt = (
            insert(OwnedEntity)
            .values(
                owner_user_id=owner_user_id,
                entity_type=entity_type,
                name=cleaned_name,
                normalized_name=normalized_name,
            )
            .on_conflict_do_update(
                index_elements=[
                    OwnedEntity.owner_user_id,
                    OwnedEntity.entity_type,
                    OwnedEntity.normalized_name,
                ],
                set_={
                    "name": cleaned_name,
                    "updated_at": func.now(),
                },
            )
            .returning(OwnedEntity.id)
        )
        entity_id = (await self.db.execute(stmt)).scalar_one()
        entity = await self.db.get(OwnedEntity, entity_id, populate_existing=True)
        if entity is None:  # pragma: no cover - returning id should always resolve.
            raise RuntimeError(f"Upserted owned entity {entity_id} could not be loaded")
        return entity

    async def recount_entity_ids(self, entity_ids: set[uuid.UUID]) -> None:
        if not entity_ids:
            return

        active_counts = (
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
            .subquery()
        )
        active_entity_ids = select(active_counts.c.entity_id)

        await self.db.execute(
            delete(OwnedEntity)
            .where(
                OwnedEntity.id.in_(entity_ids),
                OwnedEntity.id.not_in(active_entity_ids),
            )
            .execution_options(synchronize_session=False)
        )
        await self.db.execute(
            update(OwnedEntity)
            .where(OwnedEntity.id == active_counts.c.entity_id)
            .values(media_count=active_counts.c.media_count)
            .execution_options(synchronize_session=False)
        )


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


def _metadata_name_query_conditions(name_expr, normalized_name_expr, query: str):
    normalized_query = normalize_metadata_search(query)
    conditions = []
    if normalized_query:
        conditions.append(normalized_name_expr == normalized_query)
        conditions.extend(
            normalized_name_expr.like(pattern, escape="\\")
            for pattern in normalized_token_sequence_like_patterns(normalized_query)
        )
    elif query:
        conditions.append(name_expr.ilike(f"%{query}%"))
    return conditions
