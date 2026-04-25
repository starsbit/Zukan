from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import and_, func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.app.models.auth import User
from backend.app.models.media import Media, MediaVisibility
from backend.app.models.tags import MediaTag, Tag
from backend.app.schemas import MetadataListScope
from backend.app.utils.search import normalize_metadata_search, normalized_token_sequence_like_patterns


@dataclass
class TagListRow:
    id: int
    name: str
    category: int
    media_count: int


class TagRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_by_id(self, tag_id: int) -> Tag | None:
        return (await self.db.execute(select(Tag).where(Tag.id == tag_id))).scalar_one_or_none()

    async def get_by_name(self, owner_user_id: uuid.UUID, name: str) -> Tag | None:
        return (
            await self.db.execute(
                select(Tag).where(
                    Tag.owner_user_id == owner_user_id,
                    Tag.name == name,
                )
            )
        ).scalar_one_or_none()

    async def get_by_names(self, owner_user_id: uuid.UUID, names: list[str]) -> dict[str, Tag]:
        tags = (
            await self.db.execute(
                select(Tag).where(
                    Tag.owner_user_id == owner_user_id,
                    Tag.name.in_(names),
                )
            )
        ).scalars().all()
        return {tag.name: tag for tag in tags}

    def _base_accessible_tag_stmt(self, user: User, *, category: int | None, query: str | None, scope: MetadataListScope):
        stmt = (
            select(
                Tag.id.label("id"),
                Tag.name.label("name"),
                Tag.category.label("category"),
                Tag.owner_user_id.label("owner_user_id"),
                func.count(func.distinct(Media.id)).label("media_count"),
            )
            .join(MediaTag, MediaTag.tag_id == Tag.id)
            .join(Media, Media.id == MediaTag.media_id)
            .where(Media.deleted_at.is_(None))
            .group_by(Tag.id, Tag.name, Tag.category, Tag.owner_user_id)
        )
        if category is not None:
            stmt = stmt.where(Tag.category == category)
        if query:
            normalized_query = normalize_metadata_search(query)
            conditions = []
            if normalized_query:
                normalized_tag_name = _normalized_tag_name_expr()
                conditions.append(normalized_tag_name == normalized_query)
                conditions.extend(
                    normalized_tag_name.like(pattern, escape="\\")
                    for pattern in normalized_token_sequence_like_patterns(normalized_query)
                )
            else:
                conditions.append(Tag.name.ilike(f"%{query}%"))
            stmt = stmt.where(
                or_(
                    *conditions,
                )
            )
        if scope == MetadataListScope.OWNER:
            stmt = stmt.where(Tag.owner_user_id == user.id)
        elif not user.is_admin:
            stmt = stmt.where(
                or_(
                    Tag.owner_user_id == user.id,
                    and_(Media.visibility == MediaVisibility.public),
                )
            )
        return stmt

    async def count_accessible(
        self,
        user: User,
        *,
        category: int | None,
        query: str | None,
        scope: MetadataListScope = MetadataListScope.ACCESSIBLE,
    ) -> int:
        return len(await self.list_accessible(user, category=category, query=query, scope=scope))

    async def list_accessible(
        self,
        user: User,
        *,
        category: int | None,
        query: str | None,
        scope: MetadataListScope = MetadataListScope.ACCESSIBLE,
    ):
        stmt = self._base_accessible_tag_stmt(user, category=category, query=query, scope=scope)
        rows = (await self.db.execute(stmt)).all()
        if scope == MetadataListScope.OWNER:
            return [
                TagListRow(id=row.id, name=row.name, category=row.category, media_count=row.media_count)
                for row in rows
            ]
        return _aggregate_accessible_tag_rows(rows)

    async def count(self, base_stmt) -> int:
        return (await self.db.execute(select(func.count()).select_from(base_stmt.subquery()))).scalar_one()

    async def list(self, *, base_stmt, order_expr, offset: int, limit: int) -> list[Tag]:
        return (await self.db.execute(base_stmt.order_by(order_expr).offset(offset).limit(limit))).scalars().all()

    async def get_media_tags_with_tag(self, media_id: uuid.UUID) -> list[MediaTag]:
        return (
            await self.db.execute(
                select(MediaTag).options(selectinload(MediaTag.tag)).where(MediaTag.media_id == media_id)
            )
        ).scalars().all()

    async def set_media_tag_links(
        self,
        media,
        tag_payloads: list[tuple[str, int, float]],
        *,
        source: str = "auto",
        model_version: str | None = None,
        created_by_user_id=None,
    ) -> None:
        owner_user_id = effective_media_owner_id(media)
        touched_tag_ids: set[int] = set()
        desired_payloads: list[tuple[str, int, float]] = []
        desired_by_name: dict[str, tuple[int, float]] = {}
        for name, category, confidence in tag_payloads:
            if name in desired_by_name:
                continue
            desired_payloads.append((name, category, confidence))
            desired_by_name[name] = (category, confidence)

        existing_media_tags = await self.get_media_tags_with_tag(media.id)
        existing_by_name = {item.tag.name: item for item in existing_media_tags}

        for name, media_tag in existing_by_name.items():
            if name in desired_by_name:
                desired_category, desired_confidence = desired_by_name[name]
                if media_tag.tag.category == 0 and desired_category != 0:
                    media_tag.tag.category = desired_category
                media_tag.confidence = desired_confidence
                touched_tag_ids.add(media_tag.tag_id)
                continue
            touched_tag_ids.add(media_tag.tag_id)
            await self.db.delete(media_tag)

        await self.db.flush()

        missing_payloads = [
            (name, category)
            for name, category, _ in desired_payloads
            if name not in existing_by_name
        ]
        missing_names = [name for name, _ in missing_payloads]
        existing_tags: dict[str, Tag] = {}
        if missing_names:
            await self.db.execute(
                insert(Tag)
                .values([
                    {
                        "owner_user_id": owner_user_id,
                        "name": name,
                        "category": category,
                        "media_count": 0,
                    }
                    for name, category in missing_payloads
                ])
                .on_conflict_do_nothing(
                    constraint="uq_tags_owner_user_id_name",
                )
            )
            await self.db.flush()
            existing_tags = await self.get_by_names(owner_user_id, missing_names)

        for name, category, confidence in desired_payloads:
            if name in existing_by_name:
                continue
            tag = existing_tags[name]
            if tag.category == 0 and category != 0:
                tag.category = category
            touched_tag_ids.add(tag.id)
            self.db.add(MediaTag(
                media_id=media.id,
                tag_id=tag.id,
                confidence=confidence,
                source=source,
                model_version=model_version,
                created_by_user_id=created_by_user_id,
            ))

        await self.db.flush()
        await self.recount_tag_ids(touched_tag_ids)

    async def recount_tag_ids(self, tag_ids: set[int]) -> None:
        if not tag_ids:
            return

        counts = {
            int(row.tag_id): int(row.media_count)
            for row in (
                await self.db.execute(
                    select(
                        MediaTag.tag_id.label("tag_id"),
                        func.count(func.distinct(Media.id)).label("media_count"),
                    )
                    .join(Media, Media.id == MediaTag.media_id)
                    .where(
                        MediaTag.tag_id.in_(tag_ids),
                        Media.deleted_at.is_(None),
                    )
                    .group_by(MediaTag.tag_id)
                )
            ).all()
        }

        tags = (
            await self.db.execute(select(Tag).where(Tag.id.in_(tag_ids)))
        ).scalars().all()
        for tag in tags:
            tag.media_count = counts.get(tag.id, 0)
            if tag.media_count <= 0:
                await self.db.delete(tag)


