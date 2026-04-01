import enum
import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, Enum, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.app.database import Base
from backend.app.models.auth import User
from backend.app.models.tags import MediaTag 
from backend.app.models.relations import MediaEntity, MediaExternalRef


class MediaType(str, enum.Enum):
    IMAGE = "image"
    GIF = "gif"
    VIDEO = "video"


class TaggingStatus(str, enum.Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    DONE = "done"
    FAILED = "failed"


class ProcessingStatus(str, enum.Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    DONE = "done"
    FAILED = "failed"
    NOT_APPLICABLE = "not_applicable"

class MediaVisibility(str, enum.Enum):
    private = "private"
    public = "public"


class Media(Base):
    __tablename__ = "media"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    uploader_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    filename: Mapped[str] = mapped_column(String(512), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(512), nullable=True)
    filepath: Mapped[str] = mapped_column(String(1024), nullable=False, unique=True)
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=True)
    sha256: Mapped[str] = mapped_column(String(64), nullable=True, unique=True, index=True)
    mime_type: Mapped[str] = mapped_column(String(64), nullable=True)
    media_type: Mapped[MediaType] = mapped_column(Enum(MediaType, name="media_type"), nullable=False, index=True)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    frame_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_nsfw: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    # Analysis / processing state
    tagging_status: Mapped[TaggingStatus] = mapped_column(
        Enum(TaggingStatus, name="tagging_status_enum"), nullable=False, default=TaggingStatus.PENDING, index=True
    )
    tagging_error: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    thumbnail_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    thumbnail_status: Mapped[ProcessingStatus] = mapped_column(
        Enum(ProcessingStatus, name="processing_status_enum"), nullable=False, default=ProcessingStatus.PENDING
    )
    poster_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    poster_status: Mapped[ProcessingStatus] = mapped_column(
        Enum(ProcessingStatus, name="processing_status_enum"), nullable=False, default=ProcessingStatus.PENDING
    )
    # User-curated annotations
    ocr_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    ocr_text_override: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Lifecycle
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    visibility: Mapped[MediaVisibility] = mapped_column(
        Enum(MediaVisibility, name="media_visibility_enum"),
        nullable=False,
        default=MediaVisibility.private,
        server_default="private",
        index=True,
    )
    ingested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    phash: Mapped[str | None] = mapped_column(String(16), nullable=True)
    tagging_model_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    tagging_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    tagging_finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    uploader: Mapped[User] = relationship(User, foreign_keys=[uploader_id], back_populates="media")
    owner: Mapped[User | None] = relationship(User, foreign_keys=[owner_id])
    media_tags: Mapped[list[MediaTag]] = relationship(
        MediaTag,
        back_populates="media",
        cascade="all, delete-orphan",
    )
    entities: Mapped[list[MediaEntity]] = relationship(
        MediaEntity,
        back_populates="media",
        cascade="all, delete-orphan",
    )
    external_refs: Mapped[list[MediaExternalRef]] = relationship(
        MediaExternalRef,
        back_populates="media",
        cascade="all, delete-orphan",
    )
