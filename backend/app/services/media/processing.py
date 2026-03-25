from __future__ import annotations

import logging
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.errors.error import AppError
from backend.app.errors.tags import tagging_job_already_queued
from backend.app.models.auth import User
from backend.app.utils.media_common import format_tagging_error
from backend.app.services.media import get_tag_queue
from backend.app.services.media.query import MediaQueryService
from backend.app.ml.ocr import TesseractOCR

logger = logging.getLogger(__name__)


class MediaProcessingService:
    def __init__(self, db: AsyncSession, query: MediaQueryService) -> None:
        self._db = db
        self._query = query

    async def retag_media(self, media_id: uuid.UUID, user: User) -> int:
        media = await self._query.get_owned_or_admin_media(media_id, user, trashed=False)
        if media.tagging_status in ("pending", "processing"):
            raise AppError(status_code=409, code=tagging_job_already_queued, detail="Tagging job is already queued or running")
        media.tagging_status = "pending"
        media.tagging_error = None
        await self._db.commit()
        queue = get_tag_queue()
        if queue:
            await queue.put(media_id)
        return 1

    async def mark_tagging_failure(self, media_id: uuid.UUID, exc: Exception) -> None:
        media = await self._query.get_media_by_id(media_id)
        if media is None:
            return
        media.tagging_status = "failed"
        media.tagging_error = format_tagging_error(exc)
        await self._db.commit()

    async def run_ocr_for_media(self, media_id: uuid.UUID, ocr_model: TesseractOCR | None) -> None:
        if ocr_model is None:
            return
        media = await self._query.get_media_by_id(media_id)
        if media is None or media.deleted_at is not None:
            return
        try:
            media.ocr_text = await ocr_model.extract_text(media.filepath, media.media_type)
            await self._db.commit()
        except Exception as exc:
            # OCR is best-effort and should not fail the upload/tag pipeline.
            media.ocr_text = None
            await self._db.commit()
            logger.warning("OCR failed for media_id=%s error=%s", media_id, exc)
