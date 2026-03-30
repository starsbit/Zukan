import uuid
from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class NotificationType(str, Enum):
    batch_done = "batch_done"
    batch_failed = "batch_failed"
    app_update = "app_update"
    share_invite = "share_invite"


class AnnouncementSeverity(str, Enum):
    info = "info"
    warning = "warning"
    critical = "critical"


class NotificationRead(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    type: NotificationType
    title: str
    body: str
    is_read: bool
    link_url: str | None = None
    data: dict[str, Any] | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class NotificationListResponse(BaseModel):
    total: int = Field(description="Total number of notifications matching the current filters.")
    next_cursor: str | None = Field(
        default=None,
        description="Opaque cursor for fetching the next page. Keep filters and sort parameters unchanged between requests.",
    )
    has_more: bool = Field(description="Whether there are additional items after this page.")
    page_size: int = Field(description="Number of items returned per page.")
    items: list[NotificationRead] = Field(description="Notifications returned for the current page.")


class AppAnnouncementCreate(BaseModel):
    version: str | None = Field(default=None, max_length=64)
    title: str = Field(min_length=1, max_length=255)
    message: str = Field(min_length=1)
    severity: AnnouncementSeverity = AnnouncementSeverity.info
    starts_at: datetime | None = None
    ends_at: datetime | None = None


class AppAnnouncementRead(BaseModel):
    id: uuid.UUID
    version: str | None = None
    title: str
    message: str
    severity: AnnouncementSeverity
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}
