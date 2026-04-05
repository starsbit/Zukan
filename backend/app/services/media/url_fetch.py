from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

import httpx

from backend.app.errors.error import AppError
from backend.app.errors.upload import ssrf_blocked, url_fetch_failed
from backend.app.utils.storage import ALLOWED_MIME_TYPES

_USER_AGENT = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"

_MAGIC_BYTES: list[tuple[bytes, str]] = [
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
]

_EXT_TO_MIME: dict[str, str] = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
}

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


def _detect_mime(declared: str, url: str, first_bytes: bytes) -> str:
    if declared and declared in ALLOWED_MIME_TYPES:
        return declared

    for magic, mime in _MAGIC_BYTES:
        if first_bytes.startswith(magic):
            return mime

    if first_bytes[8:12] == b"WEBP":
        return "image/webp"

    path = urlparse(url).path.lower()
    for ext, mime in _EXT_TO_MIME.items():
        if path.endswith(ext):
            return mime

    return declared


async def fetch_url_as_bytes(url: str, *, max_size_bytes: int) -> tuple[bytes, str]:
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
                first_chunk: bytes | None = None
                async for chunk in response.aiter_bytes(chunk_size=65536):
                    total += len(chunk)
                    if total > max_size_bytes:
                        raise AppError(422, url_fetch_failed, "Remote file exceeds size limit")
                    chunks.append(chunk)
                    if first_chunk is None:
                        first_chunk = chunk

                content = b"".join(chunks)
                declared = response.headers.get("content-type", "").split(";")[0].strip()
                mime = _detect_mime(declared, url, first_chunk or b"")

                if mime not in ALLOWED_MIME_TYPES:
                    raise AppError(422, url_fetch_failed, f"Unsupported content type: {mime or declared}")

                return content, mime

    except AppError:
        raise
    except httpx.HTTPError as exc:
        raise AppError(502, url_fetch_failed, f"Failed to fetch URL: {exc}") from exc
