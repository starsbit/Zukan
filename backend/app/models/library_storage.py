from datetime import datetime
from sqlalchemy import Boolean, false, Integer, String, Text, DateTime, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from backend.app.database import Base


class LibraryStorage(Base):
    __tablename__ = 'library_storage'
    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    folder_configured: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=false())
    root: Mapped[str] = mapped_column(String(1024), nullable=False)
    generated_dir: Mapped[str] = mapped_column(String(512), nullable=False, default='.zukan')
    discovery_owner_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    scan_interval_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=3600)
    root_identity: Mapped[str | None] = mapped_column(String(36), nullable=True)
    last_scan: Mapped[dict | None] = mapped_column(JSONB, nullable=True)


class StorageMigration(Base):
    __tablename__ = 'storage_migrations'
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    source_root: Mapped[str] = mapped_column(String(1024), nullable=False)
    source_identity: Mapped[str] = mapped_column(String(36), nullable=False)
    destination_root: Mapped[str] = mapped_column(String(1024), nullable=False)
    destination_identity: Mapped[str] = mapped_column(String(36), nullable=False)
    state: Mapped[str] = mapped_column(String(32), nullable=False, default='copying')
    manifest: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
