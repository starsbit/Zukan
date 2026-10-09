"""Persistent library configuration and resumable storage migration."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
revision = '0020_nas_library'
down_revision = '0019_media_review_cache'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    existing = sa.inspect(bind)
    if not existing.has_table('library_storage'):
        op.create_table('library_storage',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('root', sa.String(1024), nullable=False),
            sa.Column('generated_dir', sa.String(512), nullable=False),
            sa.Column('discovery_owner_id', sa.String(36)),
            sa.Column('scan_interval_seconds', sa.Integer(), nullable=False),
            sa.Column('root_identity', sa.String(36)),
            sa.Column('last_scan', postgresql.JSONB()))
    if not existing.has_table('storage_migrations'):
        op.create_table('storage_migrations',
            sa.Column('id', sa.String(36), primary_key=True),
            sa.Column('source_root', sa.String(1024), nullable=False),
            sa.Column('source_identity', sa.String(36), nullable=False),
            sa.Column('destination_root', sa.String(1024), nullable=False),
            sa.Column('destination_identity', sa.String(36), nullable=False),
            sa.Column('state', sa.String(32), nullable=False),
            sa.Column('manifest', postgresql.JSONB(), nullable=False),
            sa.Column('error', sa.Text()),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()))
    if 'file_status' not in {column['name'] for column in existing.get_columns('media')}:
        op.add_column('media', sa.Column('file_status', sa.String(24), nullable=False, server_default='available'))


def downgrade():
    op.drop_column('media', 'file_status')
    op.drop_table('storage_migrations')
    op.drop_table('library_storage')
