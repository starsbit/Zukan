import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.database import get_db
from backend.app.routers.deps import current_user
from backend.app.models.auth import User
from backend.app.schemas import (
    AUTHENTICATED_ERROR_RESPONSES,
    ImportBatchItemListResponse,
    ImportBatchListResponse,
    ImportBatchRead,
    ImportBatchReviewListResponse,
    error_responses,
)
from backend.app.services.processing import ProcessingService

router = APIRouter(prefix="/me/import-batches", tags=["batches"], responses=AUTHENTICATED_ERROR_RESPONSES)


@router.get("", response_model=ImportBatchListResponse)
async def list_batches(
    after: str | None = Query(default=None, description="Opaque cursor for keyset pagination."),
    page_size: int = Query(default=20, ge=1, le=100),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await ProcessingService(db).list_batches(user.id, after=after, page_size=page_size)


@router.get("/{batch_id}", response_model=ImportBatchRead, responses=error_responses(404))
async def get_batch(
    batch_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await ProcessingService(db).get_batch_for_user(batch_id, user.id)


@router.get("/{batch_id}/items", response_model=ImportBatchItemListResponse, responses=error_responses(404))
async def list_batch_items(
    batch_id: uuid.UUID,
    after: str | None = Query(default=None, description="Opaque cursor for keyset pagination."),
    page_size: int = Query(default=50, ge=1, le=200),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await ProcessingService(db).list_batch_items(batch_id, user.id, after=after, page_size=page_size)


@router.get("/{batch_id}/review-items", response_model=ImportBatchReviewListResponse, responses=error_responses(404))
async def list_batch_review_items(
    batch_id: uuid.UUID,
    include_recommendations: bool = Query(default=False),
    force_refresh: bool = Query(default=False),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await ProcessingService(db).list_batch_review_items(
        batch_id,
        user.id,
        include_recommendations=include_recommendations,
        force_refresh=force_refresh,
    )
