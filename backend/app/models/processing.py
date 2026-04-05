import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.app.database import Base


class BatchType(str, enum.Enum):
    upload = "upload"
    retag = "retag"
    rethumbnail = "rethumbnail"
    rescan = "rescan"


class BatchStatus(str, enum.Enum):
    pending = "pending"
    running = "running"
    partial_failed = "partial_failed"
    done = "done"
    failed = "failed"
    cancelled = "cancelled"


class ItemStatus(str, enum.Enum):
    pending = "pending"
    processing = "processing"
    done = "done"
    failed = "failed"
    skipped = "skipped"


class ProcessingStep(str, enum.Enum):
    ingest = "ingest"
    thumbnail = "thumbnail"
    poster = "poster"
    tag = "tag"
    ocr = "ocr"


class ImportBatch(Base):
    __tablename__ = "import_batches"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    type: Mapped[BatchType] = mapped_column(Enum(BatchType, name="batch_type_enum"), nullable=False)
    status: Mapped[BatchStatus] = mapped_column(
        Enum(BatchStatus, name="batch_status_enum"), nullable=False, default=BatchStatus.pending, server_default="pending"
    )
    total_items: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    queued_items: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    processing_items: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    done_items: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    failed_items: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    app_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    worker_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_summary: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    recommendation_groups: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    recommendations_computed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    items: Mapped[list["ImportBatchItem"]] = relationship(
        "ImportBatchItem",
        back_populates="batch",
        cascade="all, delete-orphan",
    )


class ImportBatchItem(Base):
    __tablename__ = "import_batch_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    batch_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("import_batches.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    media_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    source_filename: Mapped[str] = mapped_column(String(512), nullable=False)
    status: Mapped[ItemStatus] = mapped_column(
        Enum(ItemStatus, name="item_status_enum"), nullable=False, default=ItemStatus.pending, server_default="pending"
    )
    step: Mapped[ProcessingStep | None] = mapped_column(Enum(ProcessingStep, name="processing_step_enum"), nullable=True)
    progress_percent: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    batch: Mapped["ImportBatch"] = relationship("ImportBatch", back_populates="items")
    media = relationship("Media", foreign_keys=[media_id])
