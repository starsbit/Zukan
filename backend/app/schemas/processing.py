import uuid
from datetime import datetime
from enum import Enum

from pydantic import BaseModel


class BatchTypeEnum(str, Enum):
    upload = "upload"
    retag = "retag"
    rethumbnail = "rethumbnail"
    rescan = "rescan"


class BatchStatusEnum(str, Enum):
    pending = "pending"
    running = "running"
    partial_failed = "partial_failed"
    done = "done"
    failed = "failed"
    cancelled = "cancelled"


class ItemStatusEnum(str, Enum):
    pending = "pending"
    processing = "processing"
    done = "done"
    failed = "failed"
    skipped = "skipped"


class ImportBatchRead(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    type: BatchTypeEnum
    status: BatchStatusEnum
    total_items: int
    queued_items: int
    processing_items: int
    done_items: int
    failed_items: int
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    last_heartbeat_at: datetime | None
    app_version: str | None
    worker_version: str | None
    error_summary: str | None

    model_config = {"from_attributes": True}


class ImportBatchItemRead(BaseModel):
    id: uuid.UUID
    batch_id: uuid.UUID
    media_id: uuid.UUID | None
    source_filename: str
    status: ItemStatusEnum
    step: str | None
    progress_percent: int | None
    error: str | None
    updated_at: datetime

    model_config = {"from_attributes": True}


class ImportBatchListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[ImportBatchRead]