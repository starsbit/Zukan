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
            text("CREATE INDEX IF NOT EXISTS idx_media_tags ON media USING GIN(tags)")
        )
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS idx_media_character_name_lower ON media (LOWER(character_name))")
        )
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
            text("ALTER TABLE media ADD COLUMN IF NOT EXISTS source_url VARCHAR(2048)")
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
