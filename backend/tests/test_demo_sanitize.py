from __future__ import annotations

from types import SimpleNamespace

import pytest

from backend.app.config import settings
from backend.app.demo_sanitize import DemoSanitizeError, sanitize_demo_connection


class _RecordingConn:
    def __init__(self):
        self.statements: list[str] = []

    async def execute(self, statement):
        self.statements.append(" ".join(str(statement).split()))
        return SimpleNamespace(rowcount=3)


@pytest.mark.anyio
async def test_refuses_outside_demo_mode(monkeypatch):
    monkeypatch.setattr(settings, "demo_mode", False)
    conn = _RecordingConn()
    with pytest.raises(DemoSanitizeError):
        await sanitize_demo_connection(conn)
    assert conn.statements == []


@pytest.mark.anyio
async def test_runs_every_step_with_unsafe_media_first(monkeypatch):
    monkeypatch.setattr(settings, "demo_mode", True)
    conn = _RecordingConn()
    removed = await sanitize_demo_connection(conn)
    sql = conn.statements
    assert "pg_advisory_xact_lock" in sql[0]
    assert sql[1].startswith("DELETE FROM media WHERE deleted_at IS NOT NULL")
    assert "COALESCE(is_nsfw_override, is_nsfw)" in sql[1]
    assert "COALESCE(is_sensitive_override, is_sensitive)" in sql[1]
    joined = "\n".join(sql)
    for table in (
        "auth_exchanges",
        "refresh_tokens",
        "auth_sessions",
        "api_keys",
        "notifications",
        "import_batches",
        "storage_migrations",
    ):
        assert f"DELETE FROM {table}" in joined
    assert "UPDATE users SET username = 'demo'" in joined
    assert "show_nsfw = false" in joined
    assert "ingest_interval_seconds = 0" in joined
    assert removed == {"media": 3, "tags": 3, "entities": 3, "albums": 3}
