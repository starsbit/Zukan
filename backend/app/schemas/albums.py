import uuid
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class AlbumCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None


class AlbumUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    cover_media_id: uuid.UUID | None = None
    version: int | None = Field(default=None, description="Current version of the resource for optimistic locking.")


class AlbumRead(BaseModel):
    id: uuid.UUID
    owner_id: uuid.UUID
    name: str
    description: str | None
    cover_media_id: uuid.UUID | None
    media_count: int = 0
    version: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AlbumListResponse(BaseModel):
    total: int = Field(description="Total number of albums matching the current filters.")
    page: int = Field(description="Current page number.")
    page_size: int = Field(description="Number of albums returned per page.")
    items: list[AlbumRead]


class AlbumShareRole(str, Enum):
    viewer = "viewer"
    editor = "editor"
    owner = "owner"


class AlbumShareCreate(BaseModel):
    user_id: uuid.UUID
    role: AlbumShareRole = AlbumShareRole.viewer


class AlbumShareRead(BaseModel):
    user_id: uuid.UUID
    role: AlbumShareRole
    shared_at: datetime
    shared_by_user_id: uuid.UUID | None

    model_config = {"from_attributes": True}


class AlbumMediaBatchUpdate(BaseModel):
    media_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)