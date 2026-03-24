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
    migrations_dir = backend_root / "migrations"
    alembic_ini = backend_root / "alembic.ini"

    if not migrations_dir.exists():
        raise RuntimeError(f"Alembic migrations directory not found: {migrations_dir}")

    config = Config(str(alembic_ini)) if alembic_ini.exists() else Config()
    config.set_main_option("script_location", str(migrations_dir))
    config.set_main_option("prepend_sys_path", str(backend_root))
    config.set_main_option("sqlalchemy.url", settings.database_url)
    command.upgrade(config, "head")