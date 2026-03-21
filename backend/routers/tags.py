from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.deps import current_user
from backend.models import User
from backend.schemas import TagRead
from backend.services import tags as tag_service

router = APIRouter(prefix="/tags", tags=["tags"])


@router.get("", response_model=list[TagRead])
async def list_tags(
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    category: int | None = None,
    q: str | None = Query(default=None, min_length=1),
    _: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await tag_service.list_tags(db, limit=limit, offset=offset, category=category, query=q)
