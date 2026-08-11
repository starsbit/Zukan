from __future__ import annotations

from dataclasses import dataclass

import httpx

from backend.app.config import settings
from backend.app.errors.error import AppError
from backend.app.errors.upload import cobalt_resolve_failed, cobalt_unsupported_result


@dataclass
class CobaltMediaItem:
    url: str
    filename: str | None = None


def cobalt_enabled() -> bool:
    return bool(settings.cobalt_api_url)


async def resolve_via_cobalt(url: str) -> list[CobaltMediaItem]:
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if settings.cobalt_api_key:
        headers["Authorization"] = f"Api-Key {settings.cobalt_api_key}"

    endpoint = settings.cobalt_api_url.rstrip("/") + "/"
    try:
        async with httpx.AsyncClient(timeout=settings.cobalt_request_timeout_seconds) as client:
            response = await client.post(endpoint, json={"url": url}, headers=headers)
            body = response.json()
    except httpx.HTTPError as exc:
        raise AppError(502, cobalt_resolve_failed, f"Failed to reach cobalt instance: {exc}") from exc
    except ValueError as exc:
        raise AppError(502, cobalt_resolve_failed, "Cobalt instance returned an invalid response") from exc

    status = body.get("status")

    if status in ("tunnel", "redirect"):
        media_url = body.get("url")
        if not media_url:
            raise AppError(422, cobalt_unsupported_result, "Cobalt did not return a media URL")
        return [CobaltMediaItem(url=media_url, filename=body.get("filename"))]

    if status == "picker":
        items = [item["url"] for item in body.get("picker") or [] if item.get("url")]
        if not items:
            raise AppError(422, cobalt_unsupported_result, "No downloadable media found at that URL")
        return [CobaltMediaItem(url=item_url) for item_url in items]

    if status == "error":
        error = body.get("error") or {}
        code = error.get("code", "unknown_error")
        raise AppError(422, cobalt_resolve_failed, f"Cobalt could not resolve this URL: {code}")

    raise AppError(422, cobalt_unsupported_result, f"Unsupported cobalt response status: {status}")
