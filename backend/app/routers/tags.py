from fastapi import APIRouter, Depends, Path, Query
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.database import get_db
from backend.app.deps import current_user
from backend.app.models import User
from backend.app.schemas import TagManagementResult, TagRead
from backend.app.services import tags as tag_service

router = APIRouter(tags=["tags"])


@router.get("/tags", response_model=list[TagRead])
async def list_tags(
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    category: int | None = None,
    q: str | None = Query(default=None, min_length=1),
    _: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await tag_service.list_tags(db, limit=limit, offset=offset, category=category, query=q)


@router.delete("/tags/{tag_name}", response_model=TagManagementResult, summary="Remove Tag From Matching Media")
async def delete_tag(
    tag_name: str = Path(min_length=1),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await tag_service.remove_tag_from_media(db, user, tag_name=tag_name)


@router.post("/tags/{tag_name}/trash-media", response_model=TagManagementResult, summary="Move Matching Tag Media To Trash")
async def trash_media_by_tag(
    tag_name: str = Path(min_length=1),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await tag_service.trash_media_by_tag(db, user, tag_name=tag_name)


@router.delete(
    "/character-names/{character_name}",
    response_model=TagManagementResult,
    summary="Remove Character Name From Matching Media",
)
async def delete_character_name(
    character_name: str = Path(min_length=1),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await tag_service.clear_character_name(db, user, character_name=character_name)


@router.post(
    "/character-names/{character_name}/trash-media",
    response_model=TagManagementResult,
    summary="Move Matching Character Media To Trash",
)
async def trash_media_by_character_name(
    character_name: str = Path(min_length=1),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await tag_service.trash_media_by_character_name(db, user, character_name=character_name)
