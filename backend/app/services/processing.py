from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.errors.error import AppError
from backend.app.models.processing import ImportBatch, ImportBatchItem
from backend.app.repositories.processing import ImportBatchItemRepository, ImportBatchRepository
from backend.app.schemas import ImportBatchItemListResponse, ImportBatchListResponse, ImportBatchRead
from backend.app.utils.pagination import apply_cursor_where_expr, decode_cursor_typed, encode_cursor


class ProcessingService:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def list_batches(
        self,
        user_id: uuid.UUID,
        *,
        after: str | None = None,
        page_size: int = 20,
    ) -> ImportBatchListResponse:
        repo = ImportBatchRepository(self._db)
        total = await repo.count_for_user(user_id)
        stmt = select(ImportBatch).where(ImportBatch.user_id == user_id)

        if after:
            decoded = decode_cursor_typed(after, "datetime")
            if decoded is not None:
                cursor_val, cursor_id = decoded
                stmt = apply_cursor_where_expr(
                    stmt,
                    sort_expr=ImportBatch.created_at,
                    id_expr=ImportBatch.id,
                    sort_order="desc",
                    cursor_val=cursor_val,
                    cursor_id=cursor_id,
                )

        rows = (await self._db.execute(stmt.order_by(ImportBatch.created_at.desc(), ImportBatch.id.desc()).limit(page_size + 1))).scalars().all()
        has_more = len(rows) > page_size
        rows = rows[:page_size]

        next_cursor = None
        if has_more and rows:
            last = rows[-1]
            next_cursor = encode_cursor(last.created_at, last.id)

        return ImportBatchListResponse(
            total=total,
            next_cursor=next_cursor,
            has_more=has_more,
            page_size=page_size,
            items=list(rows),
        )

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
        after: str | None = None,
        page_size: int = 50,
    ) -> ImportBatchItemListResponse:
        await self.get_batch_for_user(batch_id, user_id)
        total = await ImportBatchItemRepository(self._db).count_for_batch(batch_id)
        stmt = select(ImportBatchItem).where(ImportBatchItem.batch_id == batch_id)

        if after:
            decoded = decode_cursor_typed(after, "datetime")
            if decoded is not None:
                cursor_val, cursor_id = decoded
                stmt = apply_cursor_where_expr(
                    stmt,
                    sort_expr=ImportBatchItem.updated_at,
                    id_expr=ImportBatchItem.id,
                    sort_order="desc",
                    cursor_val=cursor_val,
                    cursor_id=cursor_id,
                )

        rows = (
            await self._db.execute(
                stmt.order_by(ImportBatchItem.updated_at.desc(), ImportBatchItem.id.desc()).limit(page_size + 1)
            )
        ).scalars().all()
        has_more = len(rows) > page_size
        rows = rows[:page_size]

        next_cursor = None
        if has_more and rows:
            last = rows[-1]
            next_cursor = encode_cursor(last.updated_at, last.id)

        return ImportBatchItemListResponse(
            total=total,
            next_cursor=next_cursor,
            has_more=has_more,
            page_size=page_size,
            items=list(rows),
        )
