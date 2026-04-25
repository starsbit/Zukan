import uuid
from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field

from backend.app.schemas.media import MediaRead
from backend.app.schemas.relations import EntityRead


class BatchType(str, Enum):
    upload = "upload"
    review_merge = "review_merge"
    retag = "retag"
    rethumbnail = "rethumbnail"
    rescan = "rescan"
    embedding_backfill = "embedding_backfill"


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
    suggested_characters: list["ImportBatchRecommendationSuggestionRead"] = Field(default_factory=list)
    suggested_series: list["ImportBatchRecommendationSuggestionRead"] = Field(default_factory=list)


class ImportBatchRecommendationSuggestionRead(BaseModel):
    name: str
    confidence: float = Field(description="Relative confidence for this suggestion within the recommendation group.")
    entity_id: uuid.UUID | None = Field(default=None, description="Optional canonical entity id for this suggestion.")
    entity_type: str | None = Field(default=None, description="Entity type this suggestion applies to.")
    series_name: str | None = Field(default=None, description="Optional series context for this suggestion.")
    source: str | None = Field(default=None, description="Signal source that produced this suggestion.")
    model_version: str | None = Field(default=None, description="Embedding model version used for this suggestion.")
    visual_similarity: float | None = Field(default=None, description="Best visual similarity behind this suggestion.")
    explanation: str | None = Field(default=None, description="Human-readable explanation of why this suggestion was made.")


class ImportBatchRecommendationSignalRead(BaseModel):
    kind: Literal["tag", "visual", "ocr", "entity"]
    label: str
    confidence: float | None = Field(
        default=None,
        description="Optional relative confidence for the shared signal.",
    )


class ImportBatchRecommendationGroupRead(BaseModel):
    id: str
    media_ids: list[uuid.UUID]
    item_count: int
    missing_character_count: int
    missing_series_count: int
    suggested_characters: list[ImportBatchRecommendationSuggestionRead]
    suggested_series: list[ImportBatchRecommendationSuggestionRead]
    shared_signals: list[ImportBatchRecommendationSignalRead]
    confidence: float


class ImportBatchReviewListResponse(BaseModel):
    total: int = Field(description="Number of currently reviewable items in the batch.")
    items: list[ImportBatchReviewItemRead]
    recommendation_groups: list[ImportBatchRecommendationGroupRead] = Field(
        default_factory=list,
        description="Recommendation groups for unresolved review items in this batch.",
    )


class ImportBatchMergedReviewResponse(ImportBatchReviewListResponse):
    merged_batch_id: uuid.UUID = Field(description="Persisted synthetic batch id representing the merged review scope.")


class ImportBatchReviewSummaryResponse(BaseModel):
    unresolved_count: int = Field(description="Total number of unresolved metadata review items across upload batches.")
    review_batch_ids: list[uuid.UUID] = Field(
        default_factory=list,
        description="Upload batch ids that still contain unresolved metadata review items.",
    )
    latest_batch_id: uuid.UUID | None = Field(
        default=None,
        description="Most recently created batch that still has unresolved metadata review items.",
    )
    latest_batch_created_at: datetime | None = Field(
        default=None,
        description="Creation timestamp of latest_batch_id.",
    )
