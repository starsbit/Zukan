"""Let the owner pick a library media item as their profile picture."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0025_user_avatar"
down_revision = "0024_app_settings"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "users",
        sa.Column(
            "avatar_media_id",
            UUID(as_uuid=True),
            sa.ForeignKey("media.id", name="fk_users_avatar_media_id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade():
    op.drop_constraint("fk_users_avatar_media_id", "users", type_="foreignkey")
    op.drop_column("users", "avatar_media_id")
