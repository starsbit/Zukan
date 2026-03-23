from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.app.models.tags import MediaTag, Tag


class TagRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_by_id(self, tag_id: int) -> Tag | None:
        return (await self.db.execute(select(Tag).where(Tag.id == tag_id))).scalar_one_or_none()

    async def get_by_name(self, name: str) -> Tag | None:
        return (await self.db.execute(select(Tag).where(Tag.name == name))).scalar_one_or_none()

    async def get_by_names(self, names: list[str]) -> dict[str, Tag]:
        tags = (await self.db.execute(select(Tag).where(Tag.name.in_(names)))).scalars().all()
        return {tag.name: tag for tag in tags}

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

    async def set_media_tag_links(self, media, tag_payloads: list[tuple[str, int, float]]) -> None:
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
                continue
            await self.db.delete(media_tag)

        await self.db.flush()

        missing_names = [name for name, _, _ in desired_payloads if name not in existing_by_name]
        existing_tags: dict[str, Tag] = {}
        if missing_names:
            existing_tags = await self.get_by_names(missing_names)

        for name, category, confidence in desired_payloads:
            if name in existing_by_name:
                continue
            tag = existing_tags.get(name)
            if tag is None:
                tag = Tag(name=name, category=category, media_count=0)
                self.db.add(tag)
                await self.db.flush()
                existing_tags[name] = tag
            elif tag.category == 0 and category != 0:
                tag.category = category
            self.db.add(MediaTag(media_id=media.id, tag_id=tag.id, confidence=confidence))
