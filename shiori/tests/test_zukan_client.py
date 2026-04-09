from __future__ import annotations

import httpx
import pytest

from shiori.app.config import Settings
from shiori.app.models import RuntimeConfig
from shiori.app.zukan_client import ZukanClient


@pytest.mark.asyncio
async def test_upload_media_and_attach_external_ref():
    calls: list[tuple[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append((request.method, request.url.path))
        if request.method == "POST" and request.url.path == "/api/v1/media":
            return httpx.Response(
                202,
                json={
                    "results": [
                        {
                            "id": "media-1",
                            "status": "accepted",
                            "original_filename": "a.jpg",
                        }
                    ]
                },
            )
        if request.method == "GET" and request.url.path == "/api/v1/media/media-1":
            return httpx.Response(
                200,
                json={"id": "media-1", "version": 3, "external_refs": []},
            )
        if request.method == "PATCH" and request.url.path == "/api/v1/media/media-1":
            return httpx.Response(200, json={"id": "media-1"})
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="http://zukan")
    zukan = ZukanClient(Settings(zukan_base_url="http://zukan", zukan_token="token"), client=client)

    runtime = RuntimeConfig(
        zukan_base_url="http://zukan",
        zukan_token="token",
        twitter_auth_token="",
        twitter_ct0="",
        twitter_bearer_token="",
        twitter_user_id="",
        sync_interval_seconds=900,
        default_visibility="private",
        default_tags=[],
    )

    result = await zukan.upload_media(
        config=runtime,
        filename="a.jpg",
        content=b"abc",
        content_type="image/jpeg",
        visibility="private",
        tags=["safe"],
    )
    await zukan.attach_external_ref(
        config=runtime,
        media_id=result["id"],
        provider="twitter",
        external_id="tweet-1",
        url="https://x.com/a/status/tweet-1",
    )

    assert result["id"] == "media-1"
    assert calls == [
        ("POST", "/api/v1/media"),
        ("GET", "/api/v1/media/media-1"),
        ("PATCH", "/api/v1/media/media-1"),
    ]

    await client.aclose()


@pytest.mark.asyncio
async def test_probe_reports_auth_failure():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"detail": "bad token"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="http://zukan")
    zukan = ZukanClient(Settings(zukan_base_url="http://zukan", zukan_token="token"), client=client)

    runtime = RuntimeConfig(
        zukan_base_url="http://zukan",
        zukan_token="token",
        twitter_auth_token="",
        twitter_ct0="",
        twitter_bearer_token="",
        twitter_user_id="",
        sync_interval_seconds=900,
        default_visibility="private",
        default_tags=[],
    )
    assert await zukan.probe(runtime) is False

    await client.aclose()
