from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from backend.app.services.anilist import AniListService


class _MockResponse:
    def __init__(self, payload: dict, status_code: int = 200, headers: dict[str, str] | None = None):
        self._payload = payload
        self.status_code = status_code
        self.headers = headers or {}

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            request = httpx.Request("POST", "https://graphql.anilist.co")
            response = httpx.Response(self.status_code, request=request)
            raise httpx.HTTPStatusError("status error", request=request, response=response)
        return None

    def json(self) -> dict:
        return self._payload


@pytest.mark.asyncio
async def test_anilist_service_returns_titles_for_exact_character_match():
    payload = {
        "data": {
            "Page": {
                "characters": [
                    {
                        "name": {
                            "full": "Saber",
                            "native": "セイバー",
                            "alternative": ["Artoria Pendragon"],
                        },
                        "media": {
                            "nodes": [
                                {
                                    "type": "ANIME",
                                    "format": "TV",
                                    "title": {
                                        "english": "Fate/stay night",
                                        "romaji": "Fate/stay night",
                                        "native": "Fate/stay night",
                                    },
                                    "recommendations": {
                                        "nodes": [
                                            {
                                                "mediaRecommendation": {
                                                    "type": "ANIME",
                                                    "format": "TV",
                                                    "title": {
                                                        "english": "Fate/Zero",
                                                        "romaji": "Fate/Zero",
                                                        "native": "Fate/Zero",
                                                    },
                                                }
                                            }
                                        ]
                                    },
                                }
                            ]
                        },
                    }
                ]
            }
        }
    }

    with patch("backend.app.services.anilist.httpx.AsyncClient") as client_cls:
        client = client_cls.return_value.__aenter__.return_value
        client.post.return_value = _MockResponse(payload)

        result = await AniListService().find_series_titles_for_character("saber")

    assert result[:2] == ["Fate/stay night", "Fate/Zero"]


@pytest.mark.asyncio
async def test_anilist_service_ignores_ambiguous_non_exact_matches():
    payload = {
        "data": {
            "Page": {
                "characters": [
                    {
                        "name": {"full": "Saber Alter", "native": None, "alternative": []},
                        "media": {"nodes": []},
                    }
                ]
            }
        }
    }

    with patch("backend.app.services.anilist.httpx.AsyncClient") as client_cls:
        client = client_cls.return_value.__aenter__.return_value
        client.post.return_value = _MockResponse(payload)

        result = await AniListService().find_series_titles_for_character("Saber")

    assert result == []


@pytest.mark.asyncio
async def test_anilist_service_returns_empty_on_http_error():
    with patch("backend.app.services.anilist.httpx.AsyncClient") as client_cls:
        client = client_cls.return_value.__aenter__.return_value
        client.post.side_effect = httpx.ReadTimeout("timeout")

        result = await AniListService().find_series_titles_for_character("Saber")

    assert result == []


@pytest.mark.asyncio
async def test_anilist_service_retries_after_rate_limit_then_succeeds():
    payload = {
        "data": {
            "Page": {
                "characters": [
                    {
                        "name": {"full": "Saber", "native": None, "alternative": []},
                        "media": {
                            "nodes": [
                                {
                                    "type": "ANIME",
                                    "format": "TV",
                                    "title": {
                                        "english": "Fate/stay night",
                                        "romaji": "Fate/stay night",
                                        "native": "Fate/stay night",
                                    },
                                    "recommendations": {"nodes": []},
                                }
                            ]
                        },
                    }
                ]
            }
        }
    }

    with patch("backend.app.services.anilist.httpx.AsyncClient") as client_cls, \
         patch("backend.app.services.anilist.asyncio.sleep", new=AsyncMock()) as sleep_mock, \
         patch("backend.app.services.anilist.settings", new=SimpleNamespace(
             anilist_enabled=True,
             anilist_timeout_seconds=5.0,
             anilist_base_url="https://graphql.anilist.co",
             anilist_rate_limit_retry_attempts=2,
             anilist_rate_limit_default_wait_seconds=1.0,
             anilist_rate_limit_max_wait_seconds=30.0,
         )):
        client = client_cls.return_value.__aenter__.return_value
        client.post.side_effect = [
            _MockResponse({}, status_code=429, headers={"Retry-After": "1"}),
            _MockResponse(payload, status_code=200),
        ]

        result = await AniListService().find_series_titles_for_character("Saber")

    assert result == ["Fate/stay night"]
    assert client.post.call_count == 2
    sleep_mock.assert_awaited_once_with(1.0)


@pytest.mark.asyncio
async def test_anilist_service_returns_empty_when_rate_limit_retries_exhausted():
    with patch("backend.app.services.anilist.httpx.AsyncClient") as client_cls, \
         patch("backend.app.services.anilist.asyncio.sleep", new=AsyncMock()) as sleep_mock, \
         patch("backend.app.services.anilist.settings", new=SimpleNamespace(
             anilist_enabled=True,
             anilist_timeout_seconds=5.0,
             anilist_base_url="https://graphql.anilist.co",
             anilist_rate_limit_retry_attempts=2,
             anilist_rate_limit_default_wait_seconds=1.0,
             anilist_rate_limit_max_wait_seconds=30.0,
         )):
        client = client_cls.return_value.__aenter__.return_value
        client.post.side_effect = [
            _MockResponse({}, status_code=429, headers={"Retry-After": "1"}),
            _MockResponse({}, status_code=429, headers={"Retry-After": "1"}),
            _MockResponse({}, status_code=429, headers={"Retry-After": "1"}),
        ]

        result = await AniListService().find_series_titles_for_character("Saber")

    assert result == []
    assert client.post.call_count == 3
    assert sleep_mock.await_count == 2
