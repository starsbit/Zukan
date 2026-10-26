from __future__ import annotations
import pytest
from backend.app.config import settings
from backend.app.routers.config import get_upload_config
from backend.app.routers.config import get_setup_required

class _FakeResult:
    def __init__(self, value: bool) -> None:
        self._value = value

    def scalar(self) -> bool:
        return self._value

class _FakeDB:
    def __init__(self, values: list[bool]) -> None:
        self._values = iter(values)

    async def execute(self, _query):
        return _FakeResult(next(self._values))

@pytest.mark.anyio
async def test_get_upload_config_returns_max_batch_size(monkeypatch):
    monkeypatch.setattr(settings, "upload_max_batch_size", 1000)

    response = await get_upload_config()

    assert response.max_batch_size == 1000
