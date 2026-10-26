"""Remember verified source timestamps for inexpensive scheduled NAS scans."""

from alembic import op
import sqlalchemy as sa

revision = "0023_nas_file_fingerprint"
down_revision = "0022_single_owner"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("media", sa.Column("source_mtime_ns", sa.BigInteger(), nullable=True))


def downgrade():
    op.drop_column("media", "source_mtime_ns")
