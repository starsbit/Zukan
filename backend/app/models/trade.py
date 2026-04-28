import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Index, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.app.database import Base


class TradeStatus(str, enum.Enum):
    pending = "pending"
    accepted = "accepted"
    rejected = "rejected"
    cancelled = "cancelled"
    expired = "expired"


class TradeSide(str, enum.Enum):
    sender = "sender"
    receiver = "receiver"


class TradeOffer(Base):
    __tablename__ = "trade_offers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    sender_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    receiver_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    status: Mapped[TradeStatus] = mapped_column(
        Enum(TradeStatus, name="trade_status_enum"),
        nullable=False,
        default=TradeStatus.pending,
        server_default="pending",
        index=True,
    )
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)

    items: Mapped[list["TradeOfferItem"]] = relationship(
        "TradeOfferItem",
        back_populates="trade_offer",
        cascade="all, delete-orphan",
    )


class TradeOfferItem(Base):
    __tablename__ = "trade_offer_items"
    __table_args__ = (
        UniqueConstraint("trade_offer_id", "collection_item_id", name="uq_trade_offer_items_trade_item"),
        Index("ix_trade_offer_items_side_trade", "side", "trade_offer_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trade_offer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("trade_offers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    side: Mapped[TradeSide] = mapped_column(Enum(TradeSide, name="trade_side_enum"), nullable=False)
    collection_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("user_collection_items.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    trade_offer: Mapped[TradeOffer] = relationship("TradeOffer", back_populates="items")
    collection_item = relationship("UserCollectionItem")
