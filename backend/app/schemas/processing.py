import uuid
from datetime import datetime
from enum import Enum

from pydantic import BaseModel


class BatchType(str, Enum):
    upload = "upload"
    retag = "retag"
    rethumbnail = "rethumbnail"
    rescan = "rescan"


class BatchStatus(str, Enum):
    pending = "pending"
    running = "running"
    partial_failed = "partial_failed"
    done = "done"
    failed = "failed"
    cancelled = "cancelled"


class BatchItemStatus(str, Enum):
    pending = "pending"
    processing = "processing"
    done = "done"
    failed = "failed"
    skipped = "skipped"


class ImportBatchRead(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    type: BatchType
    status: BatchStatus
    total_items: int
    queued_items: int
    processing_items: int
    done_items: int
    failed_items: int
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
    last_heartbeat_at: datetime | None = None
    app_version: str | None = None
    worker_version: str | None = None
    error_summary: str | None = None

    model_config = {"from_attributes": True}


class ImportBatchItemRead(BaseModel):
    id: uuid.UUID
    batch_id: uuid.UUID
    media_id: uuid.UUID | None = None
    source_filename: str
    status: BatchItemStatus
    step: str | None = None
    progress_percent: int | None = None
    error: str | None = None
    updated_at: datetime

    model_config = {"from_attributes": True}


class ImportBatchListResponse(BaseModel):
    total: int
    next_cursor: str | None = None
    prev_cursor: str | None = None
    has_more: bool
    page_size: int
    items: list[ImportBatchRead]


class ImportBatchItemListResponse(BaseModel):
    total: int
    next_cursor: str | None = None
    prev_cursor: str | None = None
    has_more: bool
    page_size: int
    items: list[ImportBatchItemRead]