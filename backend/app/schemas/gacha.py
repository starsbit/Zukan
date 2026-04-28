import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field

from backend.app.models.gacha import GachaPullMode, RarityTier


class GachaPullRequest(BaseModel):
    mode: GachaPullMode = Field(default=GachaPullMode.single)
    pool: str | None = Field(default=None, max_length=64)


class GachaPullItemRead(BaseModel):
    id: uuid.UUID
    media_id: uuid.UUID
    rarity_tier: RarityTier
    rarity_score: float
    was_duplicate: bool
    upgrade_material_granted: int
    position: int
    collection_item_id: uuid.UUID | None = None


class GachaPullRead(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    mode: GachaPullMode
    pool: str | None = None
    currency_spent: int = 0
    currency_balance: int | None = None
    created_at: datetime
    items: list[GachaPullItemRead]


class RaritySnapshotRead(BaseModel):
    media_id: uuid.UUID
    rarity_score: float
    rarity_tier: RarityTier
    component_scores: dict
    score_version: str
    previous_tier: RarityTier | None = None
    below_threshold_count: int
    calculated_at: datetime

    model_config = {"from_attributes": True}


class GachaStatsResponse(BaseModel):
    total_rarity_snapshots: int
    tier_counts: dict[RarityTier, int]
    collection_count: int
    duplicate_copies: int
    currency_balance: int
    daily_claim_available: bool
    next_daily_claim_at: datetime | None = None


class RarityRecalculationResponse(BaseModel):
    recalculated: int
    score_version: str
    tier_counts: dict[RarityTier, int]


class GachaCurrencyBalanceRead(BaseModel):
    user_id: uuid.UUID
    balance: int
    total_claimed: int
    total_spent: int
    last_daily_claimed_on: date | None = None
    daily_claim_amount: int
    daily_claim_available: bool
    next_daily_claim_at: datetime | None = None


class GachaDailyClaimResponse(BaseModel):
    claimed: int
    balance: int
    daily_claim_available: bool
    next_daily_claim_at: datetime
