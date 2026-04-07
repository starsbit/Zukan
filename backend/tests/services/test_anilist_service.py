from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest

from backend.app.services.anilist import AniListService


class _MockResponse:
    def __init__(self, payload: dict, status_code: int = 200):
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self) -> None:
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
