from __future__ import annotations

from typing import Any

import httpx
from httpx._multipart import MultipartStream

from shiori.app.config import Settings
from shiori.app.models import RuntimeConfig


class ZukanClient:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self._settings = settings
        self._client = client or httpx.AsyncClient(
            base_url=settings.zukan_base_url.rstrip("/"),
            timeout=settings.request_timeout_seconds,
        )
        self._owns_client = client is None

    async def close(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    def _headers(self) -> dict[str, str]:
        return {}

    def _headers_for(self, config: RuntimeConfig) -> dict[str, str]:
        headers: dict[str, str] = {}
        if config.zukan_token:
            headers["Authorization"] = f"Bearer {config.zukan_token}"
        return headers

    async def probe(self, config: RuntimeConfig) -> bool:
        try:
            response = await self._client.get(
                f"{config.zukan_base_url.rstrip('/')}/api/v1/me",
                headers=self._headers_for(config),
            )
            response.raise_for_status()
        except Exception:
            return False
        return True

    async def upload_media(
        self,
        *,
        config: RuntimeConfig,
        filename: str,
        content: bytes,
        content_type: str,
        visibility: str,
        tags: list[str],
    ) -> dict[str, Any]:
        data: dict[str, str | list[str]] = {"visibility": visibility}
        if tags:
            data["tags"] = tags
        multipart = MultipartStream(
            data=data,
            files=[("files", (filename, content, content_type))],
        )
        headers = self._headers_for(config)
        headers.update(multipart.get_headers())
        request = self._client.build_request("POST", f"{config.zukan_base_url.rstrip('/')}/api/v1/media", headers=headers)
        request.stream = multipart
        response = await self._client.send(request)
        response.raise_for_status()
        payload = response.json()
        results = payload.get("results") or []
        if not results:
            raise RuntimeError("Zukan upload returned no results")
        return results[0]

    async def get_media_detail(self, config: RuntimeConfig, media_id: str) -> dict[str, Any]:
        response = await self._client.get(
            f"{config.zukan_base_url.rstrip('/')}/api/v1/media/{media_id}",
            headers=self._headers_for(config),
        )
        response.raise_for_status()
        return response.json()

    async def attach_external_ref(
        self,
        *,
        config: RuntimeConfig,
        media_id: str,
        provider: str,
        external_id: str,
        url: str,
    ) -> dict[str, Any]:
        detail = await self.get_media_detail(config, media_id)
        refs = list(detail.get("external_refs") or [])
        if not any(ref.get("provider") == provider and ref.get("external_id") == external_id for ref in refs):
            refs.append(
                {
                    "provider": provider,
                    "external_id": external_id,
                    "url": url,
                }
            )
        response = await self._client.patch(
            f"{config.zukan_base_url.rstrip('/')}/api/v1/media/{media_id}",
            headers=self._headers_for(config),
            json={
                "version": detail["version"],
                "external_refs": refs,
            },
        )
        if response.status_code == 409:
            detail = await self.get_media_detail(config, media_id)
            refs = list(detail.get("external_refs") or [])
            if not any(ref.get("provider") == provider and ref.get("external_id") == external_id for ref in refs):
                refs.append(
                    {
                        "provider": provider,
                        "external_id": external_id,
                        "url": url,
                    }
                )
            response = await self._client.patch(
                f"{config.zukan_base_url.rstrip('/')}/api/v1/media/{media_id}",
                headers=self._headers_for(config),
                json={
                    "version": detail["version"],
                    "external_refs": refs,
                },
            )
        response.raise_for_status()
        return response.json()

    async def send_admin_notification(
        self,
        *,
        config: RuntimeConfig,
        title: str,
        body: str,
        link_url: str | None,
        data: dict[str, Any] | None,
    ) -> dict[str, Any]:
        response = await self._client.post(
            f"{config.zukan_base_url.rstrip('/')}/api/v1/admin/service-notifications",
            headers=self._headers_for(config),
            json={
                "title": title,
                "body": body,
                "link_url": link_url,
                "data": data or {},
            },
        )
        response.raise_for_status()
        return response.json()
