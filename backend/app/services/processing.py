from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.errors.error import AppError
from backend.app.models.processing import ImportBatch, ImportBatchItem
from backend.app.repositories.processing import ImportBatchItemRepository, ImportBatchRepository
from backend.app.schemas import ImportBatchItemRead, ImportBatchListResponse, ImportBatchRead


class ProcessingService:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def list_batches(
        self,
        user_id: uuid.UUID,
        *,
        page: int = 1,
        page_size: int = 20,
    ) -> ImportBatchListResponse:
        repo = ImportBatchRepository(self._db)
        offset = (page - 1) * page_size
        total = await repo.count_for_user(user_id)
        items = await repo.list_for_user(user_id, offset=offset, limit=page_size)
        return ImportBatchListResponse(total=total, page=page, page_size=page_size, items=list(items))

    async def get_batch_for_user(self, batch_id: uuid.UUID, user_id: uuid.UUID) -> ImportBatch:
        batch = await ImportBatchRepository(self._db).get_by_id_for_user(batch_id, user_id)
        if batch is None:
            raise AppError(status_code=404, code="batch_not_found", detail="Batch not found")
        return batch

    async def list_batch_items(
        self,
        batch_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        page: int = 1,
        page_size: int = 50,
    ) -> list[ImportBatchItem]:
        await self.get_batch_for_user(batch_id, user_id)
        offset = (page - 1) * page_size
        return await ImportBatchItemRepository(self._db).list_for_batch(batch_id, offset=offset, limit=page_size)
