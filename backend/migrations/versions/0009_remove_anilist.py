"""Remove AniList integration and scraping

Revision ID: 0009_remove_anilist
Revises: 0008_anilist_scrape_queue
Create Date: 2026-04-05 00:00:00

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0009_remove_anilist"
down_revision = "0008_anilist_scrape_queue"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "anilist_scrape_targets" in existing_tables:
        op.drop_index(op.f("ix_anilist_scrape_targets_active_batch_item_id"), table_name="anilist_scrape_targets")
        op.drop_index(op.f("ix_anilist_scrape_targets_active_batch_id"), table_name="anilist_scrape_targets")
        op.drop_index(op.f("ix_anilist_scrape_targets_integration_id"), table_name="anilist_scrape_targets")
        op.drop_index(op.f("ix_anilist_scrape_targets_user_id"), table_name="anilist_scrape_targets")
        op.drop_table("anilist_scrape_targets")

    op.execute("DROP TYPE IF EXISTS anilist_scrape_target_status_enum")

    if "user_integrations" in existing_tables:
        op.drop_index(op.f("ix_user_integrations_user_id"), table_name="user_integrations")
        op.drop_table("user_integrations")

    op.execute("DROP TYPE IF EXISTS integration_service_enum")

    columns = {col["name"] for col in inspector.get_columns("users")}
    if "anilist_import_visibility" in columns:
        op.drop_column("users", "anilist_import_visibility")


def downgrade() -> None:
    pass
