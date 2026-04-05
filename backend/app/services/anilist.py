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
