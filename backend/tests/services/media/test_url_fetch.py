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


@pytest.mark.asyncio
async def test_fetch_url_as_bytes_blocks_private_address_by_default():
    with pytest.raises(AppError):
        await fetch_url_as_bytes("http://192.168.178.102:9000/tunnel?id=1", max_size_bytes=1024)


@pytest.mark.asyncio
async def test_fetch_url_as_bytes_trusted_skips_ssrf_guard_for_private_address():
    response = _FakeStreamResponse(chunks=[b"GIF89a", b"restofthegif"])
    client = _mock_client(response)

    with patch("backend.app.services.media.url_fetch.httpx.AsyncClient", return_value=client):
        content, mime_type = await fetch_url_as_bytes(
            "http://192.168.178.102:9000/tunnel?id=1",
            max_size_bytes=1024,
            trusted=True,
        )

    assert content == b"GIF89arestofthegif"
    assert mime_type is None


@pytest.mark.asyncio
async def test_fetch_url_as_bytes_untrusted_public_url_still_works():
    response = _FakeStreamResponse(headers={"content-type": "image/gif"}, chunks=[b"GIF89a"])
    client = _mock_client(response)
    public_addrinfo = [(2, 1, 6, "", ("93.184.216.34", 0))]

    with patch(
        "backend.app.services.media.url_fetch.socket.getaddrinfo", return_value=public_addrinfo,
    ), patch("backend.app.services.media.url_fetch.httpx.AsyncClient", return_value=client):
        content, mime_type = await fetch_url_as_bytes(
            "https://cdn.example.com/image.gif",
            max_size_bytes=1024,
        )

    assert content == b"GIF89a"
    assert mime_type == "image/gif"
