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
