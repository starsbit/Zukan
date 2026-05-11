import uuid

from pydantic import BaseModel, Field, model_validator

from backend.app.models.media import MediaVisibility


class MediaBatchUpdate(BaseModel):
    media_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)
    deleted: bool | None = None
    favorited: bool | None = None
    visibility: MediaVisibility | None = None
    metadata_review_dismissed: bool | None = None

    @model_validator(mode="after")
    def validate_non_empty(self):
        if self.deleted is None and self.favorited is None and self.visibility is None and self.metadata_review_dismissed is None:
            raise ValueError("At least one mutable field must be provided")
        return self


class BulkResult(BaseModel):
    processed: int
    skipped: int


class MediaIdsRequest(BaseModel):
    media_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)


class TaggingJobQueuedResponse(BaseModel):
    queued: int


class MediaEntityBatchUpdate(BaseModel):
    media_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)
    character_names: list[str] | None = None
    series_names: list[str] | None = None

    @model_validator(mode="after")
    def validate_non_empty(self):
        if self.character_names is None and self.series_names is None:
            raise ValueError("At least one entity field must be provided")
        return self


class MediaAnnotationBatchUpdate(BaseModel):
    media_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)
    add_tags: list[str] = Field(default_factory=list)
    remove_tags: list[str] = Field(default_factory=list)
    add_character_names: list[str] = Field(default_factory=list)
    remove_character_names: list[str] = Field(default_factory=list)
    add_series_names: list[str] = Field(default_factory=list)
    remove_series_names: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_non_empty(self):
        if not any(
            (
                self.add_tags,
                self.remove_tags,
                self.add_character_names,
                self.remove_character_names,
                self.add_series_names,
                self.remove_series_names,
            )
        ):
            raise ValueError("At least one annotation mutation must be provided")
        return self
