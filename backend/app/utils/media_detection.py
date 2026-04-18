from __future__ import annotations

import logging
from dataclasses import dataclass
from threading import Lock
from urllib.parse import urlparse

from backend.app.models.media import MediaType

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SupportedMediaType:
    canonical_mime_type: str
    extension: str
    media_type: MediaType


SUPPORTED_MEDIA_TYPES: dict[str, SupportedMediaType] = {
    "image/avif": SupportedMediaType("image/avif", ".avif", MediaType.IMAGE),
    "image/jpeg": SupportedMediaType("image/jpeg", ".jpg", MediaType.IMAGE),
    "image/png": SupportedMediaType("image/png", ".png", MediaType.IMAGE),
    "image/webp": SupportedMediaType("image/webp", ".webp", MediaType.IMAGE),
    "image/bmp": SupportedMediaType("image/bmp", ".bmp", MediaType.IMAGE),
    "image/tiff": SupportedMediaType("image/tiff", ".tiff", MediaType.IMAGE),
    "image/gif": SupportedMediaType("image/gif", ".gif", MediaType.GIF),
    "video/mp4": SupportedMediaType("video/mp4", ".mp4", MediaType.VIDEO),
    "video/webm": SupportedMediaType("video/webm", ".webm", MediaType.VIDEO),
    "video/quicktime": SupportedMediaType("video/quicktime", ".mov", MediaType.VIDEO),
    "video/x-m4v": SupportedMediaType("video/x-m4v", ".m4v", MediaType.VIDEO),
    "video/x-matroska": SupportedMediaType("video/x-matroska", ".mkv", MediaType.VIDEO),
    "video/x-msvideo": SupportedMediaType("video/x-msvideo", ".avi", MediaType.VIDEO),
}

MIME_TYPE_ALIASES: dict[str, str] = {
    "image/jpg": "image/jpeg",
    "image/pjpeg": "image/jpeg",
    "image/x-bmp": "image/bmp",
    "image/x-ms-bmp": "image/bmp",
    "image/tif": "image/tiff",
    "image/x-tif": "image/tiff",
    "image/x-tiff": "image/tiff",
    "video/m4v": "video/x-m4v",
    "application/x-m4v": "video/x-m4v",
    "video/matroska": "video/x-matroska",
    "application/x-matroska": "video/x-matroska",
    "video/avi": "video/x-msvideo",
    "video/msvideo": "video/x-msvideo",
}

EXTENSION_TO_MIME_TYPE: dict[str, str] = {
    ".avif": "image/avif",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".gif": "image/gif",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".m4v": "video/x-m4v",
    ".mkv": "video/x-matroska",
    ".avi": "video/x-msvideo",
}

_magika_lock = Lock()
_magika_instance = None
_magika_load_attempted = False


def normalize_supported_mime_type(value: str | None) -> str | None:
    if not value:
        return None
    cleaned = value.split(";", 1)[0].strip().lower()
    if not cleaned:
        return None
    canonical = MIME_TYPE_ALIASES.get(cleaned, cleaned)
    return canonical if canonical in SUPPORTED_MEDIA_TYPES else None


def resolve_supported_media_type(
    content: bytes,
    *,
    declared_mime_type: str | None = None,
    source_name: str | None = None,
) -> SupportedMediaType | None:
    magika_mime_type = normalize_supported_mime_type(_detect_magika_mime_type(content))
    if magika_mime_type is not None:
        return SUPPORTED_MEDIA_TYPES[magika_mime_type]

    declared = normalize_supported_mime_type(declared_mime_type)
    if declared is not None:
        return SUPPORTED_MEDIA_TYPES[declared]

    from_source = mime_type_from_source_name(source_name)
    if from_source is not None:
        return SUPPORTED_MEDIA_TYPES[from_source]

    return None


def mime_type_from_source_name(source_name: str | None) -> str | None:
    if not source_name:
        return None
    path = urlparse(source_name).path or source_name
    suffix_index = path.rfind(".")
    if suffix_index == -1:
        return None
    ext = path[suffix_index:].lower()
    return EXTENSION_TO_MIME_TYPE.get(ext)


def _detect_magika_mime_type(content: bytes) -> str | None:
    magika = _get_magika()
    if magika is None:
        return None
    try:
        result = magika.identify_bytes(content)
    except Exception:
        logger.exception("Magika failed to identify upload bytes; falling back to declared metadata")
        return None
    output = getattr(result, "output", None)
    return getattr(output, "mime_type", None)


def _get_magika():
    global _magika_instance
    global _magika_load_attempted

    if _magika_load_attempted:
        return _magika_instance

    with _magika_lock:
        if _magika_load_attempted:
            return _magika_instance
        try:
            from magika import Magika

            _magika_instance = Magika()
        except Exception as exc:
            logger.warning(
                "Magika is unavailable; upload type detection will fall back to declared metadata: %s",
                exc,
            )
            _magika_instance = None
        finally:
            _magika_load_attempted = True
    return _magika_instance
