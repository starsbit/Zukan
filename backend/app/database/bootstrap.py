import asyncio
import logging
import time
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy.engine.url import make_url

from backend.app.config import settings


logger = logging.getLogger("backend.app.database.bootstrap")


async def init_db():
    """Run schema migrations to the latest Alembic revision."""

    started_at = time.perf_counter()
    logger.info("Database migration bootstrap started")
    await asyncio.to_thread(_upgrade_to_head)
    logger.info("Database migration bootstrap finished in %.2fs", time.perf_counter() - started_at)


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
    try:
        parsed_url = make_url(settings.database_url)
        logger.info(
            "Running Alembic upgrade to head using driver=%s host=%s database=%s",
            parsed_url.drivername,
            parsed_url.host,
            parsed_url.database,
        )
    except Exception:
        logger.warning("Unable to parse DATABASE_URL for migration diagnostics")

    started_at = time.perf_counter()
    logger.info("Alembic upgrade starting")
    command.upgrade(config, "head")
    logger.info("Alembic upgrade completed in %.2fs", time.perf_counter() - started_at)
