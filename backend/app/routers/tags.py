from typing import Literal

from fastapi import APIRouter, Depends, Path, Query
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.database import get_db
from backend.app.routers.deps import current_user
from backend.app.models.auth import User
from backend.app.schemas import ERROR_RESPONSES, TagListResponse, TagManagementResult
from backend.app.services.relations import RelationService
from backend.app.services.tags import TagService

router = APIRouter(tags=["tags"], responses=ERROR_RESPONSES)


@router.get("/tags", response_model=TagListResponse)
async def list_tags(
    after: str | None = Query(default=None, description="Opaque cursor for keyset pagination."),
    page_size: int = Query(default=100, ge=1, le=1000),
    category: int | None = None,
    q: str | None = Query(default=None, min_length=1),
    sort_by: Literal["name", "media_count"] = Query(default="media_count", description="Field to sort by."),
    sort_order: Literal["asc", "desc"] = Query(default="desc", description="Sort direction."),
    _: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await TagService(db).list_tags(after=after, page_size=page_size, category=category, query=q, sort_by=sort_by, sort_order=sort_order)


@router.post("/tags/{tag_id}/actions/remove-from-media", response_model=TagManagementResult, summary="Remove Tag From Matching Media")
async def remove_tag_from_media(
    tag_id: int = Path(ge=1),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await TagService(db).remove_tag_from_media_by_id(user, tag_id=tag_id)


@router.post("/tags/{tag_id}/actions/trash-media", response_model=TagManagementResult, summary="Move Matching Tag Media To Trash")
async def trash_media_by_tag(
    tag_id: int = Path(ge=1),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await TagService(db).trash_media_by_tag_id(user, tag_id=tag_id)


@router.post(
    "/character-names/{character_name}/actions/remove-from-media",
    response_model=TagManagementResult,
    summary="Remove Character Name From Matching Media",
)
async def remove_character_name_from_media(
    character_name: str = Path(min_length=1),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await RelationService(db).clear_character_name(user, character_name=character_name)


@router.post(
    "/character-names/{character_name}/actions/trash-media",
    response_model=TagManagementResult,
    summary="Move Matching Character Media To Trash",
)
async def trash_media_by_character_name(
    character_name: str = Path(min_length=1),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await RelationService(db).trash_media_by_character_name(user, character_name=character_name)
