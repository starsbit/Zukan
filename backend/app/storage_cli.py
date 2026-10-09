"""Storage root lookup for backup/restore processes outside the API worker."""
import asyncio
import sys
from pathlib import Path
from sqlalchemy import text
from backend.app.config import settings
from backend.app.database import AsyncSessionLocal


async def get_root():
    async with AsyncSessionLocal() as db:
        exists = await db.scalar(text("SELECT to_regclass('public.library_storage')"))
        root = await db.scalar(text('SELECT root FROM library_storage WHERE id = 1')) if exists else None
        return root or str(settings.storage_dir.resolve())


if __name__ == '__main__':
    if sys.argv[1:] != ['root']:
        raise SystemExit('Usage: python -m backend.app.storage_cli root')
    print(asyncio.run(get_root()))
