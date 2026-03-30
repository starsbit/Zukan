"""add case-insensitive username uniqueness

Revision ID: 0003_case_insensitive_username_index
Revises: 0002_album_share_invites_and_notification_data
Create Date: 2026-03-30
"""

from alembic import op
import sqlalchemy as sa


revision = "0003_case_insensitive_username_index"
down_revision = "0002_album_share_invites_and_notification_data"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "uq_users_username_lower",
        "users",
        [sa.text("lower(username)")],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_users_username_lower", table_name="users")
