import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.app.models.media import Media, MediaTag
from backend.app.models.processing import BatchStatus, ImportBatch, ImportBatchItem


class ImportBatchRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_by_id(self, batch_id: uuid.UUID) -> ImportBatch | None:
        return (await self.db.execute(select(ImportBatch).where(ImportBatch.id == batch_id))).scalar_one_or_none()

    async def get_by_id_for_user(self, batch_id: uuid.UUID, user_id: uuid.UUID) -> ImportBatch | None:
        return (
            await self.db.execute(
                select(ImportBatch).where(ImportBatch.id == batch_id, ImportBatch.user_id == user_id)
            )
        ).scalar_one_or_none()

    async def list_for_user(self, user_id: uuid.UUID, *, offset: int, limit: int) -> list[ImportBatch]:
        return (
            await self.db.execute(
                select(ImportBatch)
                .where(ImportBatch.user_id == user_id)
                .order_by(ImportBatch.created_at.desc())
                .offset(offset)
                .limit(limit)
            )
        ).scalars().all()

    async def count_for_user(self, user_id: uuid.UUID) -> int:
        return (
            await self.db.execute(select(func.count()).select_from(ImportBatch).where(ImportBatch.user_id == user_id))
        ).scalar_one()

    async def list_by_status(self, user_id: uuid.UUID, status: BatchStatus) -> list[ImportBatch]:
        return (
            await self.db.execute(
                select(ImportBatch)
                .where(ImportBatch.user_id == user_id, ImportBatch.status == status)
                .order_by(ImportBatch.created_at.desc())
            )
        ).scalars().all()

    async def list_running(self) -> list[ImportBatch]:
        return (
            await self.db.execute(
                select(ImportBatch).where(ImportBatch.status == BatchStatus.running)
            )
        ).scalars().all()


class ImportBatchItemRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_by_id(self, item_id: uuid.UUID) -> ImportBatchItem | None:
        return (await self.db.execute(select(ImportBatchItem).where(ImportBatchItem.id == item_id))).scalar_one_or_none()

    async def list_for_batch(self, batch_id: uuid.UUID, *, offset: int, limit: int) -> list[ImportBatchItem]:
        return (
            await self.db.execute(
                select(ImportBatchItem)
                .where(ImportBatchItem.batch_id == batch_id)
                .offset(offset)
                .limit(limit)
            )
        ).scalars().all()

    async def count_for_batch(self, batch_id: uuid.UUID) -> int:
        return (
            await self.db.execute(
                select(func.count()).select_from(ImportBatchItem).where(ImportBatchItem.batch_id == batch_id)
            )
        ).scalar_one()

    async def get_for_media(self, media_id: uuid.UUID) -> list[ImportBatchItem]:
        return (
            await self.db.execute(
                select(ImportBatchItem).where(ImportBatchItem.media_id == media_id)
            )
        ).scalars().all()

    async def get_pending_for_batch(self, batch_id: uuid.UUID) -> list[ImportBatchItem]:
        from backend.app.models.processing import ItemStatus
        return (
            await self.db.execute(
                select(ImportBatchItem).where(
                    ImportBatchItem.batch_id == batch_id,
                    ImportBatchItem.status == ItemStatus.pending,
                )
            )
        ).scalars().all()

    async def list_all_review_candidates_for_user(self, user_id: uuid.UUID) -> list[ImportBatchItem]:
        stmt = (
            select(ImportBatchItem)
            .join(ImportBatch, ImportBatch.id == ImportBatchItem.batch_id)
            .options(
                selectinload(ImportBatchItem.media).selectinload(Media.uploader),
                selectinload(ImportBatchItem.media).selectinload(Media.owner),
                selectinload(ImportBatchItem.media).selectinload(Media.entities),
                selectinload(ImportBatchItem.media).selectinload(Media.media_tags).selectinload(MediaTag.tag),
            )
            .where(
                ImportBatch.user_id == user_id,
                ImportBatchItem.media_id.is_not(None),
            )
            .order_by(ImportBatchItem.updated_at.desc(), ImportBatchItem.id.desc())
        )
        return (await self.db.execute(stmt)).scalars().all()

    async def list_review_candidates_for_batch(self, batch_id: uuid.UUID) -> list[ImportBatchItem]:
        stmt = (
            select(ImportBatchItem)
            .options(
                selectinload(ImportBatchItem.media).selectinload(Media.uploader),
                selectinload(ImportBatchItem.media).selectinload(Media.owner),
                selectinload(ImportBatchItem.media).selectinload(Media.entities),
                selectinload(ImportBatchItem.media).selectinload(Media.media_tags).selectinload(MediaTag.tag),
            )
            .where(ImportBatchItem.batch_id == batch_id, ImportBatchItem.media_id.is_not(None))
            .order_by(ImportBatchItem.updated_at.desc(), ImportBatchItem.id.desc())
        )
        return (await self.db.execute(stmt)).scalars().all()
