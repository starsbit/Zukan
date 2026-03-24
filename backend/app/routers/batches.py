import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.database import get_db
from backend.app.routers.deps import current_user
from backend.app.models.auth import User
from backend.app.schemas import ERROR_RESPONSES, ImportBatchItemRead, ImportBatchListResponse, ImportBatchRead
from backend.app.services.processing import ProcessingService

router = APIRouter(prefix="/me/import-batches", tags=["batches"], responses=ERROR_RESPONSES)


@router.get("", response_model=ImportBatchListResponse)
async def list_batches(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await ProcessingService(db).list_batches(user.id, page=page, page_size=page_size)


@router.get("/{batch_id}", response_model=ImportBatchRead)
async def get_batch(
    batch_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await ProcessingService(db).get_batch_for_user(batch_id, user.id)


@router.get("/{batch_id}/items", response_model=list[ImportBatchItemRead])
async def list_batch_items(
    batch_id: uuid.UUID,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await ProcessingService(db).list_batch_items(batch_id, user.id, page=page, page_size=page_size)
