"""add gacha discard reimbursement ledger reasons

Revision ID: 0016_gacha_discard_reimbursement
Revises: 0015_public_collection_default
Create Date: 2026-04-29 06:00:00.000000
"""

from alembic import op


revision = "0016_gacha_discard_reimbursement"
down_revision = "0015_public_collection_default"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE gacha_currency_ledger_reason_enum ADD VALUE IF NOT EXISTS 'collection_discard'")
    op.execute("ALTER TYPE gacha_currency_ledger_reason_enum ADD VALUE IF NOT EXISTS 'media_removed_reimbursement'")


def downgrade() -> None:
    # PostgreSQL enum values are intentionally left in place.
    pass
