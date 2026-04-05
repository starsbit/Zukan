"""Add AniList scrape target queue

Revision ID: 0008_anilist_scrape_queue
Revises: 0007_last_synced_at
Create Date: 2026-04-05 20:30:00

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0008_anilist_scrape_queue"
down_revision = "0007_last_synced_at"
branch_labels = None
depends_on = None


_TARGET_STATUS_ENUM = sa.Enum(
    "pending",
    "processing",
    "done",
    "failed",
    "no_match",
    "inactive",
    name="anilist_scrape_target_status_enum",
)
_TARGET_STATUS_ENUM_NO_CREATE = postgresql.ENUM(
    "pending",
    "processing",
    "done",
    "failed",
    "no_match",
    "inactive",
    name="anilist_scrape_target_status_enum",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    _TARGET_STATUS_ENUM.create(bind, checkfirst=True)
    op.execute("ALTER TYPE batch_type_enum ADD VALUE IF NOT EXISTS 'anilist_scrape'")

    existing_tables = set(inspector.get_table_names())
    if "anilist_scrape_targets" not in existing_tables:
        op.create_table(
            "anilist_scrape_targets",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("integration_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("anilist_media_id", sa.Integer(), nullable=False),
            sa.Column("anilist_character_id", sa.Integer(), nullable=False),
            sa.Column("series_title_snapshot", sa.String(length=512), nullable=False),
            sa.Column("character_name_snapshot", sa.String(length=512), nullable=False),
            sa.Column("status", _TARGET_STATUS_ENUM_NO_CREATE, nullable=False, server_default="pending"),
            sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_error", sa.String(length=1024), nullable=True),
            sa.Column("last_scraped_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("active_batch_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("active_batch_item_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.ForeignKeyConstraint(["active_batch_id"], ["import_batches.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["active_batch_item_id"], ["import_batch_items.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["integration_id"], ["user_integrations.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "user_id",
                "anilist_media_id",
                "anilist_character_id",
                name="uq_anilist_scrape_targets_user_media_character",
            ),
        )
        op.create_index(op.f("ix_anilist_scrape_targets_user_id"), "anilist_scrape_targets", ["user_id"], unique=False)
        op.create_index(op.f("ix_anilist_scrape_targets_integration_id"), "anilist_scrape_targets", ["integration_id"], unique=False)
        op.create_index(op.f("ix_anilist_scrape_targets_active_batch_id"), "anilist_scrape_targets", ["active_batch_id"], unique=False)
        op.create_index(op.f("ix_anilist_scrape_targets_active_batch_item_id"), "anilist_scrape_targets", ["active_batch_item_id"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())
    if "anilist_scrape_targets" in existing_tables:
        op.drop_index(op.f("ix_anilist_scrape_targets_active_batch_item_id"), table_name="anilist_scrape_targets")
        op.drop_index(op.f("ix_anilist_scrape_targets_active_batch_id"), table_name="anilist_scrape_targets")
        op.drop_index(op.f("ix_anilist_scrape_targets_integration_id"), table_name="anilist_scrape_targets")
        op.drop_index(op.f("ix_anilist_scrape_targets_user_id"), table_name="anilist_scrape_targets")
        op.drop_table("anilist_scrape_targets")
