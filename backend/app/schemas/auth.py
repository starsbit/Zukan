import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from backend.app.models.media import MediaVisibility


class UserRegister(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    email: EmailStr
    password: str = Field(min_length=8)

    model_config = {
        "json_schema_extra": {
            "example": {
                "username": "saber",
                "email": "saber@starsbit.space",
                "password": "super-secret-passphrase",
            }
        }
    }


class UserLogin(BaseModel):
    username: str
    password: str
    remember_me: bool = False


class UserSelfReadLite(BaseModel):
    id: uuid.UUID
    username: str
    email: str
    show_nsfw: bool
    anilist_import_visibility: MediaVisibility = Field(default=MediaVisibility.private)
    tag_confidence_threshold: float = Field(ge=0.0, le=1.0)
    version: int
    created_at: datetime

    model_config = {
        "from_attributes": True,
        "json_schema_extra": {
            "example": {
                "id": "fe1db6af-8f07-4b07-85cd-5676d7f7aa19",
                "username": "saber",
                "email": "saber@starsbit.space",
                "show_nsfw": False,
                "tag_confidence_threshold": 0.85,
                "version": 1,
                "created_at": "2026-03-24T12:34:56Z",
            }
        },
    }


class UserRead(BaseModel):
    id: uuid.UUID
    username: str
    email: str
    is_admin: bool
    show_nsfw: bool
    anilist_import_visibility: MediaVisibility = Field(default=MediaVisibility.private)
    tag_confidence_threshold: float = Field(ge=0.0, le=1.0)
    version: int
    created_at: datetime

    model_config = {
        "from_attributes": True,
        "json_schema_extra": {
            "example": {
                "id": "fe1db6af-8f07-4b07-85cd-5676d7f7aa19",
                "username": "saber",
                "email": "saber@starsbit.space",
                "is_admin": False,
                "show_nsfw": False,
                "tag_confidence_threshold": 0.85,
                "version": 3,
                "created_at": "2026-03-24T12:34:56Z",
            }
        },
    }


class UserUpdate(BaseModel):
    show_nsfw: bool | None = None
    anilist_import_visibility: MediaVisibility | None = None
    tag_confidence_threshold: float | None = Field(default=None, ge=0.0, le=1.0)
    password: str | None = Field(default=None, min_length=8)
    version: int | None = Field(default=None, description="Current version of the resource for optimistic locking.")

    model_config = {
        "json_schema_extra": {
            "example": {
                "show_nsfw": True,
                "tag_confidence_threshold": 0.7,
                "version": 3,
            }
        }
    }


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"

    model_config = {
        "json_schema_extra": {
            "example": {
                "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
                "refresh_token": "VwqXgY1VxM0h7SmpQn8r9A...",
                "token_type": "bearer",
            }
        }
    }


class RefreshTokenRequest(BaseModel):
    refresh_token: str

    model_config = {
        "json_schema_extra": {
            "example": {"refresh_token": "VwqXgY1VxM0h7SmpQn8r9A..."}
        }
    }


class APIKeyStatusResponse(BaseModel):
    has_key: bool
    created_at: datetime | None = None
    last_used_at: datetime | None = None

    model_config = {
        "json_schema_extra": {
            "example": {
                "has_key": True,
                "created_at": "2026-04-02T09:15:00Z",
                "last_used_at": "2026-04-02T10:30:00Z",
            }
        }
    }


class APIKeyCreateResponse(APIKeyStatusResponse):
    api_key: str

    model_config = {
        "json_schema_extra": {
            "example": {
                "api_key": "zk_9b4f816ab314f29d8d777d2e92e6910d7d4199be6adfcf7c6fb0a3bbf5f64ca1",
                "has_key": True,
                "created_at": "2026-04-02T09:15:00Z",
                "last_used_at": None,
            }
        }
    }


class UserListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[UserRead]
