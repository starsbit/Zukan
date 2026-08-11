from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from backend.app.errors.error import AppError
from backend.app.services.media.cobalt import cobalt_enabled, resolve_via_cobalt


def _mock_client(response_json: dict) -> AsyncMock:
    response = MagicMock()
    response.json.return_value = response_json
    client = AsyncMock()
    client.post = AsyncMock(return_value=response)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    return client


def test_cobalt_enabled_reflects_configured_url():
    with patch("backend.app.services.media.cobalt.settings") as mock_settings:
        mock_settings.cobalt_api_url = ""
        assert cobalt_enabled() is False

        mock_settings.cobalt_api_url = "https://cobalt.example.com"
        assert cobalt_enabled() is True


@pytest.mark.asyncio
async def test_resolve_via_cobalt_tunnel_status_returns_single_item():
    client = _mock_client({"status": "tunnel", "url": "https://cdn.example.com/video.mp4", "filename": "video.mp4"})

    with patch("backend.app.services.media.cobalt.settings") as mock_settings:
        mock_settings.cobalt_api_url = "https://cobalt.example.com"
        mock_settings.cobalt_api_key = ""
        mock_settings.cobalt_request_timeout_seconds = 20.0

        with patch("backend.app.services.media.cobalt.httpx.AsyncClient", return_value=client):
            items = await resolve_via_cobalt("https://x.com/user/status/123")

    assert len(items) == 1
    assert items[0].url == "https://cdn.example.com/video.mp4"
    assert items[0].filename == "video.mp4"
    sent_headers = client.post.await_args.kwargs["headers"]
    assert "Authorization" not in sent_headers


@pytest.mark.asyncio
async def test_resolve_via_cobalt_sends_api_key_header():
    client = _mock_client({"status": "redirect", "url": "https://cdn.example.com/img.jpg", "filename": None})

    with patch("backend.app.services.media.cobalt.settings") as mock_settings:
        mock_settings.cobalt_api_url = "https://cobalt.example.com"
        mock_settings.cobalt_api_key = "secret-key"
        mock_settings.cobalt_request_timeout_seconds = 20.0

        with patch("backend.app.services.media.cobalt.httpx.AsyncClient", return_value=client):
            await resolve_via_cobalt("https://x.com/user/status/123")

    sent_headers = client.post.await_args.kwargs["headers"]
    assert sent_headers["Authorization"] == "Api-Key secret-key"


@pytest.mark.asyncio
async def test_resolve_via_cobalt_picker_returns_multiple_items():
    client = _mock_client({
        "status": "picker",
        "picker": [
            {"type": "photo", "url": "https://cdn.example.com/1.jpg"},
            {"type": "photo", "url": "https://cdn.example.com/2.jpg"},
        ],
    })

    with patch("backend.app.services.media.cobalt.settings") as mock_settings:
        mock_settings.cobalt_api_url = "https://cobalt.example.com"
        mock_settings.cobalt_api_key = ""
        mock_settings.cobalt_request_timeout_seconds = 20.0

        with patch("backend.app.services.media.cobalt.httpx.AsyncClient", return_value=client):
            items = await resolve_via_cobalt("https://x.com/user/status/123")

    assert [item.url for item in items] == [
        "https://cdn.example.com/1.jpg",
        "https://cdn.example.com/2.jpg",
    ]


@pytest.mark.asyncio
async def test_resolve_via_cobalt_error_status_raises_app_error():
    client = _mock_client({"status": "error", "error": {"code": "error.api.link.invalid"}})

    with patch("backend.app.services.media.cobalt.settings") as mock_settings:
        mock_settings.cobalt_api_url = "https://cobalt.example.com"
        mock_settings.cobalt_api_key = ""
        mock_settings.cobalt_request_timeout_seconds = 20.0

        with patch("backend.app.services.media.cobalt.httpx.AsyncClient", return_value=client):
            with pytest.raises(AppError) as exc_info:
                await resolve_via_cobalt("https://x.com/user/status/123")

    assert "error.api.link.invalid" in exc_info.value.detail["message"]


@pytest.mark.asyncio
async def test_resolve_via_cobalt_network_error_raises_app_error():
    client = AsyncMock()
    client.post = AsyncMock(side_effect=httpx.HTTPError("connection failed"))
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)

    with patch("backend.app.services.media.cobalt.settings") as mock_settings:
        mock_settings.cobalt_api_url = "https://cobalt.example.com"
        mock_settings.cobalt_api_key = ""
        mock_settings.cobalt_request_timeout_seconds = 20.0

        with patch("backend.app.services.media.cobalt.httpx.AsyncClient", return_value=client):
            with pytest.raises(AppError):
                await resolve_via_cobalt("https://x.com/user/status/123")
