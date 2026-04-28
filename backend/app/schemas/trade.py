import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from backend.app.models.trade import TradeSide, TradeStatus
from backend.app.schemas.collection import CollectionItemRead


class TradeCreateRequest(BaseModel):
    receiver_user_id: uuid.UUID
    offered_item_ids: list[uuid.UUID] = Field(min_length=1)
    requested_item_ids: list[uuid.UUID] = Field(min_length=1)
    message: str | None = Field(default=None, max_length=2000)


class TradeOfferItemRead(BaseModel):
    id: uuid.UUID
    trade_offer_id: uuid.UUID
    side: TradeSide
    collection_item_id: uuid.UUID
    collection_item: CollectionItemRead | None = None

    model_config = {"from_attributes": True}


class TradeOfferRead(BaseModel):
    id: uuid.UUID
    sender_user_id: uuid.UUID
    receiver_user_id: uuid.UUID
    status: TradeStatus
    message: str | None = None
    created_at: datetime
    updated_at: datetime
    expires_at: datetime | None = None
    items: list[TradeOfferItemRead] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class TradeListResponse(BaseModel):
    total: int
    items: list[TradeOfferRead]
