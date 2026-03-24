from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from backend.app.config import settings

engine = create_async_engine(
    str(settings.database_url),
    echo=False,
    pool_size=10,
    max_overflow=20,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        # Indexes
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS idx_media_deleted_at ON media (deleted_at)")
        )
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS idx_media_captured_at ON media (captured_at)")
        )
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS idx_media_entities_media_id ON media_entities (media_id)")
        )
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS idx_media_entities_type_name ON media_entities (entity_type, name)")
        )
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS idx_media_external_refs_media_id ON media_external_refs (media_id)")
        )

        # Column additions (idempotent)
        await conn.execute(
            text("ALTER TABLE media ADD COLUMN IF NOT EXISTS tagging_error VARCHAR(1024)")
        )
        await conn.execute(
            text(
                "ALTER TABLE users "
                "ADD COLUMN IF NOT EXISTS tag_confidence_threshold FLOAT NOT NULL DEFAULT 0.35"
            )
        )
        await conn.execute(
            text("ALTER TABLE media ADD COLUMN IF NOT EXISTS ocr_text TEXT")
        )
        await conn.execute(
            text("ALTER TABLE media ADD COLUMN IF NOT EXISTS ocr_text_override TEXT")
        )
        await conn.execute(
            text("ALTER TABLE media ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1")
        )
        await conn.execute(
            text("ALTER TABLE albums ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1")
        )
        await conn.execute(
            text("ALTER TABLE users ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1")
        )

        # Enum type creation (idempotent — create_all handles fresh DBs; these cover existing DBs)
        for type_sql in [
            "CREATE TYPE media_visibility_enum AS ENUM ('private', 'shared', 'public')",
            "CREATE TYPE album_share_role_enum AS ENUM ('viewer', 'editor', 'owner')",
            "CREATE TYPE media_tag_source_enum AS ENUM ('auto', 'manual', 'imported')",
            "CREATE TYPE batch_type_enum AS ENUM ('upload', 'retag', 'rethumbnail', 'rescan')",
            "CREATE TYPE batch_status_enum AS ENUM ('pending', 'running', 'partial_failed', 'done', 'failed', 'cancelled')",
            "CREATE TYPE item_status_enum AS ENUM ('pending', 'processing', 'done', 'failed', 'skipped')",
            "CREATE TYPE processing_step_enum AS ENUM ('ingest', 'thumbnail', 'poster', 'tag', 'ocr')",
            "CREATE TYPE announcement_severity_enum AS ENUM ('info', 'warning', 'critical')",
            "CREATE TYPE notification_type_enum AS ENUM ('batch_done', 'batch_failed', 'app_update', 'share_invite')",
        ]:
            await conn.execute(text(f"""
                DO $$ BEGIN {type_sql};
                EXCEPTION WHEN duplicate_object THEN NULL;
                END $$
            """))

        # media additions
        await conn.execute(text(
            "ALTER TABLE media ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id) ON DELETE SET NULL"
        ))
        await conn.execute(text(
            "ALTER TABLE media ADD COLUMN IF NOT EXISTS visibility media_visibility_enum NOT NULL DEFAULT 'private'"
        ))
        await conn.execute(text(
            "ALTER TABLE media ADD COLUMN IF NOT EXISTS ingested_at TIMESTAMPTZ"
        ))
        await conn.execute(text(
            "ALTER TABLE media ADD COLUMN IF NOT EXISTS phash VARCHAR(16)"
        ))
        await conn.execute(text(
            "ALTER TABLE media ADD COLUMN IF NOT EXISTS tagging_model_version VARCHAR(64)"
        ))
        await conn.execute(text(
            "ALTER TABLE media ADD COLUMN IF NOT EXISTS tagging_started_at TIMESTAMPTZ"
        ))
        await conn.execute(text(
            "ALTER TABLE media ADD COLUMN IF NOT EXISTS tagging_finished_at TIMESTAMPTZ"
        ))
        await conn.execute(text(
            "ALTER TABLE media ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0"
        ))

        # media_tags additions
        await conn.execute(text(
            "ALTER TABLE media_tags ADD COLUMN IF NOT EXISTS source media_tag_source_enum NOT NULL DEFAULT 'auto'"
        ))
        await conn.execute(text(
            "ALTER TABLE media_tags ADD COLUMN IF NOT EXISTS model_version VARCHAR(64)"
        ))
        await conn.execute(text(
            "ALTER TABLE media_tags ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()"
        ))
        await conn.execute(text(
            "ALTER TABLE media_tags ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL"
        ))

        # album_shares: migrate can_edit → role
        await conn.execute(text(
            "ALTER TABLE album_shares ADD COLUMN IF NOT EXISTS role album_share_role_enum NOT NULL DEFAULT 'viewer'"
        ))
        await conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'album_shares' AND column_name = 'can_edit'
                ) THEN
                    UPDATE album_shares SET role = 'editor' WHERE can_edit = TRUE;
                END IF;
            END $$
        """))
        await conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'album_shares' AND column_name = 'can_edit'
                ) THEN
                    ALTER TABLE album_shares DROP COLUMN can_edit;
                END IF;
            END $$
        """))
        await conn.execute(text(
            "ALTER TABLE album_shares ADD COLUMN IF NOT EXISTS shared_at TIMESTAMPTZ DEFAULT NOW()"
        ))
        await conn.execute(text(
            "ALTER TABLE album_shares ADD COLUMN IF NOT EXISTS shared_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL"
        ))

        # users additions
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_announcement_id UUID REFERENCES app_announcements(id) ON DELETE SET NULL"
        ))

        # new table indexes
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_import_batches_user_id ON import_batches (user_id)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_import_batch_items_batch_id ON import_batch_items (batch_id)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_import_batch_items_media_id ON import_batch_items (media_id)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications (user_id)"
        ))

        # Version bump trigger (auto-increments version on every UPDATE)
        await conn.execute(text("""
            CREATE OR REPLACE FUNCTION fn_bump_version() RETURNS TRIGGER AS $$
            BEGIN
                NEW.version = OLD.version + 1;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql
        """))
        for table in ("media", "albums", "users"):
            await conn.execute(text(f"DROP TRIGGER IF EXISTS trg_{table}_version ON {table}"))
            await conn.execute(text(f"""
                CREATE TRIGGER trg_{table}_version
                BEFORE UPDATE ON {table} FOR EACH ROW
                EXECUTE FUNCTION fn_bump_version()
            """))

        # Tag count triggers
        await conn.execute(text("""
            CREATE OR REPLACE FUNCTION fn_media_tag_after_delete() RETURNS TRIGGER AS $$
            BEGIN
                UPDATE tags SET media_count = media_count - 1 WHERE id = OLD.tag_id;
                DELETE FROM tags WHERE id = OLD.tag_id AND media_count <= 0;
                RETURN NULL;
            END;
            $$ LANGUAGE plpgsql
        """))
        await conn.execute(text("DROP TRIGGER IF EXISTS trg_media_tag_after_delete ON media_tags"))
        await conn.execute(text("""
            CREATE TRIGGER trg_media_tag_after_delete
            AFTER DELETE ON media_tags FOR EACH ROW
            EXECUTE FUNCTION fn_media_tag_after_delete()
        """))
        await conn.execute(text("""
            CREATE OR REPLACE FUNCTION fn_media_tag_after_insert() RETURNS TRIGGER AS $$
            BEGIN
                UPDATE tags SET media_count = media_count + 1 WHERE id = NEW.tag_id;
                RETURN NULL;
            END;
            $$ LANGUAGE plpgsql
        """))
        await conn.execute(text("DROP TRIGGER IF EXISTS trg_media_tag_after_insert ON media_tags"))
        await conn.execute(text("""
            CREATE TRIGGER trg_media_tag_after_insert
            AFTER INSERT ON media_tags FOR EACH ROW
            EXECUTE FUNCTION fn_media_tag_after_insert()
        """))
