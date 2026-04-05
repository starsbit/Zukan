from __future__ import annotations

import pytest
import respx
import httpx

from backend.app.services.anilist import (
    _ANILIST_URL,
    _character_series_cache,
    fetch_series_characters,
    fetch_user_anime_series,
    search_character_series,
)


@pytest.fixture(autouse=True)
def clear_character_series_cache():
    _character_series_cache.clear()
    yield
    _character_series_cache.clear()


@pytest.mark.asyncio
@respx.mock
async def test_search_character_series_returns_titles():
    respx.post(_ANILIST_URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "data": {
                    "Page": {
                        "characters": [
                            {
                                "media": {
                                    "nodes": [
                                        {"title": {"english": "Fate/stay night", "romaji": "Fate/stay night"}},
                                        {"title": {"english": None, "romaji": "Fate/Zero"}},
                                    ]
                                }
                            }
                        ]
                    }
                }
            },
        )
    )

    result = await search_character_series("Saber", token="test-token")

    assert result == ["Fate/stay night", "Fate/Zero"]


@pytest.mark.asyncio
@respx.mock
async def test_search_character_series_prefers_english_over_romaji():
    respx.post(_ANILIST_URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "data": {
                    "Page": {
                        "characters": [
                            {
                                "media": {
                                    "nodes": [
                                        {"title": {"english": "Steins;Gate", "romaji": "Steins;Gate"}},
                                    ]
                                }
                            }
                        ]
                    }
                }
            },
        )
    )

    result = await search_character_series("Kurisu", token="test-token")

    assert result == ["Steins;Gate"]


@pytest.mark.asyncio
@respx.mock
async def test_search_character_series_falls_back_to_romaji_when_no_english():
    respx.post(_ANILIST_URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "data": {
                    "Page": {
                        "characters": [
                            {
                                "media": {
                                    "nodes": [
                                        {"title": {"english": None, "romaji": "Mahoutsukai no Yome"}},
                                    ]
                                }
                            }
                        ]
                    }
                }
            },
        )
    )

    result = await search_character_series("Chise", token="test-token")

    assert result == ["Mahoutsukai no Yome"]


@pytest.mark.asyncio
@respx.mock
async def test_search_character_series_deduplicates_titles():
    respx.post(_ANILIST_URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "data": {
                    "Page": {
                        "characters": [
                            {
                                "media": {
                                    "nodes": [
                                        {"title": {"english": "Fate/stay night", "romaji": "Fate/stay night"}},
                                        {"title": {"english": "Fate/stay night", "romaji": "Fate/stay night"}},
                                        {"title": {"english": "Fate/Zero", "romaji": "Fate/Zero"}},
                                    ]
                                }
                            }
                        ]
                    }
                }
            },
        )
    )

    result = await search_character_series("Saber", token="test-token")

    assert result == ["Fate/stay night", "Fate/Zero"]


@pytest.mark.asyncio
@respx.mock
async def test_search_character_series_caps_at_three():
    respx.post(_ANILIST_URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "data": {
                    "Page": {
                        "characters": [
                            {
                                "media": {
                                    "nodes": [
                                        {"title": {"english": "Series A", "romaji": "Series A"}},
                                        {"title": {"english": "Series B", "romaji": "Series B"}},
                                        {"title": {"english": "Series C", "romaji": "Series C"}},
                                        {"title": {"english": "Series D", "romaji": "Series D"}},
                                    ]
                                }
                            }
                        ]
                    }
                }
            },
        )
    )

    result = await search_character_series("Char", token="test-token")

    assert len(result) == 3


@pytest.mark.asyncio
@respx.mock
async def test_search_character_series_returns_empty_on_http_error():
    respx.post(_ANILIST_URL).mock(return_value=httpx.Response(429))

    result = await search_character_series("Saber", token="test-token")

    assert result == []


@pytest.mark.asyncio
@respx.mock
async def test_search_character_series_returns_empty_on_network_error():
    respx.post(_ANILIST_URL).mock(side_effect=httpx.ConnectError("refused"))

    result = await search_character_series("Saber", token="test-token")

    assert result == []


@pytest.mark.asyncio
@respx.mock
async def test_search_character_series_returns_empty_on_malformed_response():
    respx.post(_ANILIST_URL).mock(
        return_value=httpx.Response(200, json={"data": {"Page": {"unexpected": "shape"}}})
    )

    result = await search_character_series("Saber", token="test-token")

    assert result == []


