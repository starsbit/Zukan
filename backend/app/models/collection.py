import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Index, Integer, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.app.database import Base
from backend.app.models.gacha import RarityTier


class CollectionVisibility(str, enum.Enum):
    private = "private"
    followers = "followers"
    public = "public"


class UserCollectionItem(Base):
    __tablename__ = "user_collection_items"
    __table_args__ = (
        UniqueConstraint("user_id", "media_id", name="uq_user_collection_items_user_media"),
        Index("ix_user_collection_items_user_rarity", "user_id", "rarity_tier_at_acquisition"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    media_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    rarity_tier_at_acquisition: Mapped[RarityTier] = mapped_column(
        Enum(RarityTier, name="gacha_rarity_tier_enum"),
        nullable=False,
        index=True,
    )
    level: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    upgrade_xp: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    copies_pulled: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    locked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    tradeable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    acquired_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    media = relationship("Media")


class UserCollectionPrivacy(Base):
    __tablename__ = "user_collection_privacy"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    visibility: Mapped[CollectionVisibility] = mapped_column(
        Enum(CollectionVisibility, name="collection_visibility_enum"),
        nullable=False,
        default=CollectionVisibility.private,
        server_default="private",
    )
    allow_trade_requests: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    show_stats: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    show_nsfw: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
