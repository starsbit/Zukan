import uuid
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field, model_validator

from backend.app.models.media import MediaType, ProcessingStatus, TaggingStatus
from backend.app.schemas.relations import EntityCreate, EntityRead, ExternalRefCreate, ExternalRefRead
from backend.app.schemas.tags import TagWithConfidence


class MediaMetadata(BaseModel):
    file_size: int | None = Field(description="Original file size in bytes.")
    width: int | None = Field(description="Display width in pixels.")
    height: int | None = Field(description="Display height in pixels.")
    duration_seconds: float | None = Field(default=None, description="Duration in seconds for animated media.")
    frame_count: int | None = Field(default=None, description="Frame count for animated media when known.")
    mime_type: str | None = Field(description="Detected MIME type for the media.")
    captured_at: datetime = Field(description="Best-known timestamp for when the media was captured or created.")


class MediaMetadataUpdate(BaseModel):
    captured_at: datetime | None = Field(
        default=None,
        description="Manual capture timestamp override. Send null to reset it to the upload timestamp.",
    )


class MediaMetadataFilter(BaseModel):
    captured_year: int | None = Field(default=None, description="Filter media by the captured year metadata.")
    captured_month: int | None = Field(default=None, ge=1, le=12, description="Filter media by captured month metadata.")
    captured_day: int | None = Field(default=None, ge=1, le=31, description="Filter media by captured day metadata.")
    captured_after: datetime | None = Field(default=None, description="Filter media captured on or after this timestamp.")
    captured_before: datetime | None = Field(default=None, description="Filter media captured on or before this timestamp.")
    captured_before_year: int | None = Field(
        default=None,
        description="Filter media captured before the given year. Useful for on-this-day style lookups.",
    )

    @model_validator(mode="after")
    def validate_date_filters(self):
        if self.captured_month is not None and self.captured_day is not None:
            try:
                datetime(2000, self.captured_month, self.captured_day)
            except ValueError as exc:
                raise ValueError("Invalid captured month/day combination") from exc
        if self.captured_after is not None and self.captured_before is not None and self.captured_after > self.captured_before:
            raise ValueError("captured_after must be before or equal to captured_before")
        return self


class MediaRead(BaseModel):
    id: uuid.UUID
    uploader_id: uuid.UUID | None
    owner_id: uuid.UUID | None = None
    visibility: str = "private"
    filename: str
    original_filename: str | None
    media_type: MediaType = MediaType.IMAGE
    metadata: MediaMetadata
    version: int
    created_at: datetime
    deleted_at: datetime | None
    tags: list[str] = Field(description="All tags currently stored for the media.")
    ocr_text_override: str | None = Field(
        default=None,
        description="User-supplied transcript or OCR correction. Takes precedence over system-derived ocr_text.",
    )
    is_nsfw: bool = Field(description="Whether the media is classified as NSFW by the active tagging backend.")
    tagging_status: TaggingStatus = Field(description="Current AI tagging lifecycle state. One of: pending, processing, done, failed.")
    tagging_error: str | None = Field(default=None, description="Last tagging failure message, if any.")
    thumbnail_status: ProcessingStatus = Field(description="Current thumbnail generation lifecycle state. One of: pending, processing, done, failed, not_applicable.")
    poster_status: ProcessingStatus = Field(default=ProcessingStatus.PENDING, description="Current poster generation lifecycle state for animated media.")
    ocr_text: str | None = Field(default=None, description="System-derived OCR text. Read-only; set by the OCR pipeline.")
    is_favorited: bool = Field(default=False, description="Whether the current user has favorited this media item.")


class MediaDetail(MediaRead):
    tag_details: list[TagWithConfidence] = Field(
        default_factory=list,
        description="Detailed tag payload including category metadata and confidence scores.",
    )
    external_refs: list[ExternalRefRead] = Field(
        default_factory=list,
        description="External references linking this media to known providers.",
    )
    entities: list[EntityRead] = Field(
        default_factory=list,
        description="Entity annotations for this media (e.g. identified characters).",
    )


class MediaListState(str, Enum):
    ACTIVE = "active"
    TRASHED = "trashed"


class MediaUpdate(BaseModel):
    tags: list[str] | None = Field(
        default=None,
        description="Complete replacement tag list. Omit to keep tags unchanged.",
    )
    entities: list[EntityCreate] | None = Field(
        default=None,
        description="Complete replacement entity list. Omit to keep unchanged. Send empty list to clear.",
    )
    metadata: MediaMetadataUpdate | None = None
    deleted: bool | None = Field(
        default=None,
        description="Whether the media should be in the trash. Omit to keep deletion state unchanged.",
    )
    favorited: bool | None = Field(
        default=None,
        description="Whether the media should be favorited for the current user. Omit to keep favorite state unchanged.",
    )
    ocr_text_override: str | None = Field(
        default=None,
        description="User-supplied transcript or OCR correction. Send null to clear. Omit to keep unchanged.",
    )
    external_refs: list[ExternalRefCreate] | None = Field(
        default=None,
        description="Complete replacement list of external references. Omit to keep unchanged.",
    )
    version: int | None = Field(default=None, description="Current version of the resource for optimistic locking.")

    @model_validator(mode="after")
    def validate_non_empty(self):
        mutable_fields = set(self.model_fields_set)
        if "metadata" in mutable_fields and self.metadata is not None and not self.metadata.model_fields_set:
            raise ValueError("metadata must include at least one mutable field")
        if not mutable_fields:
            raise ValueError("At least one mutable field must be provided")
        return self


class MediaListResponse(BaseModel):
    total: int = Field(description="Total number of media items matching the current filters.")
    page: int = Field(description="Current page number.")
    page_size: int = Field(description="Number of items returned per page.")
    items: list[MediaRead] = Field(description="Media returned for the current page.")


class MediaCursorPage(BaseModel):
    total: int | None = Field(
        default=None,
        description="Total number of media items matching the current filters. Null when include_total=false.",
    )
    next_cursor: str | None = Field(description="Opaque cursor for fetching the next page. Null if no more items.")
    page_size: int = Field(description="Number of items returned per page.")
    items: list[MediaRead] = Field(description="Media returned for the current page.")