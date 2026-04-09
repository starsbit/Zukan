from __future__ import annotations

import json
from datetime import datetime
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.parse import urlparse

import httpx

from shiori.app.config import Settings
from shiori.app.models import LikedTweet, RuntimeConfig, TweetMedia


def build_canonical_tweet_url(author_handle: str, tweet_id: str) -> str:
    return f"https://x.com/{author_handle}/status/{tweet_id}"


def _parse_created_at(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None


def _guess_filename(url: str, fallback: str) -> str:
    parsed = urlparse(url)
    name = parsed.path.rstrip("/").split("/")[-1]
    return name or fallback


def _pick_video_variant(media: dict[str, Any]) -> tuple[str | None, str | None]:
    video_info = media.get("video_info") or {}
    variants = video_info.get("variants") or []
    viable = [
        variant for variant in variants
        if variant.get("url") and variant.get("content_type") in {"video/mp4", "application/x-mpegURL"}
    ]
    viable.sort(key=lambda item: item.get("bitrate", -1), reverse=True)
    if not viable:
        return None, None
    winner = viable[0]
    return winner.get("url"), winner.get("content_type")


def _extract_media_items(legacy_tweet: dict[str, Any]) -> list[TweetMedia]:
    media_items = ((legacy_tweet.get("extended_entities") or {}).get("media")) or ((legacy_tweet.get("entities") or {}).get("media")) or []
    extracted: list[TweetMedia] = []
    for index, media in enumerate(media_items):
        media_type = media.get("type") or "unknown"
        if media_type == "photo":
            url = media.get("media_url_https") or media.get("media_url")
            if not url:
                continue
            if "name=" not in url:
                url = f"{url}?name=orig"
            extracted.append(
                TweetMedia(
                    media_index=index,
                    media_url=url,
                    media_type="photo",
                    filename=_guess_filename(url, f"{media.get('id_str', index)}.jpg"),
                    content_type="image/jpeg",
                )
            )
            continue

        if media_type in {"video", "animated_gif"}:
            url, content_type = _pick_video_variant(media)
            if not url:
                continue
            extracted.append(
                TweetMedia(
                    media_index=index,
                    media_url=url,
                    media_type=media_type,
                    filename=_guess_filename(url, f"{media.get('id_str', index)}.mp4"),
                    content_type=content_type,
                )
            )
    return extracted


def _walk_for_tweet_results(node: Any) -> list[dict[str, Any]]:
    matches: list[dict[str, Any]] = []
    if isinstance(node, dict):
        typename = node.get("__typename")
        result = node.get("result")
        if typename == "Tweet" and node.get("legacy"):
            matches.append(node)
        elif isinstance(result, dict) and result.get("__typename") == "Tweet" and result.get("legacy"):
            matches.append(result)
        for value in node.values():
            matches.extend(_walk_for_tweet_results(value))
    elif isinstance(node, list):
        for value in node:
            matches.extend(_walk_for_tweet_results(value))
    return matches


def parse_likes_response(payload: dict[str, Any]) -> tuple[list[LikedTweet], str | None]:
    tweets: list[LikedTweet] = []
    seen_ids: set[str] = set()
    for result in _walk_for_tweet_results(payload):
        legacy_tweet = result.get("legacy") or {}
        tweet_id = result.get("rest_id") or legacy_tweet.get("id_str")
        if not tweet_id or tweet_id in seen_ids:
            continue
        core = result.get("core") or {}
        user_result = ((core.get("user_results") or {}).get("result")) or {}
        user_legacy = user_result.get("legacy") or {}
        author_handle = user_legacy.get("screen_name")
        if not author_handle:
            continue
        media = _extract_media_items(legacy_tweet)
        if not media:
            continue
        seen_ids.add(tweet_id)
        tweets.append(
            LikedTweet(
                tweet_id=tweet_id,
                author_handle=author_handle,
                tweet_url=build_canonical_tweet_url(author_handle, tweet_id),
                created_at=_parse_created_at(legacy_tweet.get("created_at")),
                media=media,
            )
        )

    cursor: str | None = None
    instructions = (
        payload.get("data", {})
        .get("user", {})
        .get("result", {})
        .get("timeline_v2", {})
        .get("timeline", {})
        .get("instructions", [])
    )
    for instruction in instructions:
        entries = instruction.get("entries") or []
        for entry in entries:
            entry_id = entry.get("entryId", "")
            if "cursor-bottom" not in entry_id:
                continue
            content = entry.get("content") or {}
            cursor_value = content.get("value")
            if cursor_value:
                cursor = cursor_value
    return tweets, cursor


class CookieTwitterClient:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self._settings = settings
        self._client = client or httpx.AsyncClient(timeout=settings.request_timeout_seconds)
        self._owns_client = client is None

    async def close(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def fetch_liked_tweets(self, config: RuntimeConfig) -> list[LikedTweet]:
        tweets: list[LikedTweet] = []
        cursor: str | None = None
        for _ in range(self._settings.twitter_max_pages_per_run):
            page, cursor = await self._fetch_likes_page(config=config, cursor=cursor)
            tweets.extend(page)
            if not cursor:
                break
        return tweets

    async def _fetch_likes_page(self, *, config: RuntimeConfig, cursor: str | None) -> tuple[list[LikedTweet], str | None]:
        if not config.twitter_auth_token or not config.twitter_ct0 or not config.twitter_user_id:
            raise RuntimeError("Twitter credentials are incomplete")
        variables = {
            "userId": config.twitter_user_id,
            "count": self._settings.twitter_page_size,
            "includePromotedContent": False,
            "withClientEventToken": False,
            "withBirdwatchNotes": False,
            "withVoice": True,
            "withV2Timeline": True,
        }
        if cursor:
            variables["cursor"] = cursor
        features = {
            "responsive_web_graphql_exclude_directive_enabled": True,
            "verified_phone_label_enabled": False,
            "responsive_web_graphql_skip_user_profile_image_extensions_enabled": False,
            "responsive_web_graphql_timeline_navigation_enabled": True,
        }
        response = await self._client.get(
            f"{self._settings.twitter_api_base_url}/i/api/graphql/{self._settings.twitter_likes_query_id}/Likes",
            params={
                "variables": json.dumps(variables, separators=(",", ":")),
                "features": json.dumps(features, separators=(",", ":")),
            },
            headers={
                "Authorization": f"Bearer {self._settings.twitter_bearer_token}",
                "X-Csrf-Token": config.twitter_ct0,
                "X-Twitter-Active-User": "yes",
                "X-Twitter-Auth-Type": "OAuth2Session",
                "Cookie": f"auth_token={config.twitter_auth_token}; ct0={config.twitter_ct0}",
            },
        )
        response.raise_for_status()
        return parse_likes_response(response.json())

    async def download_media(self, media_url: str) -> bytes:
        response = await self._client.get(media_url)
        response.raise_for_status()
        return response.content

    async def probe(self, config: RuntimeConfig) -> bool:
        try:
            await self._fetch_likes_page(config=config, cursor=None)
        except Exception:
            return False
        return True


TwitterClient = CookieTwitterClient
