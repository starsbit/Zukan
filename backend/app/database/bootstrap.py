import asyncio
from pathlib import Path

from alembic import command
from alembic.config import Config

from backend.app.config import settings


async def init_db():
    """Run schema migrations to the latest Alembic revision."""

    await asyncio.to_thread(_upgrade_to_head)


def _upgrade_to_head() -> None:
    backend_root = Path(__file__).resolve().parents[2]
    alembic_ini = backend_root / "alembic.ini"
    config = Config(str(alembic_ini))
    config.set_main_option("sqlalchemy.url", settings.database_url)
    command.upgrade(config, "head")