import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.database import get_db
from backend.app.deps import current_user
from backend.app.models.auth import User
from backend.app.repositories.processing import ImportBatchItemRepository, ImportBatchRepository
from backend.app.schemas import ERROR_RESPONSES, ImportBatchItemRead, ImportBatchListResponse, ImportBatchRead

router = APIRouter(prefix="/me/import-batches", tags=["batches"], responses=ERROR_RESPONSES)


@router.get("", response_model=ImportBatchListResponse)
async def list_batches(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    repo = ImportBatchRepository(db)
    offset = (page - 1) * page_size
    total = await repo.count_for_user(user.id)
    items = await repo.list_for_user(user.id, offset=offset, limit=page_size)
    return ImportBatchListResponse(total=total, page=page, page_size=page_size, items=list(items))


@router.get("/{batch_id}", response_model=ImportBatchRead)
async def get_batch(
    batch_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    batch = await ImportBatchRepository(db).get_by_id_for_user(batch_id, user.id)
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Batch not found")
    return batch


@router.get("/{batch_id}/items", response_model=list[ImportBatchItemRead])
async def list_batch_items(
    batch_id: uuid.UUID,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    if await ImportBatchRepository(db).get_by_id_for_user(batch_id, user.id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Batch not found")
    offset = (page - 1) * page_size
    return await ImportBatchItemRepository(db).list_for_batch(batch_id, offset=offset, limit=page_size)
