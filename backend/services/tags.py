from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import Tag
from backend.schemas import CATEGORY_NAMES, TagRead


def _to_tag_read(tag: Tag) -> TagRead:
    return TagRead(
        id=tag.id,
        name=tag.name,
        category=tag.category,
        category_name=CATEGORY_NAMES.get(tag.category, "unknown"),
        media_count=tag.media_count,
    )


async def list_tags(
    db: AsyncSession,
    *,
    limit: int,
    offset: int,
    category: int | None,
    query: str | None = None,
) -> list[TagRead]:
    stmt = select(Tag).order_by(Tag.media_count.desc()).offset(offset).limit(limit)
    if category is not None:
        stmt = stmt.where(Tag.category == category)
    if query:
        stmt = stmt.where(Tag.name.ilike(f"{query}%"))
    tags = (await db.execute(stmt)).scalars().all()
    return [_to_tag_read(tag) for tag in tags]
