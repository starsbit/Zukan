import uuid

from pydantic import BaseModel, Field, model_validator


class MediaBatchUpdate(BaseModel):
    media_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)
    deleted: bool | None = None
    favorited: bool | None = None

    @model_validator(mode="after")
    def validate_non_empty(self):
        if self.deleted is None and self.favorited is None:
            raise ValueError("At least one mutable field must be provided")
        return self


class MediaBatchDelete(BaseModel):
    media_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)


class BulkResult(BaseModel):
    processed: int
    skipped: int


class DownloadRequest(BaseModel):
    media_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)


class TaggingJobQueuedResponse(BaseModel):
    queued: int