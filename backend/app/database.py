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
