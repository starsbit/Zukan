"""Add user integrations

Revision ID: 0004_add_user_integrations
Revises: 0003_review_dismissed
Create Date: 2026-04-05 00:00:00

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0004_add_user_integrations"
down_revision = "0003_review_dismissed"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    integration_service_enum = postgresql.ENUM(
        "anilist",
        name="integration_service_enum",
        create_type=False,
    )

    existing_enums = {row[0] for row in bind.execute(sa.text("SELECT typname FROM pg_type WHERE typtype = 'e'"))}
    if "integration_service_enum" not in existing_enums:
        integration_service_enum.create(bind, checkfirst=True)

    if "user_integrations" not in inspector.get_table_names():
        op.create_table(
            "user_integrations",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column(
                "service",
                integration_service_enum,
                nullable=False,
            ),
            sa.Column("token", sa.String(length=2048), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", "service", name="uq_user_integrations_user_service"),
        )

    existing_indexes = {index["name"] for index in inspector.get_indexes("user_integrations")} if "user_integrations" in inspector.get_table_names() else set()
    if op.f("ix_user_integrations_user_id") not in existing_indexes:
        op.create_index(op.f("ix_user_integrations_user_id"), "user_integrations", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_user_integrations_user_id"), table_name="user_integrations")
    op.drop_table("user_integrations")
    op.execute("DROP TYPE IF EXISTS integration_service_enum")
