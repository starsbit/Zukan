import uuid
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class NotificationTypeEnum(str, Enum):
    batch_done = "batch_done"
    batch_failed = "batch_failed"
    app_update = "app_update"
    share_invite = "share_invite"


class AnnouncementSeverityEnum(str, Enum):
    info = "info"
    warning = "warning"
    critical = "critical"


class NotificationRead(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    type: NotificationTypeEnum
    title: str
    body: str
    is_read: bool
    link_url: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class NotificationListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[NotificationRead]


class AppAnnouncementCreate(BaseModel):
    version: str | None = Field(default=None, max_length=64)
    title: str = Field(min_length=1, max_length=255)
    message: str = Field(min_length=1)
    severity: AnnouncementSeverityEnum = AnnouncementSeverityEnum.info
    starts_at: datetime | None = None
    ends_at: datetime | None = None


class AppAnnouncementRead(BaseModel):
    id: uuid.UUID
    version: str | None
    title: str
    message: str
    severity: AnnouncementSeverityEnum
    starts_at: datetime | None
    ends_at: datetime | None
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}