import pytest
from backend.app.services.database_repair import repair_database_connection

@pytest.mark.asyncio
async def test_global_library_repair_uses_global_constraints(db_engine):
    async with db_engine.begin() as connection:
        assert await repair_database_connection(connection, ensure_constraints=True, probe=True) == 0
