from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import current_user
from app.models import User
from app.schemas import TagRead
from app.services import tags as tag_service

router = APIRouter(prefix="/tags", tags=["tags"])


@router.get("", response_model=list[TagRead])
async def list_tags(
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    category: int | None = None,
    _: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await tag_service.list_tags(db, limit=limit, offset=offset, category=category)


@router.get("/search", response_model=list[TagRead])
async def search_tags(
    q: str = Query(min_length=1),
    limit: int = Query(default=20, ge=1, le=100),
    _: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await tag_service.search_tags(db, query=q, limit=limit)
