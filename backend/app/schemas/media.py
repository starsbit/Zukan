import uuid
from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from backend.app.models.media import MediaType, ProcessingStatus, TaggingStatus
from backend.app.schemas.relations import EntityCreate, EntityRead, ExternalRefCreate, ExternalRefRead
from backend.app.schemas.tags import TagWithConfidence


class MediaMetadata(BaseModel):
    file_size: int | None = Field(default=None, description="Original file size in bytes.")
    width: int | None = Field(default=None, description="Display width in pixels.")
    height: int | None = Field(default=None, description="Display height in pixels.")
    duration_seconds: float | None = Field(default=None, description="Duration in seconds for animated media.")
    frame_count: int | None = Field(default=None, description="Frame count for animated media when known.")
    mime_type: str | None = Field(default=None, description="Detected MIME type for the media.")
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
    uploader_id: uuid.UUID | None = None
    owner_id: uuid.UUID | None = Field(
        default=None,
        description=(
            "Current owning user id for compatibility with future ownership workflows. "
            "In the current public contract this is equivalent to uploader ownership semantics."
        ),
    )
    visibility: Literal["private"] = Field(
        default="private",
        description=(
            "Public API visibility contract. Currently always `private`; no public endpoints expose or mutate broader visibility modes."
        ),
    )
    filename: str
    original_filename: str | None = None
    media_type: MediaType = MediaType.IMAGE
    metadata: MediaMetadata
    version: int
    created_at: datetime
    deleted_at: datetime | None = None
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

    model_config = {
        "json_schema_extra": {
            "example": {
                "id": "0f729258-8c26-4d04-aa95-d33f0bcfb6b8",
                "uploader_id": "fe1db6af-8f07-4b07-85cd-5676d7f7aa19",
                "owner_id": "fe1db6af-8f07-4b07-85cd-5676d7f7aa19",
                "visibility": "private",
                "filename": "2026-03-24_15-07-11.webp",
                "original_filename": "saberalterburger.webp",
                "media_type": "image",
                "metadata": {
                    "file_size": 253114,
                    "width": 1920,
                    "height": 1080,
                    "duration_seconds": None,
                    "frame_count": None,
                    "mime_type": "image/webp",
                    "captured_at": "2026-03-24T15:07:11Z"
                },
                "version": 5,
                "created_at": "2026-03-24T15:07:13Z",
                "deleted_at": None,
                "tags": ["Saber", "white hair", "cat", "burger"],
                "ocr_text_override": None,
                "is_nsfw": False,
                "tagging_status": "done",
                "tagging_error": None,
                "thumbnail_status": "done",
                "poster_status": "not_applicable",
                "ocr_text": "Some text in the image here",
                "is_favorited": False,
                "tag_details": [
                    {
                        "name": "street",
                        "category": 0,
                        "category_name": "general",
                        "category_key": "general",
                        "confidence": 0.96
                    }
                ],
                "external_refs": [
                    {
                        "provider": "pixiv",
                        "external_id": "987654",
                        "url": "https://www.pixiv.net/en/artworks/75453892"
                    }
                ],
                "entities": [
                    {
                        "entity_type": "character",
                        "entity_id": None,
                        "name": "Saber (Alter)",
                        "role": "primary",
                        "source": "manual",
                        "confidence": 0.93
                    }
                ]
            }
        }
    }


class MediaListState(str, Enum):
    ACTIVE = "active"
    TRASHED = "trashed"


class MediaUpdate(BaseModel):
    tags: list[str] | None = Field(
        default=None,
        description=(
            "Complete replacement tag list. Omit field to keep unchanged; send empty array to clear all tags; "
            "send populated array to replace all tags."
        ),
    )
    entities: list[EntityCreate] | None = Field(
        default=None,
        description=(
            "Complete replacement entity list. Omit field to keep unchanged; send empty array to clear all entities; "
            "send populated array to replace all entities."
        ),
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
        description=(
            "Complete replacement list of external references. Omit field to keep unchanged; send empty array to clear all refs; "
            "send populated array to replace all refs."
        ),
    )
    version: int | None = Field(default=None, description="Current version of the resource for optimistic locking.")

    model_config = {
        "json_schema_extra": {
            "example": {
                "tags": ["Saber", "Sakura", "Rin"],
                "entities": [
                    {
                        "entity_type": "character",
                        "entity_id": None,
                        "name": "Saber",
                        "role": "primary",
                        "confidence": 0.98,
                    }
                ],
                "external_refs": [
                    {
                        "provider": "pixiv",
                        "external_id": "75453892",
                        "url": "https://www.pixiv.net/en/artworks/75453892",
                    }
                ],
                "metadata": {"captured_at": "2026-03-24T15:07:11Z"},
                "favorited": True,
                "ocr_text_override": "Other text because I did not like the one in the image",
                "version": 5,
            }
        }
    }

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
    next_cursor: str | None = Field(
        default=None,
        description="Opaque cursor for fetching the next page. Keep filters and sort parameters unchanged between requests.",
    )
    has_more: bool = Field(description="Whether there are additional items after this page.")
    page_size: int = Field(description="Number of items returned per page.")
    items: list[MediaRead] = Field(description="Media returned for the current page.")