def _normalized_tag_name_expr():
    return func.btrim(
        func.regexp_replace(func.lower(func.coalesce(Tag.name, "")), r"[^a-z0-9]+", "_", "g"),
        "_",
    )


def effective_media_owner_id(media) -> uuid.UUID:
    owner_user_id = media.owner_id or media.uploader_id
    if owner_user_id is None:
        raise ValueError(f"Media {getattr(media, 'id', '<unknown>')} has no effective owner for tag operations")
    return owner_user_id


def _aggregate_accessible_tag_rows(rows) -> list[TagListRow]:
    grouped: dict[str, list] = {}
    for row in rows:
        grouped.setdefault(row.name, []).append(row)

    aggregated: list[TagListRow] = []
    for name, items in grouped.items():
        representative = min(items, key=lambda item: item.id)
        category = _aggregate_category(items)
        media_count = sum(int(item.media_count) for item in items)
        aggregated.append(
            TagListRow(
                id=representative.id,
                name=name,
                category=category,
                media_count=media_count,
            )
        )
    return aggregated


def _aggregate_category(rows) -> int:
    non_general_counts: dict[int, int] = {}
    for row in rows:
        if row.category == 0:
            continue
        non_general_counts[row.category] = non_general_counts.get(row.category, 0) + int(row.media_count)

    if not non_general_counts:
        return 0

    return sorted(non_general_counts.items(), key=lambda item: (-item[1], item[0]))[0][0]
