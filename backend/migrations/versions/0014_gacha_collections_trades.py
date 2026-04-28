"""add gacha collections and trades

Revision ID: 0014_gacha_collections_trades
Revises: 0013_embedding_backfill_batch
Create Date: 2026-04-28 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0014_gacha_collections_trades"
down_revision = "0013_embedding_backfill_batch"
branch_labels = None
depends_on = None


def _create_enum(name: str, values: tuple[str, ...]) -> None:
    quoted_values = ", ".join(f"'{value}'" for value in values)
    op.execute(
        f"""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '{name}') THEN
                CREATE TYPE {name} AS ENUM ({quoted_values});
            END IF;
        END
        $$;
        """
    )


def upgrade() -> None:
    for value in ("trade_received", "trade_accepted", "trade_rejected", "trade_cancelled", "trade_expired"):
        op.execute(f"ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS '{value}'")

    _create_enum("gacha_rarity_tier_enum", ("N", "R", "SR", "SSR", "UR"))
    _create_enum("gacha_pull_mode_enum", ("single", "ten_pull", "daily"))
    _create_enum("gacha_currency_ledger_reason_enum", ("daily_claim", "pull_spend", "admin_adjustment"))
    _create_enum("collection_visibility_enum", ("private", "followers", "public"))
    _create_enum("trade_status_enum", ("pending", "accepted", "rejected", "cancelled", "expired"))
    _create_enum("trade_side_enum", ("sender", "receiver"))

    rarity_tier = postgresql.ENUM("N", "R", "SR", "SSR", "UR", name="gacha_rarity_tier_enum", create_type=False)
    pull_mode = postgresql.ENUM("single", "ten_pull", "daily", name="gacha_pull_mode_enum", create_type=False)
    ledger_reason = postgresql.ENUM(
        "daily_claim",
        "pull_spend",
        "admin_adjustment",
        name="gacha_currency_ledger_reason_enum",
        create_type=False,
    )
    collection_visibility = postgresql.ENUM(
        "private",
        "followers",
        "public",
        name="collection_visibility_enum",
        create_type=False,
    )
    trade_status = postgresql.ENUM(
        "pending",
        "accepted",
        "rejected",
        "cancelled",
        "expired",
        name="trade_status_enum",
        create_type=False,
    )
    trade_side = postgresql.ENUM("sender", "receiver", name="trade_side_enum", create_type=False)

    op.create_table(
        "media_gacha_rarity",
        sa.Column("media_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("media.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("rarity_score", sa.Float(), nullable=False),
        sa.Column("rarity_tier", rarity_tier, nullable=False),
        sa.Column("component_scores", postgresql.JSONB(), nullable=False),
        sa.Column("score_version", sa.String(length=32), nullable=False, server_default="v1"),
        sa.Column("previous_tier", rarity_tier, nullable=True),
        sa.Column("below_threshold_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("calculated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_media_gacha_rarity_rarity_score", "media_gacha_rarity", ["rarity_score"])
    op.create_index("ix_media_gacha_rarity_rarity_tier", "media_gacha_rarity", ["rarity_tier"])
    op.create_index("ix_media_gacha_rarity_tier_score", "media_gacha_rarity", ["rarity_tier", "rarity_score"])

    op.create_table(
        "gacha_currency_balances",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("balance", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_claimed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_spent", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_daily_claimed_on", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "gacha_pulls",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("mode", pull_mode, nullable=False),
        sa.Column("pool", sa.String(length=64), nullable=True),
        sa.Column("currency_spent", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_gacha_pulls_user_id", "gacha_pulls", ["user_id"])

    op.create_table(
        "gacha_currency_ledger",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("balance_after", sa.Integer(), nullable=False),
        sa.Column("reason", ledger_reason, nullable=False),
        sa.Column("reference_pull_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("gacha_pulls.id", ondelete="SET NULL"), nullable=True),
        sa.Column("ledger_metadata", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_gacha_currency_ledger_user_id", "gacha_currency_ledger", ["user_id"])
    op.create_index("ix_gacha_currency_ledger_reason", "gacha_currency_ledger", ["reason"])
    op.create_index("ix_gacha_currency_ledger_user_created", "gacha_currency_ledger", ["user_id", "created_at"])

    op.create_table(
        "gacha_pull_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("pull_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("gacha_pulls.id", ondelete="CASCADE"), nullable=False),
        sa.Column("media_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("media.id", ondelete="CASCADE"), nullable=False),
        sa.Column("rarity_tier", rarity_tier, nullable=False),
        sa.Column("rarity_score", sa.Float(), nullable=False),
        sa.Column("was_duplicate", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("upgrade_material_granted", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("position", sa.Integer(), nullable=False),
    )
    op.create_index("ix_gacha_pull_items_pull_id", "gacha_pull_items", ["pull_id"])
    op.create_index("ix_gacha_pull_items_media_id", "gacha_pull_items", ["media_id"])

    op.create_table(
        "user_collection_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("media_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("media.id", ondelete="CASCADE"), nullable=False),
        sa.Column("rarity_tier_at_acquisition", rarity_tier, nullable=False),
        sa.Column("level", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("upgrade_xp", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("copies_pulled", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("locked", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("tradeable", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("acquired_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "media_id", name="uq_user_collection_items_user_media"),
    )
    op.create_index("ix_user_collection_items_user_id", "user_collection_items", ["user_id"])
    op.create_index("ix_user_collection_items_media_id", "user_collection_items", ["media_id"])
    op.create_index("ix_user_collection_items_rarity_tier_at_acquisition", "user_collection_items", ["rarity_tier_at_acquisition"])
    op.create_index("ix_user_collection_items_user_rarity", "user_collection_items", ["user_id", "rarity_tier_at_acquisition"])

    op.create_table(
        "user_collection_privacy",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("visibility", collection_visibility, nullable=False, server_default="private"),
        sa.Column("allow_trade_requests", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("show_stats", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("show_nsfw", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )

    op.create_table(
        "trade_offers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("sender_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("receiver_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", trade_status, nullable=False, server_default="pending"),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_trade_offers_sender_user_id", "trade_offers", ["sender_user_id"])
    op.create_index("ix_trade_offers_receiver_user_id", "trade_offers", ["receiver_user_id"])
    op.create_index("ix_trade_offers_status", "trade_offers", ["status"])
    op.create_index("ix_trade_offers_expires_at", "trade_offers", ["expires_at"])

    op.create_table(
        "trade_offer_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("trade_offer_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("trade_offers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("side", trade_side, nullable=False),
        sa.Column("collection_item_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("user_collection_items.id", ondelete="CASCADE"), nullable=False),
        sa.UniqueConstraint("trade_offer_id", "collection_item_id", name="uq_trade_offer_items_trade_item"),
    )
    op.create_index("ix_trade_offer_items_trade_offer_id", "trade_offer_items", ["trade_offer_id"])
    op.create_index("ix_trade_offer_items_collection_item_id", "trade_offer_items", ["collection_item_id"])
    op.create_index("ix_trade_offer_items_side_trade", "trade_offer_items", ["side", "trade_offer_id"])


def downgrade() -> None:
    op.drop_index("ix_trade_offer_items_side_trade", table_name="trade_offer_items")
    op.drop_index("ix_trade_offer_items_collection_item_id", table_name="trade_offer_items")
    op.drop_index("ix_trade_offer_items_trade_offer_id", table_name="trade_offer_items")
    op.drop_table("trade_offer_items")

    op.drop_index("ix_trade_offers_expires_at", table_name="trade_offers")
    op.drop_index("ix_trade_offers_status", table_name="trade_offers")
    op.drop_index("ix_trade_offers_receiver_user_id", table_name="trade_offers")
    op.drop_index("ix_trade_offers_sender_user_id", table_name="trade_offers")
    op.drop_table("trade_offers")

    op.drop_table("user_collection_privacy")

    op.drop_index("ix_user_collection_items_user_rarity", table_name="user_collection_items")
    op.drop_index("ix_user_collection_items_rarity_tier_at_acquisition", table_name="user_collection_items")
    op.drop_index("ix_user_collection_items_media_id", table_name="user_collection_items")
    op.drop_index("ix_user_collection_items_user_id", table_name="user_collection_items")
    op.drop_table("user_collection_items")

    op.drop_index("ix_gacha_pull_items_media_id", table_name="gacha_pull_items")
    op.drop_index("ix_gacha_pull_items_pull_id", table_name="gacha_pull_items")
    op.drop_table("gacha_pull_items")

    op.drop_index("ix_gacha_currency_ledger_user_created", table_name="gacha_currency_ledger")
    op.drop_index("ix_gacha_currency_ledger_reason", table_name="gacha_currency_ledger")
    op.drop_index("ix_gacha_currency_ledger_user_id", table_name="gacha_currency_ledger")
    op.drop_table("gacha_currency_ledger")

    op.drop_index("ix_gacha_pulls_user_id", table_name="gacha_pulls")
    op.drop_table("gacha_pulls")

    op.drop_table("gacha_currency_balances")

    op.drop_index("ix_media_gacha_rarity_tier_score", table_name="media_gacha_rarity")
    op.drop_index("ix_media_gacha_rarity_rarity_tier", table_name="media_gacha_rarity")
    op.drop_index("ix_media_gacha_rarity_rarity_score", table_name="media_gacha_rarity")
    op.drop_table("media_gacha_rarity")

    postgresql.ENUM(name="trade_side_enum").drop(op.get_bind(), checkfirst=True)
    postgresql.ENUM(name="trade_status_enum").drop(op.get_bind(), checkfirst=True)
    postgresql.ENUM(name="collection_visibility_enum").drop(op.get_bind(), checkfirst=True)
    postgresql.ENUM(name="gacha_currency_ledger_reason_enum").drop(op.get_bind(), checkfirst=True)
    postgresql.ENUM(name="gacha_pull_mode_enum").drop(op.get_bind(), checkfirst=True)
    postgresql.ENUM(name="gacha_rarity_tier_enum").drop(op.get_bind(), checkfirst=True)
    # PostgreSQL enum values added to notification_type_enum are intentionally left in place.
