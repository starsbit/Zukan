from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

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
            text("CREATE INDEX IF NOT EXISTS idx_images_tags ON images USING GIN(tags)")
        )
        await conn.execute(
            text("ALTER TABLE images ADD COLUMN IF NOT EXISTS thumbnail_path VARCHAR(1024)")
        )
        await conn.execute(
            text("ALTER TABLE images ADD COLUMN IF NOT EXISTS thumbnail_status VARCHAR(20) NOT NULL DEFAULT 'pending'")
        )
        await conn.execute(
            text("ALTER TABLE images ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE")
        )
        await conn.execute(
            text("CREATE INDEX IF NOT EXISTS idx_images_deleted_at ON images (deleted_at)")
        )
