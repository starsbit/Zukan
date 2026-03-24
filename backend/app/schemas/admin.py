from pydantic import BaseModel, Field

from backend.app.schemas.auth import UserRead


class AdminUserUpdate(BaseModel):
    is_admin: bool | None = None
    show_nsfw: bool | None = None
    tag_confidence_threshold: float | None = Field(default=None, ge=0.0, le=1.0)


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