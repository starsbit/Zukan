import uuid
from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, model_validator

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
    image_count: int = Field(description="Number of images currently associated with this tag.")

    model_config = {"from_attributes": True}


class TagWithConfidence(BaseModel):
    name: str = Field(description="Canonical tag name.")
    category: int = Field(description="Numeric tag category from the tagging backend.")
    category_name: str = Field(description="Human-readable tag category name.")
    confidence: float = Field(description="Model confidence score for this tag.")


class ImageRead(BaseModel):
    id: uuid.UUID
    uploader_id: uuid.UUID | None
    filename: str
    original_filename: str | None
    file_size: int | None
    width: int | None
    height: int | None
    mime_type: str | None
    tags: list[str] = Field(description="All tags currently stored for the image, including rating and character tags.")
    character_name: str | None = Field(
        default=None,
        description="Highest-confidence character tag selected by the active tagging backend, if any.",
    )
    is_nsfw: bool = Field(description="Whether the image is classified as NSFW by the active tagging backend.")
    tagging_status: str = Field(description="Current AI tagging lifecycle state.")
    thumbnail_status: str = Field(description="Current thumbnail generation lifecycle state.")
    created_at: datetime
    deleted_at: datetime | None
    is_favorited: bool = Field(default=False, description="Whether the current user has favorited this image.")

    model_config = {"from_attributes": True}


class ImageDetail(ImageRead):
    tag_details: list[TagWithConfidence] = Field(
        default_factory=list,
        description="Detailed tag payload including category metadata and confidence scores.",
    )


class ImageListState(str, Enum):
    ACTIVE = "active"
    TRASHED = "trashed"


class ImageUpdate(BaseModel):
    tags: list[str] | None = Field(
        default=None,
        description="Complete replacement tag list. Omit to keep tags unchanged.",
    )
    character_name: str | None = Field(
        default=None,
        description="Manual character name override. Send null or an empty string to clear it.",
    )
    deleted: bool | None = Field(
        default=None,
        description="Whether the image should be in the trash. Omit to keep deletion state unchanged.",
    )
    favorited: bool | None = Field(
        default=None,
        description="Whether the current user has favorited the image. Omit to keep favorite state unchanged.",
    )

    @model_validator(mode="after")
    def validate_non_empty(self):
        if not self.model_fields_set:
            raise ValueError("At least one mutable field must be provided")
        return self


class ImageListResponse(BaseModel):
    total: int = Field(description="Total number of images matching the current filters.")
    page: int = Field(description="Current page number.")
    page_size: int = Field(description="Number of items returned per page.")
    items: list[ImageRead] = Field(description="Images returned for the current page.")


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
    cover_image_id: uuid.UUID | None = None


class AlbumRead(BaseModel):
    id: uuid.UUID
    owner_id: uuid.UUID
    name: str
    description: str | None
    cover_image_id: uuid.UUID | None
    image_count: int = 0
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


class ImageBatchUpdate(BaseModel):
    image_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)
    deleted: bool | None = None
    favorited: bool | None = None

    @model_validator(mode="after")
    def validate_non_empty(self):
        if self.deleted is None and self.favorited is None:
            raise ValueError("At least one mutable field must be provided")
        return self


class ImageBatchDelete(BaseModel):
    image_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)


class AlbumImageBatchUpdate(BaseModel):
    image_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)


class BulkResult(BaseModel):
    processed: int
    skipped: int


class DownloadRequest(BaseModel):
    image_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)


class TaggingJobQueuedResponse(BaseModel):
    queued: int


class AdminUserUpdate(BaseModel):
    is_admin: bool | None = None
    show_nsfw: bool | None = None


class AdminUserDetail(UserRead):
    image_count: int
    storage_used_bytes: int


class AdminStatsResponse(BaseModel):
    total_users: int
    total_images: int
    total_storage_bytes: int
    pending_tagging: int
    failed_tagging: int
    trashed_images: int


class UserListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[UserRead]


class OnThisDayYear(BaseModel):
    year: int
    images: list[ImageRead]


class OnThisDayResponse(BaseModel):
    years: list[OnThisDayYear]


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
