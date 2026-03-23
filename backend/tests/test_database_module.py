import asyncio
from contextlib import asynccontextmanager

from backend.app import database


def test_get_db_yields_session_and_closes_generator(monkeypatch):
    class DummySession:
        pass

    session = DummySession()

    @asynccontextmanager
    async def fake_sessionmaker():
        yield session

    monkeypatch.setattr(database, "AsyncSessionLocal", fake_sessionmaker)

    async def _exercise():
        generator = database.get_db()
        yielded = await anext(generator)
        assert yielded is session
        await generator.aclose()

    asyncio.run(_exercise())


def test_init_db_runs_metadata_and_expected_sql(monkeypatch):
    calls = {"run_sync": [], "execute": []}

    class DummyConn:
        async def run_sync(self, fn):
            calls["run_sync"].append(fn)

        async def execute(self, stmt):
            calls["execute"].append(str(stmt))

    @asynccontextmanager
    async def fake_begin():
        yield DummyConn()

    class DummyEngine:
        def begin(self):
            return fake_begin()

    monkeypatch.setattr(database, "engine", DummyEngine())

    asyncio.run(database.init_db())

    assert calls["run_sync"] == [database.Base.metadata.create_all]
    assert any("deleted_at" in stmt for stmt in calls["execute"])
    assert any("captured_at" in stmt for stmt in calls["execute"])
    assert any("tagging_error" in stmt for stmt in calls["execute"])
    assert any("tag_confidence_threshold" in stmt for stmt in calls["execute"])
    assert any("fn_media_tag_after_delete" in stmt for stmt in calls["execute"])
    assert any("fn_media_tag_after_insert" in stmt for stmt in calls["execute"])
    assert any("fn_bump_version" in stmt for stmt in calls["execute"])
    assert any("ocr_text_override" in stmt for stmt in calls["execute"])
    assert any("version" in stmt for stmt in calls["execute"])
