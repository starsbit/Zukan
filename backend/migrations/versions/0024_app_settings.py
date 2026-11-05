"""Store owner-selected application settings, starting with the tagger."""

from alembic import op
import sqlalchemy as sa

revision = "0024_app_settings"
down_revision = "0023_nas_file_fingerprint"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "app_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "tagger_backend",
            sa.Enum("wd_v3", "pixai_v1_336_int8", name="tagger_backend_enum"),
            nullable=True,
        ),
    )


def downgrade():
    op.drop_table("app_settings")
    op.execute("DROP TYPE tagger_backend_enum")
