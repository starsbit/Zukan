import uuid
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class AlbumCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None

    model_config = {
        "json_schema_extra": {
            "example": {
                "name": "Fate/stay night",
                "description": "Images related to Fate/stay night.",
            }
        }
    }


class AlbumUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    cover_media_id: uuid.UUID | None = None
    version: int | None = Field(default=None, description="Current version of the resource for optimistic locking.")

    model_config = {
        "json_schema_extra": {
            "example": {
                "name": "Fate/stay night",
                "description": "Images related to Fate/stay night.",
                "version": 4,
            }
        }
    }


class AlbumRead(BaseModel):
    id: uuid.UUID
    owner_id: uuid.UUID
    name: str
    description: str | None = None
    cover_media_id: uuid.UUID | None = None
    media_count: int = 0
    version: int
    created_at: datetime
    updated_at: datetime

    model_config = {
        "from_attributes": True,
        "json_schema_extra": {
            "example": {
                "id": "05dc6c4d-a955-4f90-bf2d-7e6b5bc93574",
                "owner_id": "fe1db6af-8f07-4b07-85cd-5676d7f7aa19",
                "name": "Fate/stay night",
                "description": "Images related to Fate/stay night.",
                "cover_media_id": "0f729258-8c26-4d04-aa95-d33f0bcfb6b8",
                "media_count": 42,
                "version": 4,
                "created_at": "2026-03-20T07:05:11Z",
                "updated_at": "2026-03-24T15:44:03Z",
            }
        },
    }


class AlbumListResponse(BaseModel):
    total: int = Field(description="Total number of albums matching the current filters.")
    next_cursor: str | None = Field(default=None, description="Opaque cursor for fetching the next page. Null if no more items.")
    prev_cursor: str | None = Field(default=None, description="Optional cursor for fetching the previous page.")
    has_more: bool = Field(description="Whether there are additional items after this page.")
    page_size: int = Field(description="Number of albums returned per page.")
    items: list[AlbumRead]


class AlbumShareRole(str, Enum):
    viewer = "viewer"
    editor = "editor"


class AlbumShareReadRole(str, Enum):
    viewer = "viewer"
    editor = "editor"
    owner = "owner"


class AlbumShareCreate(BaseModel):
    user_id: uuid.UUID
    role: AlbumShareRole = AlbumShareRole.viewer

    model_config = {
        "json_schema_extra": {
            "example": {
                "user_id": "f8c6e80d-d2f7-4db8-9ee1-5d0a44e0f6e7",
                "role": "editor",
            }
        }
    }


class AlbumShareRead(BaseModel):
    user_id: uuid.UUID
    role: AlbumShareReadRole
    shared_at: datetime
    shared_by_user_id: uuid.UUID | None = None

    model_config = {
        "from_attributes": True,
        "json_schema_extra": {
            "example": {
                "user_id": "f8c6e80d-d2f7-4db8-9ee1-5d0a44e0f6e7",
                "role": "editor",
                "shared_at": "2026-03-24T15:55:09Z",
                "shared_by_user_id": "fe1db6af-8f07-4b07-85cd-5676d7f7aa19",
            }
        },
    }


class AlbumOwnershipTransferRequest(BaseModel):
    new_owner_user_id: uuid.UUID
    keep_editor_access: bool = False

    model_config = {
        "json_schema_extra": {
            "example": {
                "new_owner_user_id": "f8c6e80d-d2f7-4db8-9ee1-5d0a44e0f6e7",
                "keep_editor_access": True,
            }
        }
    }