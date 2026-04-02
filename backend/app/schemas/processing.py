import uuid
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field

from backend.app.schemas.media import MediaRead
from backend.app.schemas.relations import EntityRead


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
    total: int = Field(description="Total number of batches visible to the caller.")
    next_cursor: str | None = Field(
        default=None,
        description="Opaque cursor for fetching the next page. Keep filters and sort parameters unchanged between requests.",
    )
    has_more: bool = Field(description="Whether there are additional items after this page.")
    page_size: int = Field(description="Number of items returned per page.")
    items: list[ImportBatchRead] = Field(description="Import batches returned for the current page.")


class ImportBatchItemListResponse(BaseModel):
    total: int = Field(description="Total number of batch items for the selected batch.")
    next_cursor: str | None = Field(
        default=None,
        description="Opaque cursor for fetching the next page. Keep filters and sort parameters unchanged between requests.",
    )
    has_more: bool = Field(description="Whether there are additional items after this page.")
    page_size: int = Field(description="Number of items returned per page.")
    items: list[ImportBatchItemRead] = Field(description="Batch items returned for the current page.")


class ImportBatchReviewItemRead(BaseModel):
    batch_item_id: uuid.UUID
    media: MediaRead
    entities: list[EntityRead]
    source_filename: str
    missing_character: bool
    missing_series: bool


class ImportBatchReviewListResponse(BaseModel):
    total: int = Field(description="Number of currently reviewable items in the batch.")
    items: list[ImportBatchReviewItemRead]
