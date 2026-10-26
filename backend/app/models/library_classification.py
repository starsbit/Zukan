import enum
import uuid
from datetime import datetime
from sqlalchemy import DateTime, Enum, Float, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from backend.app.database import Base


class LibraryClassificationFeedbackAction(str, enum.Enum):
    accepted = "accepted"
    rejected = "rejected"
    auto_applied = "auto_applied"


class LibraryClassificationFeedback(Base):
    __tablename__ = "library_classification_feedback"
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    media_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    entity_type: Mapped[str] = mapped_column(String(32), nullable=False)
    suggested_entity_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("owned_entities.id", ondelete="SET NULL"),
        nullable=True,
    )
    suggested_name: Mapped[str] = mapped_column(String(512), nullable=False)
    series_name: Mapped[str | None] = mapped_column(String(512), nullable=True)
    model_version: Mapped[str] = mapped_column(String(64), nullable=False)
    action: Mapped[LibraryClassificationFeedbackAction] = mapped_column(
        Enum(LibraryClassificationFeedbackAction, name="library_feedback_action_enum"),
        nullable=False,
    )
    source: Mapped[str | None] = mapped_column(String(64), nullable=True)
    similarity: Mapped[float | None] = mapped_column(Float, nullable=True)
    explanation: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
