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
