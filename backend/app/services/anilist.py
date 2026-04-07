from __future__ import annotations

import asyncio
from collections import Counter
from email.utils import parsedate_to_datetime
import logging
from datetime import datetime, timezone

import httpx

from backend.app.config import settings

logger = logging.getLogger(__name__)

_DEFAULT_HEADERS = {
    "Accept": "application/json",
    "Content-Type": "application/json",
}

_CHARACTER_SEARCH_QUERY = """
query CharacterSearch($search: String!) {
  Page(page: 1, perPage: 8) {
    characters(search: $search, sort: [FAVOURITES_DESC]) {
      id
      name {
        full
        native
        alternative
      }
      media(sort: [POPULARITY_DESC], perPage: 10) {
        nodes {
          type
          format
          title {
            romaji
            english
            native
          }
          recommendations(sort: [RATING_DESC], perPage: 8) {
            nodes {
              mediaRecommendation {
                type
                format
                title {
                  romaji
                  english
                  native
                }
              }
            }
          }
        }
      }
    }
  }
}
"""

_ALLOWED_MEDIA_TYPES = {"ANIME", "MANGA"}
_DISALLOWED_FORMATS = {"MUSIC", "NOVEL", "ONE_SHOT"}


def _normalize_name(value: str | None) -> str:
    return " ".join((value or "").replace("_", " ").casefold().split())


def _pick_title(title: dict | None) -> str | None:
    if not isinstance(title, dict):
        return None
    for key in ("english", "romaji", "native"):
        value = title.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _iter_character_names(character: dict) -> list[str]:
    name = character.get("name")
    if not isinstance(name, dict):
        return []

    values: list[str] = []
    for key in ("full", "native"):
        value = name.get(key)
        if isinstance(value, str) and value.strip():
            values.append(value.strip())
    alternatives = name.get("alternative")
    if isinstance(alternatives, list):
        values.extend(value.strip() for value in alternatives if isinstance(value, str) and value.strip())
    return values


def _is_supported_media(media: dict | None) -> bool:
    if not isinstance(media, dict):
        return False
    media_type = media.get("type")
    media_format = media.get("format")
    return media_type in _ALLOWED_MEDIA_TYPES and media_format not in _DISALLOWED_FORMATS


def _retry_delay_seconds(retry_after: str | None, attempt: int) -> float:
    default_delay = settings.anilist_rate_limit_default_wait_seconds * max(1, attempt)
    delay = default_delay

    if retry_after:
        parsed_delay: float | None = None
        stripped = retry_after.strip()
        try:
            parsed_delay = float(stripped)
        except ValueError:
            try:
                dt = parsedate_to_datetime(stripped)
                if dt is not None:
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=timezone.utc)
                    parsed_delay = (dt - datetime.now(timezone.utc)).total_seconds()
            except (TypeError, ValueError):
                parsed_delay = None
        if parsed_delay is not None:
            delay = max(parsed_delay, settings.anilist_rate_limit_default_wait_seconds)

    return min(delay, settings.anilist_rate_limit_max_wait_seconds)


class AniListService:
    async def find_series_titles_for_character(self, character_name: str) -> list[str]:
        if not settings.anilist_enabled:
            logger.debug("AniList lookup skipped (disabled) character=%s", character_name)
            return []
        if not character_name.strip():
            return []

        logger.info("AniList lookup started character=%s", character_name)
        payload = {
            "query": _CHARACTER_SEARCH_QUERY,
            "variables": {"search": character_name},
        }
        timeout = httpx.Timeout(settings.anilist_timeout_seconds)
        max_attempts = max(1, settings.anilist_rate_limit_retry_attempts + 1)

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response: httpx.Response | None = None
                for attempt in range(1, max_attempts + 1):
                    response = await client.post(
                        settings.anilist_base_url,
                        json=payload,
                        headers=_DEFAULT_HEADERS,
                    )
                    if response.status_code != 429:
                        break

                    retry_after = response.headers.get("Retry-After")
                    if attempt >= max_attempts:
                        logger.warning(
                            "AniList rate limit exhausted character=%s attempts=%d retry_after=%s",
                            character_name,
                            max_attempts,
                            retry_after or "unknown",
                        )
                        return []

                    delay_seconds = _retry_delay_seconds(retry_after, attempt)
                    logger.warning(
                        "AniList rate limit hit character=%s attempt=%d/%d retry_after=%s waiting_seconds=%.2f",
                        character_name,
                        attempt,
                        max_attempts,
                        retry_after or "unknown",
                        delay_seconds,
                    )
                    await asyncio.sleep(delay_seconds)

                if response is None:
                    return []
                response.raise_for_status()
        except httpx.HTTPError as exc:
            logger.warning("AniList lookup failed character=%s error=%s", character_name, exc)
            return []

        body = response.json()
        if not isinstance(body, dict):
            logger.warning("AniList returned non-dict body character=%s", character_name)
            return []
        if body.get("errors"):
            logger.warning("AniList returned GraphQL errors character=%s errors=%s", character_name, body["errors"])
            return []

        page = body.get("data", {}).get("Page", {})
        characters = page.get("characters") if isinstance(page, dict) else None
        if not isinstance(characters, list):
            logger.debug("AniList returned no characters list character=%s", character_name)
            return []

        logger.debug("AniList returned %d candidate(s) character=%s", len(characters), character_name)

        normalized_target = _normalize_name(character_name)
        target_tokens = frozenset(normalized_target.split())
        exact_match = next(
            (
                character
                for character in characters
                if isinstance(character, dict)
                and any(
                    frozenset(_normalize_name(name).split()) == target_tokens
                    for name in _iter_character_names(character)
                    if _normalize_name(name)
                )
            ),
            None,
        )
        if exact_match is None:
            candidate_names = [
                _iter_character_names(c) for c in characters if isinstance(c, dict)
            ]
            logger.info(
                "AniList found no token match character=%s normalized=%s candidates=%s",
                character_name,
                normalized_target,
                candidate_names,
            )
            return []

        scores: Counter[str] = Counter()
        media_connection = exact_match.get("media")
        media_nodes = media_connection.get("nodes") if isinstance(media_connection, dict) else None
        if not isinstance(media_nodes, list):
            logger.debug("AniList matched character has no media nodes character=%s", character_name)
            return []

        logger.debug("AniList matched character has %d media node(s) character=%s", len(media_nodes), character_name)

        for media in media_nodes:
            if not _is_supported_media(media):
                logger.debug(
                    "AniList skipping unsupported media type=%s format=%s character=%s",
                    media.get("type") if isinstance(media, dict) else None,
                    media.get("format") if isinstance(media, dict) else None,
                    character_name,
                )
                continue
            title = _pick_title(media.get("title"))
            if title:
                scores[title] += 3

            recommendations = media.get("recommendations")
            recommendation_nodes = recommendations.get("nodes") if isinstance(recommendations, dict) else None
            if not isinstance(recommendation_nodes, list):
                continue
            for node in recommendation_nodes:
                if not isinstance(node, dict):
                    continue
                recommended_media = node.get("mediaRecommendation")
                if not _is_supported_media(recommended_media):
                    continue
                recommendation_title = _pick_title(recommended_media.get("title"))
                if recommendation_title:
                    scores[recommendation_title] += 1

        result = [title for title, _ in scores.most_common()]
        logger.info("AniList lookup finished character=%s titles=%s", character_name, result)
        return result
