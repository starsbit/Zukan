import enum
import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Enum, Float, ForeignKey, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.app.database import Base


class RarityTier(str, enum.Enum):
    N = "N"
    R = "R"
    SR = "SR"
    SSR = "SSR"
    UR = "UR"


class GachaPullMode(str, enum.Enum):
    single = "single"
    ten_pull = "ten_pull"
    daily = "daily"


class GachaCurrencyLedgerReason(str, enum.Enum):
    daily_claim = "daily_claim"
    pull_spend = "pull_spend"
    admin_adjustment = "admin_adjustment"


class GachaCurrencyBalance(Base):
    __tablename__ = "gacha_currency_balances"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    balance: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    total_claimed: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    total_spent: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    last_daily_claimed_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class MediaGachaRarity(Base):
    __tablename__ = "media_gacha_rarity"
    __table_args__ = (
        Index("ix_media_gacha_rarity_tier_score", "rarity_tier", "rarity_score"),
    )

    media_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.id", ondelete="CASCADE"),
        primary_key=True,
    )
    rarity_score: Mapped[float] = mapped_column(Float, nullable=False, index=True)
    rarity_tier: Mapped[RarityTier] = mapped_column(Enum(RarityTier, name="gacha_rarity_tier_enum"), nullable=False, index=True)
    component_scores: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    score_version: Mapped[str] = mapped_column(String(32), nullable=False, default="v1", server_default="v1")
    previous_tier: Mapped[RarityTier | None] = mapped_column(Enum(RarityTier, name="gacha_rarity_tier_enum"), nullable=True)
    below_threshold_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    calculated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    media = relationship("Media")


class GachaPull(Base):
    __tablename__ = "gacha_pulls"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    mode: Mapped[GachaPullMode] = mapped_column(Enum(GachaPullMode, name="gacha_pull_mode_enum"), nullable=False)
    pool: Mapped[str | None] = mapped_column(String(64), nullable=True)
    currency_spent: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    items: Mapped[list["GachaPullItem"]] = relationship(
        "GachaPullItem",
        back_populates="pull",
        cascade="all, delete-orphan",
        order_by="GachaPullItem.position",
    )


class GachaPullItem(Base):
    __tablename__ = "gacha_pull_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pull_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("gacha_pulls.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    media_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    rarity_tier: Mapped[RarityTier] = mapped_column(Enum(RarityTier, name="gacha_rarity_tier_enum"), nullable=False)
    rarity_score: Mapped[float] = mapped_column(Float, nullable=False)
    was_duplicate: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    upgrade_material_granted: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    position: Mapped[int] = mapped_column(Integer, nullable=False)

    pull: Mapped[GachaPull] = relationship("GachaPull", back_populates="items")
    media = relationship("Media")


class GachaCurrencyLedger(Base):
    __tablename__ = "gacha_currency_ledger"
    __table_args__ = (
        Index("ix_gacha_currency_ledger_user_created", "user_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    balance_after: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[GachaCurrencyLedgerReason] = mapped_column(
        Enum(GachaCurrencyLedgerReason, name="gacha_currency_ledger_reason_enum"),
        nullable=False,
        index=True,
    )
    reference_pull_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("gacha_pulls.id", ondelete="SET NULL"),
        nullable=True,
    )
    ledger_metadata: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    reference_pull: Mapped[GachaPull | None] = relationship("GachaPull")
