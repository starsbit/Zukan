from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import logging

import httpx

logger = logging.getLogger(__name__)

_ANILIST_URL = "https://graphql.anilist.co"
_CACHE_TTL = timedelta(minutes=30)


@dataclass
class _CacheEntry:
    expires_at: datetime
    titles: list[str]


@dataclass(frozen=True)
class AniListSeries:
    media_id: int
    preferred_title: str
    titles: list[str]


@dataclass(frozen=True)
class AniListCharacter:
    character_id: int
    preferred_name: str
    names: list[str]


_character_series_cache: dict[tuple[str, str | None], _CacheEntry] = {}

_QUERY = """
query ($name: String) {
  Page(perPage: 5) {
    characters(search: $name) {
      media(perPage: 5) {
        nodes {
          title {
            english
            romaji
          }
        }
      }
    }
  }
}
"""

_VIEWER_QUERY = """
query {
  Viewer {
    name
  }
}
"""

_USER_ANIME_LIST_QUERY = """
query ($userName: String) {
  MediaListCollection(
    userName: $userName,
    type: ANIME,
    status_in: [CURRENT, COMPLETED]
  ) {
    lists {
      entries {
        media {
          id
          title {
            english
            romaji
            native
          }
        }
      }
    }
  }
}
"""

_SERIES_CHARACTERS_QUERY = """
query ($mediaId: Int, $page: Int) {
  Media(id: $mediaId, type: ANIME) {
    characters(page: $page, perPage: 50, sort: [ROLE, RELEVANCE]) {
      pageInfo {
        currentPage
        hasNextPage
      }
      edges {
        role
        node {
          id
          name {
            full
            userPreferred
            native
          }
        }
      }
    }
  }
}
"""


async def search_character_series(character_name: str, *, token: str | None = None) -> list[str]:
    normalized_name = character_name.strip().casefold()
    cache_key = (normalized_name, token)
    now = datetime.now(timezone.utc)
    cached = _character_series_cache.get(cache_key)
    if cached and cached.expires_at > now:
        return list(cached.titles)

    try:
        headers = {"Authorization": f"Bearer {token}"} if token else None
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as client:
            response = await client.post(
                _ANILIST_URL,
                json={"query": _QUERY, "variables": {"name": character_name}},
                headers=headers,
            )
            response.raise_for_status()
            data = response.json()
    except Exception as exc:
        logger.warning("AniList request failed for character %r: %s", character_name, exc)
        return []

    titles: list[str] = []
    seen: set[str] = set()
    try:
        characters = data["data"]["Page"]["characters"]
        for character in characters:
            for node in character["media"]["nodes"]:
                title_obj = node.get("title") or {}
                title = title_obj.get("english") or title_obj.get("romaji")
                if title and title not in seen:
                    seen.add(title)
                    titles.append(title)
    except (KeyError, TypeError) as exc:
        logger.warning("AniList response parse error for character %r: %s", character_name, exc)
        return []

    limited_titles = titles[:3]
    _character_series_cache[cache_key] = _CacheEntry(
        expires_at=now + _CACHE_TTL,
        titles=limited_titles,
    )
    return list(limited_titles)


async def fetch_user_anime_series(*, token: str) -> list[AniListSeries]:
    try:
        viewer_data = await _post_anilist_query(
            query=_VIEWER_QUERY,
            variables=None,
            token=token,
        )
        viewer_name = viewer_data["data"]["Viewer"]["name"]
        data = await _post_anilist_query(
            query=_USER_ANIME_LIST_QUERY,
            variables={"userName": viewer_name},
            token=token,
        )
    except Exception as exc:
        logger.warning("AniList user anime request failed: %s", exc)
        return []

    try:
        lists = data["data"]["MediaListCollection"]["lists"]
    except (KeyError, TypeError) as exc:
        logger.warning("AniList user anime response parse error: %s", exc)
        return []

    series_by_id: dict[int, AniListSeries] = {}
    for media in _iter_media_nodes(lists):
        media_id = media.get("id")
        if not isinstance(media_id, int):
            continue
        titles = _collect_titles(media.get("title"))
        if not titles:
            continue
        if media_id in series_by_id:
            merged = list(dict.fromkeys([*series_by_id[media_id].titles, *titles]))
            series_by_id[media_id] = AniListSeries(
                media_id=media_id,
                preferred_title=merged[0],
                titles=merged,
            )
            continue
        series_by_id[media_id] = AniListSeries(
            media_id=media_id,
            preferred_title=titles[0],
            titles=titles,
        )

    return list(series_by_id.values())


async def fetch_series_characters(*, media_id: int, token: str) -> list[AniListCharacter]:
    page = 1
    characters_by_id: dict[int, AniListCharacter] = {}

    while True:
        try:
            data = await _post_anilist_query(
                query=_SERIES_CHARACTERS_QUERY,
                variables={"mediaId": media_id, "page": page},
                token=token,
            )
            payload = data["data"]["Media"]["characters"]
        except Exception as exc:
            logger.warning("AniList series character request failed for media %r: %s", media_id, exc)
            return []

        try:
            edges = payload["edges"]
            page_info = payload["pageInfo"]
        except (KeyError, TypeError) as exc:
            logger.warning("AniList series character response parse error for media %r: %s", media_id, exc)
            return []

        for edge in edges or []:
            node = edge.get("node") or {}
            character_id = node.get("id")
            if not isinstance(character_id, int):
                continue
            names = _collect_character_names(node.get("name"))
            if not names:
                continue
            existing = characters_by_id.get(character_id)
            if existing is not None:
                merged = list(dict.fromkeys([*existing.names, *names]))
                characters_by_id[character_id] = AniListCharacter(
                    character_id=character_id,
                    preferred_name=merged[0],
                    names=merged,
                )
                continue
            characters_by_id[character_id] = AniListCharacter(
                character_id=character_id,
                preferred_name=names[0],
                names=names,
            )

        if not page_info.get("hasNextPage"):
            break
        page += 1

    return list(characters_by_id.values())


async def _post_anilist_query(
    *,
    query: str,
    variables: dict | None,
    token: str | None,
) -> dict:
    headers = {"Authorization": f"Bearer {token}"} if token else None
    async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as client:
        response = await client.post(
            _ANILIST_URL,
            json={"query": query, "variables": variables or {}},
            headers=headers,
        )
        response.raise_for_status()
        return response.json()


def _iter_media_nodes(lists: list[dict] | None) -> list[dict]:
    nodes: list[dict] = []
    for collection in lists or []:
        for entry in collection.get("entries") or []:
            media = entry.get("media")
            if isinstance(media, dict):
                nodes.append(media)
    return nodes


def _collect_titles(title_obj: dict | None) -> list[str]:
    if not isinstance(title_obj, dict):
        return []
    titles: list[str] = []
    seen: set[str] = set()
    for key in ("english", "romaji", "native"):
        value = title_obj.get(key)
        if not isinstance(value, str):
            continue
        cleaned = value.strip()
        normalized = cleaned.casefold()
        if not cleaned or normalized in seen:
            continue
        seen.add(normalized)
        titles.append(cleaned)
    return titles


def _collect_character_names(name_obj: dict | None) -> list[str]:
    if not isinstance(name_obj, dict):
        return []
    names: list[str] = []
    seen: set[str] = set()
    for key in ("userPreferred", "full", "native"):
        value = name_obj.get(key)
        if not isinstance(value, str):
            continue
        cleaned = value.strip()
        normalized = cleaned.casefold()
        if not cleaned or normalized in seen:
            continue
        seen.add(normalized)
        names.append(cleaned)
    return names
