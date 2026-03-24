import uuid

from pydantic import BaseModel, Field

from backend.app.models.relations import MediaEntityType


class EntityRead(BaseModel):
    id: uuid.UUID
    entity_type: MediaEntityType = Field(description="Entity type.")
    entity_id: uuid.UUID | None = Field(default=None, description="Optional pointer to a canonical entity.")
    name: str = Field(description="Display name of the entity.")
    role: str = Field(description="Role of the entity in the media (e.g. 'primary').")
    source: str = Field(description="Source of the entity annotation (e.g. 'tagger', 'manual').")
    confidence: float | None = Field(default=None, description="Confidence score if derived from a model.")

    model_config = {"from_attributes": True}


class EntityCreate(BaseModel):
    entity_type: MediaEntityType = Field(description="Entity type.")
    entity_id: uuid.UUID | None = Field(default=None, description="Optional pointer to a canonical entity.")
    name: str = Field(min_length=1, max_length=512, description="Display name of the entity.")
    role: str = Field(default="primary", min_length=1, max_length=64, description="Role of the entity.")
    confidence: float | None = Field(default=None, ge=0.0, le=1.0, description="Optional confidence score.")


class ExternalRefRead(BaseModel):
    id: uuid.UUID
    provider: str = Field(description="External provider identifier (e.g. 'pixiv', 'danbooru', 'anilist').")
    external_id: str | None = Field(default=None, description="Provider-specific entity ID.")
    url: str | None = Field(default=None, description="Direct URL to the external resource.")

    model_config = {"from_attributes": True}


class ExternalRefCreate(BaseModel):
    provider: str = Field(min_length=1, max_length=64, description="External provider identifier.")
    external_id: str | None = Field(default=None, max_length=256, description="Provider-specific entity ID.")
    url: str | None = Field(default=None, max_length=2048, description="Direct URL to the external resource.")