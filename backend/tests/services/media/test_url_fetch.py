from __future__ import annotations
from unittest.mock import AsyncMock, MagicMock, patch
import pytest
from backend.app.errors.error import AppError
from backend.app.services.media.url_fetch import fetch_url_as_bytes

class _FakeStreamResponse:
    def __init__(self, *, status_code: int = 200, headers: dict | None = None, chunks: list[bytes] | None = None):
        self.status_code = status_code
        self.headers = headers or {}
        self._chunks = chunks or [b"chunk"]

    async def aiter_bytes(self, chunk_size: int = 65536):
        for chunk in self._chunks:
            yield chunk

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc_info):
        return False

def _mock_client(response: _FakeStreamResponse) -> MagicMock:
    client = MagicMock()
    client.stream = MagicMock(return_value=response)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    return client