@pytest.mark.asyncio
@respx.mock
async def test_search_character_series_sends_auth_header():
    route = respx.post(_ANILIST_URL).mock(
        return_value=httpx.Response(200, json={"data": {"Page": {"characters": []}}})
    )

    await search_character_series("Saber", token="my-secret-token")

    assert route.called
    assert route.calls[0].request.headers["Authorization"] == "Bearer my-secret-token"


@pytest.mark.asyncio
@respx.mock
async def test_search_character_series_works_without_auth_header():
    route = respx.post(_ANILIST_URL).mock(
        return_value=httpx.Response(200, json={"data": {"Page": {"characters": []}}})
    )

    await search_character_series("Saber")

    assert route.called
    assert "Authorization" not in route.calls[0].request.headers


@pytest.mark.asyncio
@respx.mock
async def test_fetch_user_anime_series_returns_current_and_completed_titles():
    respx.post(_ANILIST_URL).mock(
        side_effect=[
            httpx.Response(200, json={"data": {"Viewer": {"name": "alice"}}}),
            httpx.Response(
                200,
                json={
                    "data": {
                        "MediaListCollection": {
                            "lists": [
                                {
                                    "entries": [
                                        {"media": {"id": 1, "title": {"english": "Fate/Zero", "romaji": "Fate/Zero", "native": "\u30d5\u30a7\u30a4\u30c8/\u30bc\u30ed"}}},
                                        {"media": {"id": 2, "title": {"english": None, "romaji": "Mahoutsukai no Yome", "native": None}}},
                                    ]
                                }
                            ]
                        }
                    }
                },
            ),
        ]
    )

    result = await fetch_user_anime_series(token="secret")

    assert [item.media_id for item in result] == [1, 2]
    assert result[0].preferred_title == "Fate/Zero"
    assert result[0].titles == ["Fate/Zero", "\u30d5\u30a7\u30a4\u30c8/\u30bc\u30ed"]
    assert result[1].titles == ["Mahoutsukai no Yome"]


@pytest.mark.asyncio
@respx.mock
async def test_fetch_user_anime_series_deduplicates_by_media_id():
    respx.post(_ANILIST_URL).mock(
        side_effect=[
            httpx.Response(200, json={"data": {"Viewer": {"name": "alice"}}}),
            httpx.Response(
                200,
                json={
                    "data": {
                        "MediaListCollection": {
                            "lists": [
                                {
                                    "entries": [
                                        {"media": {"id": 7, "title": {"english": "Steins;Gate", "romaji": "Steins;Gate", "native": None}}},
                                        {"media": {"id": 7, "title": {"english": None, "romaji": "Shutainzu Geeto", "native": None}}},
                                    ]
                                }
                            ]
                        }
                    }
                },
            ),
        ]
    )

    result = await fetch_user_anime_series(token="secret")

    assert len(result) == 1
    assert result[0].titles == ["Steins;Gate", "Shutainzu Geeto"]


@pytest.mark.asyncio
@respx.mock
async def test_fetch_series_characters_returns_all_character_names():
    respx.post(_ANILIST_URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "data": {
                    "Media": {
                        "characters": {
                            "pageInfo": {"currentPage": 1, "hasNextPage": False},
                            "edges": [
                                {"role": "MAIN", "node": {"id": 1, "name": {"userPreferred": "Saber", "full": "Artoria Pendragon", "native": None}}},
                                {"role": "SUPPORTING", "node": {"id": 2, "name": {"userPreferred": "Rin Tohsaka", "full": "Rin Tohsaka", "native": None}}},
                            ],
                        }
                    }
                }
            },
        )
    )

    result = await fetch_series_characters(media_id=100, token="secret")

    assert [item.character_id for item in result] == [1, 2]
    assert result[0].names == ["Saber", "Artoria Pendragon"]


@pytest.mark.asyncio
@respx.mock
async def test_search_character_series_reuses_process_local_cache():
    route = respx.post(_ANILIST_URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "data": {
                    "Page": {
                        "characters": [
                            {
                                "media": {
                                    "nodes": [
                                        {"title": {"english": "Fate/stay night", "romaji": "Fate/stay night"}},
                                    ]
                                }
                            }
                        ]
                    }
                }
            },
        )
    )

    first = await search_character_series("Saber", token="test-token")
    second = await search_character_series("Saber", token="test-token")

    assert first == ["Fate/stay night"]
    assert second == ["Fate/stay night"]
    assert route.call_count == 1
