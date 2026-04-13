import uuid
from enum import Enum

from pydantic import BaseModel, Field

CATEGORY_NAMES = {0: "general", 1: "artist", 3: "copyright", 4: "character", 5: "meta", 9: "rating"}


class TagRead(BaseModel):
    id: int
    name: str = Field(description="Canonical tag name.")
    category: int = Field(description="Numeric tag category from the tagging backend.")
    category_name: str = Field(description="Human-readable tag category name.")
    category_key: str = Field(description="Stable string key for the tag category.")
    media_count: int = Field(description="Number of media items currently associated with this tag.")

    model_config = {"from_attributes": True}


class CharacterSuggestion(BaseModel):
    name: str = Field(description="Character entity name suggestion.")
    media_count: int = Field(description="Number of visible media items using this character name.")


class SeriesSuggestion(BaseModel):
    name: str = Field(description="Series entity name suggestion.")
    media_count: int = Field(description="Number of visible media items using this series name.")


class MetadataNameRead(BaseModel):
    id: uuid.UUID | None = Field(default=None, description="Owner-scoped canonical metadata id when available.")
    name: str = Field(description="Exact persisted metadata name.")
    media_count: int = Field(description="Number of media items currently associated with this name.")


class TagWithConfidence(BaseModel):
    name: str = Field(description="Canonical tag name.")
    category: int = Field(description="Numeric tag category from the tagging backend.")
    category_name: str = Field(description="Human-readable tag category name.")
    category_key: str = Field(description="Stable string key for the tag category.")
    confidence: float = Field(description="Model confidence score for this tag.")


class TagFilterMode(str, Enum):
    AND = "and"
    OR = "or"


class NsfwFilter(str, Enum):
    DEFAULT = "default"
    ONLY = "only"
    INCLUDE = "include"


class SensitiveFilter(str, Enum):
    DEFAULT = "default"
    ONLY = "only"
    INCLUDE = "include"


class TagListResponse(BaseModel):
    total: int = Field(description="Total number of tags matching the current filters.")
    next_cursor: str | None = Field(
        default=None,
        description="Opaque cursor for fetching the next page. Keep filters and sort parameters unchanged between requests.",
    )
    has_more: bool = Field(description="Whether there are additional items after this page.")
    page_size: int = Field(description="Number of items returned per page.")
    items: list[TagRead] = Field(description="Tags returned for the current page.")


class MetadataNameListResponse(BaseModel):
    total: int = Field(description="Total number of metadata names matching the current filters.")
    next_cursor: str | None = Field(
        default=None,
        description="Opaque cursor for fetching the next page. Keep filters and sort parameters unchanged between requests.",
    )
    has_more: bool = Field(description="Whether there are additional items after this page.")
    page_size: int = Field(description="Number of items returned per page.")
    items: list[MetadataNameRead] = Field(description="Metadata names returned for the current page.")


class TagManagementResult(BaseModel):
    matched_media: int = Field(description="Number of accessible media items matching the exact tag or character name.")
    updated_media: int = Field(default=0, description="Number of matching media items updated in-place.")
    trashed_media: int = Field(default=0, description="Number of active matching media items moved to trash.")
    already_trashed: int = Field(default=0, description="Number of matching media items that were already in trash.")
    deleted_tag: bool = Field(default=False, description="Whether the canonical tag row was deleted after cleanup.")
    deleted_source: bool = Field(default=False, description="Whether the source tag or name disappeared completely after cleanup.")


class TagMergeRequest(BaseModel):
    target_tag_id: int = Field(ge=1, description="Canonical target tag id to merge into.")


class NameMergeRequest(BaseModel):
    target_name: str = Field(min_length=1, max_length=512, description="Exact target name to merge into.")


class MetadataListScope(str, Enum):
    ACCESSIBLE = "accessible"
    OWNER = "owner"
