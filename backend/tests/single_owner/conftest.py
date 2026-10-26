import asyncio
import os
import uuid
from pathlib import Path

import asyncpg
import pytest
import pytest_asyncio
from alembic import command
from alembic.config import Config
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.engine import make_url

from backend.app.config import settings


@pytest.fixture(scope="session")
def owner_postgres_url():
    configured = os.environ.get("ZUKAN_TEST_DATABASE_URL")
    if configured:
        yield configured
        return
    from testcontainers.postgres import PostgresContainer

    with PostgresContainer("pgvector/pgvector:pg17") as container:
        yield container.get_connection_url().replace(
            "postgresql+psycopg2:", "postgresql+asyncpg:"
        )


@pytest_asyncio.fixture
async def isolated_database(owner_postgres_url, monkeypatch):
    parsed = make_url(owner_postgres_url)
    name = "zukan_test_" + uuid.uuid4().hex
    connection = await asyncpg.connect(
        host=parsed.host,
        port=parsed.port,
        user=parsed.username,
        password=parsed.password,
        database=parsed.database,
    )
    await connection.execute(f'CREATE DATABASE "{name}"')
    url = parsed.set(database=name).render_as_string(hide_password=False)
    monkeypatch.setattr(settings, "database_url", url)
    monkeypatch.setattr(settings, "single_user_owner_id", "")
    engine = create_async_engine(url)
    try:
        yield engine
    finally:
        await engine.dispose()
        await connection.execute(f'DROP DATABASE "{name}" WITH (FORCE)')
        await connection.close()


async def migrate(revision="head"):
    root = Path(__file__).resolve().parents[2]
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "migrations"))
    await asyncio.to_thread(command.upgrade, config, revision)


@pytest_asyncio.fixture
async def owner_client(isolated_database, monkeypatch):
    import httpx
    from backend.app.main import api
    from backend.app.database import get_db
    from backend.app.services.storage_gate import storage_gate
    from backend.app.utils.rate_limit import rate_limit_store

    await migrate()
    maker = async_sessionmaker(isolated_database, expire_on_commit=False)

    async def database():
        async with maker() as db:
            yield db

    api.dependency_overrides[get_db] = database
    monkeypatch.setattr(settings, "auth_mode", "local")
    monkeypatch.setattr(settings, "setup_token", "test-owner-setup")
    monkeypatch.setattr(storage_gate, "available", True)
    await rate_limit_store.reset()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api), base_url="http://localhost"
    ) as client:
        yield client, maker
    api.dependency_overrides.clear()
