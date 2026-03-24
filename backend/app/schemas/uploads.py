import uuid
from datetime import datetime
from typing import Literal

from fastapi import File, Form, UploadFile
from pydantic import BaseModel


class UploadResult(BaseModel):
    id: uuid.UUID | None = None
    batch_item_id: uuid.UUID | None = None
    original_filename: str
    status: Literal["accepted", "duplicate", "error"]
    message: str | None = None


class BatchUploadResponse(BaseModel):
    batch_id: uuid.UUID
    batch_url: str
    batch_items_url: str
    poll_after_seconds: int = 2
    webhooks_supported: bool = False
    accepted: int
    duplicates: int
    errors: int
    results: list[UploadResult]


class UploadConfigResponse(BaseModel):
    max_batch_size: int
    max_upload_size_mb: int


class MediaUploadRequest(BaseModel):
    files: list[UploadFile]
    album_id: uuid.UUID | None = None
    tags: list[str] | None = None
    captured_at: datetime | None = None

    model_config = {
        "title": "MediaUploadRequest",
        "arbitrary_types_allowed": True,
    }

    @classmethod
    def as_form(
        cls,
        files: list[UploadFile] = File(...),
        album_id: uuid.UUID | None = Form(default=None),
        tags: list[str] | None = Form(default=None),
        captured_at: datetime | None = Form(default=None),
    ) -> "MediaUploadRequest":
        return cls(files=files, album_id=album_id, tags=tags, captured_at=captured_at)