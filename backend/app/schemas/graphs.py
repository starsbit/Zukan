import uuid
from typing import Literal

from pydantic import BaseModel, Field


GraphSeriesMode = Literal["any", "same", "different"]


class CharacterGraphSearchResult(BaseModel):
    id: uuid.UUID
    name: str
    media_count: int = Field(ge=0)


class CharacterGraphNode(BaseModel):
    id: uuid.UUID
    name: str
    media_count: int = Field(ge=0)
    embedding_support: int = Field(ge=0)
    series_names: list[str] = Field(default_factory=list)
    representative_media_ids: list[uuid.UUID] = Field(default_factory=list)


class CharacterGraphEdge(BaseModel):
    id: str
    source: uuid.UUID
    target: uuid.UUID
    similarity: float = Field(ge=0.0, le=1.0)
    shared_series: list[str] = Field(default_factory=list)


class CharacterGraphResponse(BaseModel):
    model_version: str
    total_characters_considered: int = Field(ge=0)
    center_entity_id: uuid.UUID | None = None
    nodes: list[CharacterGraphNode] = Field(default_factory=list)
    edges: list[CharacterGraphEdge] = Field(default_factory=list)
