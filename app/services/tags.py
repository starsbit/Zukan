from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Tag
from app.schemas import CATEGORY_NAMES, TagRead


def _to_tag_read(tag: Tag) -> TagRead:
    return TagRead(
        id=tag.id,
        name=tag.name,
        category=tag.category,
        category_name=CATEGORY_NAMES.get(tag.category, "unknown"),
        image_count=tag.image_count,
    )


async def list_tags(
    db: AsyncSession,
    *,
    limit: int,
    offset: int,
    category: int | None,
) -> list[TagRead]:
    stmt = select(Tag).order_by(Tag.image_count.desc()).offset(offset).limit(limit)
    if category is not None:
        stmt = stmt.where(Tag.category == category)
    tags = (await db.execute(stmt)).scalars().all()
    return [_to_tag_read(tag) for tag in tags]


async def search_tags(
    db: AsyncSession,
    *,
    query: str,
    limit: int,
) -> list[TagRead]:
    stmt = select(Tag).where(Tag.name.ilike(f"{query}%")).order_by(Tag.image_count.desc()).limit(limit)
    tags = (await db.execute(stmt)).scalars().all()
    return [_to_tag_read(tag) for tag in tags]
