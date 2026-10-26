import enum
import uuid
from datetime import datetime
from sqlalchemy import (
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from backend.migrations.legacy_models import Base


class MediaTagSource(str, enum.Enum):
    auto = "auto"
    manual = "manual"
    imported = "imported"


class Tag(Base):
    __tablename__ = "tags"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "name", name="uq_tags_owner_user_id_name"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    category: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    media_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class MediaTag(Base):
    __tablename__ = "media_tags"
    media_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("media.id", ondelete="CASCADE"), primary_key=True
    )
    tag_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    source: Mapped[MediaTagSource] = mapped_column(
        Enum(MediaTagSource, name="media_tag_source_enum"),
        nullable=False,
        default=MediaTagSource.auto,
        server_default="auto",
    )
    model_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
