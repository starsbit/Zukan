"""add album share invites and notification data

Revision ID: 0002_album_share_invites_and_notification_data
Revises: 0001_initial_schema
Create Date: 2026-03-30
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0002_album_share_invites_and_notification_data"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


album_share_invite_status_enum = postgresql.ENUM("pending", "accepted", "rejected", name="album_share_invite_status_enum")


def _has_table(table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name)


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(column["name"] == column_name for column in inspector.get_columns(table_name))


def _has_index(table_name: str, index_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(index["name"] == index_name for index in inspector.get_indexes(table_name))


def upgrade() -> None:
    op.alter_column(
        "alembic_version",
        "version_num",
        existing_type=sa.String(length=32),
        type_=sa.String(length=255),
        existing_nullable=False,
    )
    album_share_invite_status_enum.create(op.get_bind(), checkfirst=True)

    if not _has_column("notifications", "data"):
        op.add_column("notifications", sa.Column("data", sa.JSON(), nullable=True))

    if not _has_table("album_share_invites"):
        op.create_table(
            "album_share_invites",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("album_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column(
                "role",
                postgresql.ENUM("viewer", "editor", "owner", name="album_share_role_enum", create_type=False),
                nullable=False,
                server_default="viewer",
            ),
            sa.Column(
                "status",
                postgresql.ENUM("pending", "accepted", "rejected", name="album_share_invite_status_enum", create_type=False),
                nullable=False,
                server_default="pending",
            ),
            sa.Column("invited_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("invited_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("notification_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.ForeignKeyConstraint(["album_id"], ["albums.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["invited_by_user_id"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["notification_id"], ["notifications.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("album_id", "user_id", name="uq_album_share_invites_album_user"),
            sa.UniqueConstraint("notification_id"),
        )

    if not _has_index("album_share_invites", "ix_album_share_invites_album_id"):
        op.create_index("ix_album_share_invites_album_id", "album_share_invites", ["album_id"])
    if not _has_index("album_share_invites", "ix_album_share_invites_user_id"):
        op.create_index("ix_album_share_invites_user_id", "album_share_invites", ["user_id"])


def downgrade() -> None:
    if _has_table("album_share_invites"):
        if _has_index("album_share_invites", "ix_album_share_invites_user_id"):
            op.drop_index("ix_album_share_invites_user_id", table_name="album_share_invites")
        if _has_index("album_share_invites", "ix_album_share_invites_album_id"):
            op.drop_index("ix_album_share_invites_album_id", table_name="album_share_invites")
        op.drop_table("album_share_invites")
    if _has_column("notifications", "data"):
        op.drop_column("notifications", "data")
    album_share_invite_status_enum.drop(op.get_bind(), checkfirst=True)
