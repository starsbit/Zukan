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


class AlbumAccessRole(str, Enum):
    viewer = "viewer"
    editor = "editor"
    owner = "owner"


class AlbumOwnerSummary(BaseModel):
    id: uuid.UUID
    username: str


class AlbumPreviewMedia(BaseModel):
    id: uuid.UUID


class AlbumRead(BaseModel):
    id: uuid.UUID
    owner_id: uuid.UUID
    owner: AlbumOwnerSummary
    access_role: AlbumAccessRole
    name: str
    description: str | None = None
    cover_media_id: uuid.UUID | None = None
    preview_media: list[AlbumPreviewMedia] = Field(default_factory=list)
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
                "owner": {
                    "id": "fe1db6af-8f07-4b07-85cd-5676d7f7aa19",
                    "username": "Saber",
                },
                "access_role": "owner",
                "name": "Fate/stay night",
                "description": "Images related to Fate/stay night.",
                "cover_media_id": "0f729258-8c26-4d04-aa95-d33f0bcfb6b8",
                "preview_media": [
                    {"id": "0f729258-8c26-4d04-aa95-d33f0bcfb6b8"},
                    {"id": "3387d261-c924-49d5-a6ca-b682482880d8"},
                ],
                "media_count": 42,
                "version": 4,
                "created_at": "2026-03-20T07:05:11Z",
                "updated_at": "2026-03-24T15:44:03Z",
            }
        },
    }


class AlbumListResponse(BaseModel):
    total: int = Field(description="Total number of albums matching the current filters.")
    next_cursor: str | None = Field(
        default=None,
        description="Opaque cursor for fetching the next page. Keep filters and sort parameters unchanged between requests.",
    )
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


class AlbumShareReadStatus(str, Enum):
    pending = "pending"
    accepted = "accepted"


class AlbumShareCreate(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    role: AlbumShareRole = AlbumShareRole.viewer

    model_config = {
        "json_schema_extra": {
            "example": {
                "username": "Saber",
                "role": "editor",
            }
        }
    }


class AlbumShareRead(BaseModel):
    user_id: uuid.UUID
    role: AlbumShareReadRole
    status: AlbumShareReadStatus = AlbumShareReadStatus.accepted
    shared_at: datetime
    shared_by_user_id: uuid.UUID | None = None

    model_config = {
        "from_attributes": True,
        "json_schema_extra": {
            "example": {
                "user_id": "f8c6e80d-d2f7-4db8-9ee1-5d0a44e0f6e7",
                "role": "editor",
                "status": "accepted",
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
