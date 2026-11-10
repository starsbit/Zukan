"""Replace periodic full-library scans with an ingest folder."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0026_library_ingest"
down_revision = "0025_user_avatar"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "library_storage",
        sa.Column("ingest_dir", sa.String(512), nullable=False, server_default="ingest"),
    )
    op.add_column(
        "library_storage",
        sa.Column("ingest_interval_seconds", sa.Integer(), nullable=False, server_default="60"),
    )
    op.add_column("library_storage", sa.Column("last_ingest", postgresql.JSONB(), nullable=True))
    op.drop_column("library_storage", "scan_interval_seconds")


def downgrade():
    op.add_column(
        "library_storage",
        sa.Column("scan_interval_seconds", sa.Integer(), nullable=False, server_default="3600"),
    )
    op.drop_column("library_storage", "last_ingest")
    op.drop_column("library_storage", "ingest_interval_seconds")
    op.drop_column("library_storage", "ingest_dir")
