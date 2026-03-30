import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.database import Base


class AlbumShareRole(str, enum.Enum):
    viewer = "viewer"
    editor = "editor"
    owner = "owner"


class AlbumShareInviteStatus(str, enum.Enum):
    pending = "pending"
    accepted = "accepted"
    rejected = "rejected"


class Album(Base):
    __tablename__ = "albums"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    cover_media_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.id", ondelete="SET NULL"),
        nullable=True,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class AlbumMedia(Base):
    __tablename__ = "album_media"

    album_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("albums.id", ondelete="CASCADE"),
        primary_key=True,
    )
    media_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("media.id", ondelete="CASCADE"),
        primary_key=True,
    )
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class AlbumShare(Base):
    __tablename__ = "album_shares"

    album_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("albums.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    role: Mapped[AlbumShareRole] = mapped_column(
        Enum(AlbumShareRole, name="album_share_role_enum"), nullable=False, default=AlbumShareRole.viewer, server_default="viewer"
    )
    shared_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    shared_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )


class AlbumShareInvite(Base):
    __tablename__ = "album_share_invites"
    __table_args__ = (
        UniqueConstraint("album_id", "user_id", name="uq_album_share_invites_album_user"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    album_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("albums.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role: Mapped[AlbumShareRole] = mapped_column(
        Enum(AlbumShareRole, name="album_share_role_enum"),
        nullable=False,
        default=AlbumShareRole.viewer,
        server_default="viewer",
    )
    status: Mapped[AlbumShareInviteStatus] = mapped_column(
        Enum(AlbumShareInviteStatus, name="album_share_invite_status_enum"),
        nullable=False,
        default=AlbumShareInviteStatus.pending,
        server_default="pending",
    )
    invited_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    invited_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    notification_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("notifications.id", ondelete="SET NULL"),
        nullable=True,
        unique=True,
    )
