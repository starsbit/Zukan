from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from backend.app.config import settings
from backend.app.database.base import Base

# Ensure model metadata is registered for autogenerate.
from backend.app.models import albums as _albums  # noqa: F401
from backend.app.models import auth as _auth  # noqa: F401
from backend.app.models import integrations as _integrations  # noqa: F401
from backend.app.models import media as _media  # noqa: F401
from backend.app.models import media_interactions as _media_interactions  # noqa: F401
from backend.app.models import notifications as _notifications  # noqa: F401
from backend.app.models import processing as _processing  # noqa: F401
from backend.app.models import relations as _relations  # noqa: F401
from backend.app.models import tags as _tags  # noqa: F401

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

config.set_main_option("sqlalchemy.url", settings.database_url)
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)

    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    import asyncio

    asyncio.run(run_migrations_online())
