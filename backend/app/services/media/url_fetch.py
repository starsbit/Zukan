from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

import httpx

from backend.app.errors.error import AppError
from backend.app.errors.upload import ssrf_blocked, url_fetch_failed
from backend.app.utils.media_detection import normalize_supported_mime_type

_USER_AGENT = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"

_BLOCKED_NETWORKS = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
]


def _check_ssrf(url: str) -> None:
    parsed = urlparse(url)
    hostname = parsed.hostname
    if not hostname:
        raise AppError(422, ssrf_blocked, "Invalid URL hostname")
    try:
        results = socket.getaddrinfo(hostname, None)
    except OSError as exc:
        raise AppError(422, url_fetch_failed, f"Could not resolve host: {hostname}") from exc
    for *_, sockaddr in results:
        addr_str = sockaddr[0]
        try:
            addr = ipaddress.ip_address(addr_str)
        except ValueError:
            continue
        if any(addr in net for net in _BLOCKED_NETWORKS):
            raise AppError(422, ssrf_blocked, f"URL resolves to a blocked address: {addr_str}")

async def fetch_url_as_bytes(url: str, *, max_size_bytes: int) -> tuple[bytes, str | None]:
    _check_ssrf(url)
    try:
        async with httpx.AsyncClient(follow_redirects=True, max_redirects=5, timeout=15.0) as client:
            async with client.stream("GET", url, headers={"User-Agent": _USER_AGENT}) as response:
                if response.status_code >= 400:
                    raise AppError(502, url_fetch_failed, f"Remote returned HTTP {response.status_code}")

                content_length = response.headers.get("content-length")
                if content_length and int(content_length) > max_size_bytes:
                    raise AppError(422, url_fetch_failed, "Remote file exceeds size limit")

                chunks: list[bytes] = []
                total = 0
                async for chunk in response.aiter_bytes(chunk_size=65536):
                    total += len(chunk)
                    if total > max_size_bytes:
                        raise AppError(422, url_fetch_failed, "Remote file exceeds size limit")
                    chunks.append(chunk)

                content = b"".join(chunks)
                declared = normalize_supported_mime_type(response.headers.get("content-type"))
                return content, declared

    except AppError:
        raise
    except httpx.HTTPError as exc:
        raise AppError(502, url_fetch_failed, f"Failed to fetch URL: {exc}") from exc
