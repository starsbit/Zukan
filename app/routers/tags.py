from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import current_user
from app.models import Tag, User
from app.schemas import CATEGORY_NAMES, TagRead

router = APIRouter(prefix="/tags", tags=["tags"])


def _to_tag_read(tag: Tag) -> TagRead:
    return TagRead(
        id=tag.id,
        name=tag.name,
        category=tag.category,
        category_name=CATEGORY_NAMES.get(tag.category, "unknown"),
        image_count=tag.image_count,
    )


@router.get("", response_model=list[TagRead])
async def list_tags(
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    category: int | None = None,
    _: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Tag).order_by(Tag.image_count.desc()).offset(offset).limit(limit)
    if category is not None:
        stmt = stmt.where(Tag.category == category)
    tags = (await db.execute(stmt)).scalars().all()
    return [_to_tag_read(t) for t in tags]


@router.get("/search", response_model=list[TagRead])
async def search_tags(
    q: str = Query(min_length=1),
    limit: int = Query(default=20, ge=1, le=100),
    _: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(Tag)
        .where(Tag.name.ilike(f"{q}%"))
        .order_by(Tag.image_count.desc())
        .limit(limit)
    )
    tags = (await db.execute(stmt)).scalars().all()
    return [_to_tag_read(t) for t in tags]
