import uuid
from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, model_validator

from backend.app.models import MediaType

CATEGORY_NAMES = {0: "general", 1: "artist", 3: "copyright", 4: "character", 5: "meta", 9: "rating"}


class UserRegister(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    email: EmailStr
    password: str = Field(min_length=8)


class UserLogin(BaseModel):
    username: str
    password: str
    remember_me: bool = False


class UserRead(BaseModel):
    id: uuid.UUID
    username: str
    email: str
    is_admin: bool
    show_nsfw: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class UserUpdate(BaseModel):
    show_nsfw: bool | None = None
    password: str | None = Field(default=None, min_length=8)


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class AccessTokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str


class TagRead(BaseModel):
    id: int
    name: str = Field(description="Canonical tag name.")
    category: int = Field(description="Numeric tag category from the tagging backend.")
    category_name: str = Field(description="Human-readable tag category name.")
    media_count: int = Field(description="Number of media items currently associated with this tag.")

    model_config = {"from_attributes": True}


class CharacterSuggestion(BaseModel):
    name: str = Field(description="Persisted character name suggestion.")
    media_count: int = Field(description="Number of visible media items using this character name.")


class TagWithConfidence(BaseModel):
    name: str = Field(description="Canonical tag name.")
    category: int = Field(description="Numeric tag category from the tagging backend.")
    category_name: str = Field(description="Human-readable tag category name.")
    confidence: float = Field(description="Model confidence score for this tag.")


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
    filename: str
    original_filename: str | None
    media_type: MediaType = MediaType.IMAGE
    metadata: MediaMetadata
    tags: list[str] = Field(description="All tags currently stored for the media.")
    character_name: str | None = Field(
        default=None,
        description="Highest-confidence character tag selected by the active tagging backend, if any.",
    )
    is_nsfw: bool = Field(description="Whether the media is classified as NSFW by the active tagging backend.")
    tagging_status: str = Field(description="Current AI tagging lifecycle state.")
    thumbnail_status: str = Field(description="Current thumbnail generation lifecycle state.")
    poster_status: str = Field(default="done", description="Current poster generation lifecycle state for animated media.")
    created_at: datetime
    deleted_at: datetime | None
    is_favorited: bool = Field(default=False, description="Whether the current user has favorited this media item.")


class MediaDetail(MediaRead):
    tag_details: list[TagWithConfidence] = Field(
        default_factory=list,
        description="Detailed tag payload including category metadata and confidence scores.",
    )


class MediaListState(str, Enum):
    ACTIVE = "active"
    TRASHED = "trashed"


class MediaUpdate(BaseModel):
    tags: list[str] | None = Field(
        default=None,
        description="Complete replacement tag list. Omit to keep tags unchanged.",
    )
    character_name: str | None = Field(
        default=None,
        description="Manual character name override. Send null or an empty string to clear it.",
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


class TagFilterMode(str, Enum):
    AND = "and"
    OR = "or"


class NsfwFilter(str, Enum):
    DEFAULT = "default"
    ONLY = "only"
    INCLUDE = "include"


class AlbumCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None


class AlbumUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    cover_media_id: uuid.UUID | None = None


class AlbumRead(BaseModel):
    id: uuid.UUID
    owner_id: uuid.UUID
    name: str
    description: str | None
    cover_media_id: uuid.UUID | None
    media_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

class AlbumShareCreate(BaseModel):
    user_id: uuid.UUID
    can_edit: bool = False


class AlbumShareRead(BaseModel):
    user_id: uuid.UUID
    can_edit: bool

    model_config = {"from_attributes": True}


class MediaBatchUpdate(BaseModel):
    media_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)
    deleted: bool | None = None
    favorited: bool | None = None

    @model_validator(mode="after")
    def validate_non_empty(self):
        if self.deleted is None and self.favorited is None:
            raise ValueError("At least one mutable field must be provided")
        return self


class MediaBatchDelete(BaseModel):
    media_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)


class AlbumMediaBatchUpdate(BaseModel):
    media_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)


class BulkResult(BaseModel):
    processed: int
    skipped: int


class DownloadRequest(BaseModel):
    media_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)


class TaggingJobQueuedResponse(BaseModel):
    queued: int


class AdminUserUpdate(BaseModel):
    is_admin: bool | None = None
    show_nsfw: bool | None = None


class AdminUserDetail(UserRead):
    media_count: int
    storage_used_bytes: int


class AdminStatsResponse(BaseModel):
    total_users: int
    total_media: int
    total_storage_bytes: int
    pending_tagging: int
    failed_tagging: int
    trashed_media: int

class UserListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[UserRead]


class UploadResult(BaseModel):
    id: uuid.UUID | None
    original_filename: str
    status: Literal["accepted", "duplicate", "error"]
    message: str | None = None


class BatchUploadResponse(BaseModel):
    accepted: int
    duplicates: int
    errors: int
    results: list[UploadResult]
