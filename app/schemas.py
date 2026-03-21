import uuid
from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

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
    name: str
    category: int
    category_name: str
    image_count: int

    model_config = {"from_attributes": True}


class TagWithConfidence(BaseModel):
    name: str
    category: int
    category_name: str
    confidence: float


class ImageRead(BaseModel):
    id: uuid.UUID
    uploader_id: uuid.UUID | None
    filename: str
    original_filename: str | None
    file_size: int | None
    width: int | None
    height: int | None
    mime_type: str | None
    tags: list[str]
    is_nsfw: bool
    tagging_status: str
    thumbnail_status: str
    created_at: datetime
    deleted_at: datetime | None
    is_favorited: bool = False

    model_config = {"from_attributes": True}


class ImageDetail(ImageRead):
    tag_details: list[TagWithConfidence] = []


class ImageListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[ImageRead]


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


class AddImagesToAlbum(BaseModel):
    image_ids: list[uuid.UUID] = Field(min_length=1)


class BulkImageRequest(BaseModel):
    image_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)


class BulkAlbumRequest(BaseModel):
    album_id: uuid.UUID
    image_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)


class BulkResult(BaseModel):
    processed: int
    skipped: int


class DownloadRequest(BaseModel):
    image_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)


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
