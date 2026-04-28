import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from backend.app.models.collection import CollectionVisibility
from backend.app.models.gacha import RarityTier


class CollectionMediaRead(BaseModel):
    id: uuid.UUID
    filename: str
    is_nsfw: bool
    is_sensitive: bool

    model_config = {"from_attributes": True}


class CollectionItemRead(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    media_id: uuid.UUID
    rarity_tier_at_acquisition: RarityTier
    level: int
    upgrade_xp: int
    copies_pulled: int
    locked: bool
    tradeable: bool
    acquired_at: datetime
    updated_at: datetime
    media: CollectionMediaRead | None = None

    model_config = {"from_attributes": True}


class CollectionItemUpdate(BaseModel):
    locked: bool | None = None
    tradeable: bool | None = None


class CollectionListResponse(BaseModel):
    total: int
    items: list[CollectionItemRead]


class CollectionStatsResponse(BaseModel):
    total_items: int
    total_copies_pulled: int
    duplicate_copies: int
    max_level_items: int
    tier_counts: dict[RarityTier, int]


class CollectionPrivacyRead(BaseModel):
    user_id: uuid.UUID
    visibility: CollectionVisibility
    allow_trade_requests: bool
    show_stats: bool
    show_nsfw: bool

    model_config = {"from_attributes": True}


class CollectionPrivacyUpdate(BaseModel):
    visibility: CollectionVisibility | None = None
    allow_trade_requests: bool | None = None
    show_stats: bool | None = None
    show_nsfw: bool | None = None


class CollectionFilters(BaseModel):
    rarity_tier: RarityTier | None = None
    character_name: str | None = Field(default=None, max_length=512)
    series_name: str | None = Field(default=None, max_length=512)
    level: int | None = Field(default=None, ge=1, le=5)
    tradeable: bool | None = None
    duplicates_only: bool = False
