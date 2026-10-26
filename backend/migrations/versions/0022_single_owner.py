"""Merge all libraries and replace accounts with a singleton owner.

Requires SINGLE_USER_OWNER_ID on every existing installation. Database-only,
transactional migration; file paths and media identities are never changed.
"""

import uuid
from alembic import op
import sqlalchemy as sa
from backend.app.config import settings

revision = "0022_single_owner"
down_revision = "0021_storage_setup_prompt"
branch_labels = None
depends_on = None


def upgrade():
    db = op.get_bind()
    users = db.execute(sa.text("SELECT id FROM users")).scalars().all()
    owner = None
    if users:
        try:
            owner = uuid.UUID(settings.single_user_owner_id)
        except (ValueError, TypeError):
            raise RuntimeError(
                "Set SINGLE_USER_OWNER_ID after running python -m backend.app.owner_migration preflight"
            ) from None
        if owner not in users:
            raise RuntimeError(
                "SINGLE_USER_OWNER_ID does not identify an existing account"
            )

    # Locks prevent writers from introducing collisions during the merge.
    db.execute(
        sa.text(
            "LOCK TABLE users, media, tags, media_tags, owned_entities, media_entities, user_favorites IN ACCESS EXCLUSIVE MODE"
        )
    )
    op.execute("ALTER TABLE media_tags DISABLE TRIGGER USER")
    # Source/category wins according to the chosen canonical tag; each media link
    # remains unchanged unless two links collapse onto the same canonical tag.
    db.execute(
        sa.text("""CREATE TEMP TABLE tag_map ON COMMIT DROP AS
        SELECT id, first_value(id) OVER (PARTITION BY name ORDER BY
            CASE WHEN owner_user_id = :owner THEN 0 ELSE 1 END, id) AS canonical FROM tags"""),
        {"owner": owner},
    )
    op.execute("""CREATE TEMP TABLE merged_media_tags ON COMMIT DROP AS
        SELECT DISTINCT ON (mt.media_id, tm.canonical)
            mt.media_id, tm.canonical AS tag_id, mt.confidence, mt.source,
            mt.model_version, mt.created_at, mt.created_by_user_id
        FROM media_tags mt JOIN tag_map tm ON tm.id = mt.tag_id
        ORDER BY mt.media_id, tm.canonical,
            CASE WHEN mt.tag_id = tm.canonical THEN 0 ELSE 1 END,
            CASE mt.source::text WHEN 'manual' THEN 0 WHEN 'imported' THEN 1 ELSE 2 END,
            mt.confidence DESC, mt.created_at, mt.tag_id""")
    op.execute("DELETE FROM media_tags")
    op.execute("INSERT INTO media_tags SELECT * FROM merged_media_tags")
    op.execute(
        "DELETE FROM tags WHERE id IN (SELECT id FROM tag_map WHERE id <> canonical)"
    )
    # Remap every FK to an entity, including classification feedback.
    db.execute(
        sa.text("""CREATE TEMP TABLE entity_map ON COMMIT DROP AS
        SELECT id, first_value(id) OVER (PARTITION BY entity_type, normalized_name ORDER BY
            CASE WHEN owner_user_id = :owner THEN 0 ELSE 1 END, created_at, id) AS canonical FROM owned_entities"""),
        {"owner": owner},
    )
    op.execute(
        "UPDATE media_entities me SET entity_id = em.canonical FROM entity_map em WHERE me.entity_id = em.id"
    )
    op.execute(
        "UPDATE library_classification_feedback f SET suggested_entity_id = em.canonical FROM entity_map em WHERE f.suggested_entity_id = em.id"
    )
    op.execute(
        "DELETE FROM owned_entities WHERE id IN (SELECT id FROM entity_map WHERE id <> canonical)"
    )
    op.execute("""CREATE TEMP TABLE merged_favorites ON COMMIT DROP AS
        SELECT media_id, min(created_at) AS created_at FROM user_favorites GROUP BY media_id""")
    op.execute("DELETE FROM user_favorites")
    if owner:
        db.execute(
            sa.text(
                "INSERT INTO user_favorites(user_id, media_id, created_at) SELECT :owner, media_id, created_at FROM merged_favorites"
            ),
            {"owner": owner},
        )
    op.execute(
        "DELETE FROM notifications WHERE type::text IN ('share_invite','trade_received','trade_accepted','trade_rejected','trade_cancelled','trade_expired') OR data->>'kind' LIKE 'gacha_%'"
    )

    for table in (
        "trade_offer_items",
        "trade_offers",
        "user_collection_items",
        "user_collection_privacy",
        "gacha_pull_items",
        "gacha_pulls",
        "gacha_currency_ledger",
        "gacha_currency_balances",
        "media_gacha_rarity",
        "album_share_invites",
        "album_shares",
    ):
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
    # Include all actual gacha tables, whose names varied across pre-release builds.
    for table in sa.inspect(db).get_table_names():
        if table.startswith(("gacha_", "trade_")):
            op.execute(f'DROP TABLE "{table}" CASCADE')
    columns = {
        "media": ("uploader_id", "owner_id", "visibility"),
        "albums": ("owner_id",),
        "tags": ("owner_user_id",),
        "owned_entities": ("owner_user_id",),
        "media_tags": ("created_by_user_id",),
        "media_embeddings": ("uploader_id",),
        "import_batches": ("user_id",),
        "notifications": ("user_id",),
        "library_classification_feedback": ("user_id",),
        "user_favorites": ("user_id",),
        "library_storage": ("discovery_owner_id",),
    }
    for table, fields in columns.items():
        for field in fields:
            op.execute(f"ALTER TABLE {table} DROP COLUMN {field} CASCADE")
    op.execute(
        "ALTER TABLE user_favorites DROP CONSTRAINT IF EXISTS user_favorites_pkey"
    )
    op.create_primary_key("user_favorites_pkey", "user_favorites", ["media_id"])
    op.create_unique_constraint("uq_tags_name", "tags", ["name"])
    op.create_unique_constraint(
        "uq_entities_type_normalized_name",
        "owned_entities",
        ["entity_type", "normalized_name"],
    )
    op.create_index(
        "ix_entities_type_count_name",
        "owned_entities",
        ["entity_type", "media_count", "name"],
    )
    op.create_index(
        "ix_library_feedback_media_entity",
        "library_classification_feedback",
        ["media_id", "entity_type"],
    )
    op.create_index(
        "ix_library_feedback_name_action",
        "library_classification_feedback",
        ["entity_type", "suggested_name", "action"],
    )
    op.execute(
        "UPDATE tags SET media_count = (SELECT count(*) FROM media_tags WHERE tag_id = tags.id)"
    )
    op.execute(
        "UPDATE owned_entities SET media_count = (SELECT count(DISTINCT media_id) FROM media_entities WHERE entity_id = owned_entities.id)"
    )
    op.execute("ALTER TABLE media_tags ENABLE TRIGGER USER")
    op.execute("DELETE FROM refresh_tokens")
    op.execute("DELETE FROM api_keys")
    if owner:
        db.execute(sa.text("DELETE FROM users WHERE id <> :owner"), {"owner": owner})
    op.drop_column("users", "is_admin")
    op.drop_column("users", "storage_quota_mb")
    op.add_column(
        "users",
        sa.Column("singleton", sa.Integer(), nullable=False, server_default="1"),
    )
    op.create_check_constraint("ck_owner_singleton", "users", "singleton = 1")
    op.create_unique_constraint("uq_users_singleton", "users", ["singleton"])
    op.create_table(
        "auth_sessions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("auth_config", sa.String(64), nullable=False),
        sa.Column("revoked", sa.Boolean(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.add_column(
        "refresh_tokens",
        sa.Column(
            "session_id",
            sa.Uuid(),
            sa.ForeignKey("auth_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    op.create_table(
        "auth_exchanges",
        sa.Column("code_hash", sa.String(64), primary_key=True),
        sa.Column("browser_hash", sa.String(64), nullable=False),
        sa.Column("auth_config", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    # Rebuild enums without removed public/social values.
    op.execute("ALTER TABLE notifications ALTER COLUMN type TYPE text USING type::text")
    op.execute("DROP TYPE notification_type_enum")
    op.execute(
        "CREATE TYPE notification_type_enum AS ENUM ('batch_done','batch_failed','app_update','welcome')"
    )
    op.execute(
        "ALTER TABLE notifications ALTER COLUMN type TYPE notification_type_enum USING type::notification_type_enum"
    )
    for enum in (
        "media_visibility_enum",
        "album_share_role_enum",
        "album_share_invite_status_enum",
        "gacha_rarity_tier_enum",
        "gacha_pull_mode_enum",
        "gacha_currency_ledger_reason_enum",
        "collection_visibility_enum",
        "trade_status_enum",
        "trade_side_enum",
    ):
        op.execute(f"DROP TYPE IF EXISTS {enum}")


def downgrade():
    raise RuntimeError(
        "Single-owner migration is irreversible. Restore the pre-upgrade backup and previous application version."
    )
