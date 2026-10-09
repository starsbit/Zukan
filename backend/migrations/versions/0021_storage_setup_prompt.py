"""Track explicit library-folder configuration for setup and upgrade prompts."""
from alembic import op
import sqlalchemy as sa

revision = '0021_storage_setup_prompt'
down_revision = '0020_nas_library'
branch_labels = None
depends_on = None


def upgrade():
    if 'folder_configured' not in {column['name'] for column in sa.inspect(op.get_bind()).get_columns('library_storage')}:
        op.add_column('library_storage', sa.Column('folder_configured', sa.Boolean(), nullable=False, server_default=sa.false()))
    # An already completed cutover is an explicit choice of storage folder.
    op.execute("""
        UPDATE library_storage AS library
        SET folder_configured = true
        WHERE EXISTS (
            SELECT 1 FROM storage_migrations AS migration
            WHERE migration.destination_root = library.root
              AND migration.state IN ('cleanup', 'cleanup_pending', 'complete')
        )
    """)


def downgrade():
    op.drop_column('library_storage', 'folder_configured')
