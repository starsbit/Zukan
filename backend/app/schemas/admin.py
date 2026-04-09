from datetime import datetime

from pydantic import BaseModel, Field

from backend.app.schemas.auth import UserRead


class AdminUserUpdate(BaseModel):
    username: str | None = Field(default=None, min_length=3, max_length=64)
    is_admin: bool | None = None
    show_nsfw: bool | None = None
    show_sensitive: bool | None = None
    tag_confidence_threshold: float | None = Field(default=None, ge=0.0, le=1.0)
    password: str | None = Field(default=None, min_length=8)
    storage_quota_mb: int | None = Field(default=None, ge=0)


class AdminUserSummary(UserRead):
    media_count: int


class AdminUserDetail(AdminUserSummary):
    pass


class AdminUserListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[AdminUserSummary]


class AdminStorageUserSummary(BaseModel):
    user_id: str
    username: str
    media_count: int
    storage_used_bytes: int


class AdminStatsResponse(BaseModel):
    total_users: int
    total_media: int
    total_storage_bytes: int
    pending_tagging: int
    failed_tagging: int
    trashed_media: int
    storage_by_user: list[AdminStorageUserSummary]


class AdminHealthSample(BaseModel):
    captured_at: datetime
    cpu_percent: float = Field(ge=0.0)
    memory_rss_bytes: int = Field(ge=0)


class AdminHealthResponse(BaseModel):
    generated_at: datetime
    uptime_seconds: float = Field(ge=0.0)
    cpu_percent: float = Field(ge=0.0)
    memory_rss_bytes: int = Field(ge=0)
    system_memory_total_bytes: int | None = Field(default=None, ge=0)
    system_memory_used_bytes: int | None = Field(default=None, ge=0)
    tagging_queue_depth: int = Field(ge=0)
    samples: list[AdminHealthSample]


class AdminAppConfigRead(BaseModel):
    auth_login_rate_limit_requests: int = Field(ge=0)
    auth_login_rate_limit_window_seconds: int = Field(ge=0)
    auth_refresh_rate_limit_requests: int = Field(ge=0)
    auth_refresh_rate_limit_window_seconds: int = Field(ge=0)
    auth_register_rate_limit_requests: int = Field(ge=0)
    auth_register_rate_limit_window_seconds: int = Field(ge=0)
    upload_rate_limit_requests: int = Field(ge=0)
    upload_rate_limit_window_seconds: int = Field(ge=0)
    anilist_enabled: bool
    anilist_client_id: str
    anilist_client_secret: str
    anilist_oauth_redirect_uri: str
    access_token_expire_minutes: int = Field(ge=1)
    refresh_token_expire_days: int = Field(ge=1)
    remember_me_refresh_token_expire_days: int = Field(ge=1)
    tagger_threshold_general: float = Field(ge=0.0, le=1.0)
    tagger_threshold_character: float = Field(ge=0.0, le=1.0)
    ocr_enabled: bool
    ocr_languages: str
    ocr_max_chars: int = Field(ge=0)
    thumbnail_size: int = Field(ge=64)
    trash_purge_interval_seconds: int = Field(ge=60)


class AdminAppConfigUpdate(BaseModel):
    auth_login_rate_limit_requests: int | None = Field(default=None, ge=0)
    auth_login_rate_limit_window_seconds: int | None = Field(default=None, ge=0)
    auth_refresh_rate_limit_requests: int | None = Field(default=None, ge=0)
    auth_refresh_rate_limit_window_seconds: int | None = Field(default=None, ge=0)
    auth_register_rate_limit_requests: int | None = Field(default=None, ge=0)
    auth_register_rate_limit_window_seconds: int | None = Field(default=None, ge=0)
    upload_rate_limit_requests: int | None = Field(default=None, ge=0)
    upload_rate_limit_window_seconds: int | None = Field(default=None, ge=0)
    anilist_enabled: bool | None = None
    anilist_client_id: str | None = None
    anilist_client_secret: str | None = None
    anilist_oauth_redirect_uri: str | None = None
    access_token_expire_minutes: int | None = Field(default=None, ge=1)
    refresh_token_expire_days: int | None = Field(default=None, ge=1)
    remember_me_refresh_token_expire_days: int | None = Field(default=None, ge=1)
    tagger_threshold_general: float | None = Field(default=None, ge=0.0, le=1.0)
    tagger_threshold_character: float | None = Field(default=None, ge=0.0, le=1.0)
    ocr_enabled: bool | None = None
    ocr_languages: str | None = None
    ocr_max_chars: int | None = Field(default=None, ge=0)
    thumbnail_size: int | None = Field(default=None, ge=64)
    trash_purge_interval_seconds: int | None = Field(default=None, ge=60)


class AdminServiceNotificationCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    body: str = Field(min_length=1, max_length=2048)
    link_url: str | None = Field(default=None, max_length=2048)
    data: dict | None = None


class AdminServiceNotificationResult(BaseModel):
    notified: int = Field(ge=0)
