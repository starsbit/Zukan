import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.database import get_db
from backend.app.models.auth import User
from backend.app.models.gacha import RarityTier
from backend.app.routers.deps import current_user
from backend.app.schemas import AUTHENTICATED_ERROR_RESPONSES, error_responses
from backend.app.schemas.collection import (
    CollectionFilters,
    CollectionItemRead,
    CollectionItemUpdate,
    CollectionListResponse,
    CollectionPrivacyRead,
    CollectionPrivacyUpdate,
    CollectionStatsResponse,
)
from backend.app.services.collection import CollectionService

collection_router = APIRouter(prefix="/collection", tags=["collection"], responses=AUTHENTICATED_ERROR_RESPONSES)
users_collection_router = APIRouter(prefix="/users", tags=["collection"], responses=AUTHENTICATED_ERROR_RESPONSES)


def collection_filters(
    rarity_tier: RarityTier | None = Query(default=None),
    character_name: str | None = Query(default=None, max_length=512),
    series_name: str | None = Query(default=None, max_length=512),
    level: int | None = Query(default=None, ge=1, le=5),
    tradeable: bool | None = Query(default=None),
    duplicates_only: bool = Query(default=False),
) -> CollectionFilters:
    return CollectionFilters(
        rarity_tier=rarity_tier,
        character_name=character_name,
        series_name=series_name,
        level=level,
        tradeable=tradeable,
        duplicates_only=duplicates_only,
    )


@collection_router.get("", response_model=CollectionListResponse, summary="List Current User Collection")
async def list_own_collection(
    filters: CollectionFilters = Depends(collection_filters),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    items = await CollectionService(db).list_own_collection(user, filters)
    return CollectionListResponse(total=len(items), items=items)


@collection_router.get(
    "/items/{item_id}",
    response_model=CollectionItemRead,
    summary="Get Current User Collection Item",
    responses=error_responses(404),
)
async def get_collection_item(
    item_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await CollectionService(db).get_item(item_id, user)


@collection_router.patch(
    "/items/{item_id}",
    response_model=CollectionItemRead,
    summary="Update Current User Collection Item",
    responses=error_responses(404),
)
async def update_collection_item(
    item_id: uuid.UUID,
    body: CollectionItemUpdate,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await CollectionService(db).update_item(item_id, user, body)


@collection_router.post(
    "/items/{item_id}/upgrade",
    response_model=CollectionItemRead,
    summary="Upgrade Current User Collection Item",
    responses=error_responses(404, 409),
)
async def upgrade_collection_item(
    item_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await CollectionService(db).upgrade_item(item_id, user)


@users_collection_router.get(
    "/me/collection-privacy",
    response_model=CollectionPrivacyRead,
    summary="Get Current User Collection Privacy",
)
async def get_collection_privacy(
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await CollectionService(db).get_privacy(user)


@users_collection_router.patch(
    "/me/collection-privacy",
    response_model=CollectionPrivacyRead,
    summary="Update Current User Collection Privacy",
)
async def update_collection_privacy(
    body: CollectionPrivacyUpdate,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await CollectionService(db).update_privacy(user, body)


@users_collection_router.get(
    "/{user_id}/collection",
    response_model=CollectionListResponse,
    summary="List User Collection",
    responses=error_responses(403),
)
async def list_user_collection(
    user_id: uuid.UUID,
    filters: CollectionFilters = Depends(collection_filters),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    items = await CollectionService(db).list_user_collection(user_id, user, filters)
    return CollectionListResponse(total=len(items), items=items)


@users_collection_router.get(
    "/{user_id}/collection/stats",
    response_model=CollectionStatsResponse,
    summary="Get User Collection Stats",
    responses=error_responses(403),
)
async def user_collection_stats(
    user_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await CollectionService(db).stats(user_id, user)
