import uuid
from typing import Literal

from pydantic import BaseModel


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


class UploadConfigResponse(BaseModel):
    max_batch_size: int
    max_upload_size_mb: int