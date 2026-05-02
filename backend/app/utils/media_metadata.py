from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from PIL import Image as PILImage, ImageSequence

from backend.app.config import settings
from backend.app.models.media import MediaType
from backend.app.utils.storage import ffmpeg_available


@dataclass(frozen=True)
class MediaMetadata:
    media_type: MediaType
    width: int | None
    height: int | None
    duration_seconds: float | None
    frame_count: int | None
    captured_at: datetime | None


def extract_media_metadata(filepath: str, media_type: MediaType) -> MediaMetadata:
    if media_type == MediaType.IMAGE:
        return _extract_still_image_metadata(filepath)
    if media_type == MediaType.GIF:
        return _extract_gif_metadata(filepath)
    return _extract_video_metadata(filepath)


def _extract_still_image_metadata(filepath: str) -> MediaMetadata:
    try:
        with PILImage.open(filepath) as img:
            captured_at = _extract_still_media_timestamp_from_pillow(img)
            return MediaMetadata(
                media_type=MediaType.IMAGE,
                width=img.width,
                height=img.height,
                duration_seconds=None,
                frame_count=1,
                captured_at=captured_at,
            )
    except Exception:
        return MediaMetadata(MediaType.IMAGE, None, None, None, None, None)


def _extract_gif_metadata(filepath: str) -> MediaMetadata:
    try:
        with PILImage.open(filepath) as img:
            frame_count = getattr(img, "n_frames", 1)
            duration_ms = 0
            for frame in ImageSequence.Iterator(img):
                duration_ms += int(frame.info.get("duration", 0))
            return MediaMetadata(
                media_type=MediaType.GIF,
                width=img.width,
                height=img.height,
                duration_seconds=(duration_ms / 1000.0) if duration_ms else None,
                frame_count=frame_count,
                captured_at=_extract_still_media_timestamp_from_pillow(img),
            )
    except Exception:
        return MediaMetadata(MediaType.GIF, None, None, None, None, None)


def _extract_video_metadata(filepath: str) -> MediaMetadata:
    payload = probe_media(Path(filepath))
    streams = payload.get("streams", [])
    format_info = payload.get("format", {})
    video_stream = next((s for s in streams if s.get("codec_type") == "video"), {})
    tags = format_info.get("tags", {}) or {}
    duration = _safe_float(video_stream.get("duration")) or _safe_float(format_info.get("duration"))
    frame_count = _safe_int(video_stream.get("nb_frames"))
    captured_at = None
    for key in ("creation_time", "com.apple.quicktime.creationdate"):
        raw_value = tags.get(key)
        if raw_value:
            captured_at = _parse_media_timestamp(raw_value)
            if captured_at is not None:
                break
    return MediaMetadata(
        media_type=MediaType.VIDEO,
        width=_safe_int(video_stream.get("width")),
        height=_safe_int(video_stream.get("height")),
        duration_seconds=duration,
        frame_count=frame_count,
        captured_at=captured_at,
    )


def _extract_still_media_timestamp_from_pillow(img: PILImage.Image) -> datetime | None:
    try:
        exif = img.getexif()
    except Exception:
        exif = {}
    for tag_id, offset_tag_id in ((36867, 36881), (36868, 36882), (306, 36880)):
        raw_value = exif.get(tag_id)
        if not raw_value:
            continue
        parsed = _parse_media_timestamp(str(raw_value), exif.get(offset_tag_id))
        if parsed is not None:
            return parsed
    for key in ("creation_time", "timestamp", "date:create", "date:modify"):
        raw_value = img.info.get(key)
        if not raw_value:
            continue
        parsed = _parse_media_timestamp(str(raw_value))
        if parsed is not None:
            return parsed
    return None


def probe_media(source_path: Path) -> dict:
    if not ffmpeg_available():
        return {}
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "stream=codec_type,width,height,nb_frames,duration:format=duration,tags",
                "-print_format",
                "json",
                str(source_path),
            ],
            capture_output=True,
            text=True,
            timeout=settings.ffmpeg_timeout_seconds,
        )
    except subprocess.TimeoutExpired:
        return {}
    if result.returncode != 0:
        return {}
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return {}


def _parse_media_timestamp(value: str, offset: str | None = None) -> datetime | None:
    cleaned = value.strip()
    if not cleaned:
        return None
    for candidate in (
        lambda raw: datetime.strptime(raw, "%Y:%m:%d %H:%M:%S"),
        lambda raw: datetime.fromisoformat(raw.replace("Z", "+00:00")),
    ):
        try:
            parsed = candidate(cleaned)
            break
        except ValueError:
            parsed = None
    else:
        return None

    if parsed.tzinfo is not None:
        return parsed.astimezone(UTC)

    if offset:
        try:
            return datetime.fromisoformat(f"{parsed:%Y-%m-%dT%H:%M:%S}{offset}").astimezone(UTC)
        except ValueError:
            pass
    return parsed.replace(tzinfo=UTC)


def _safe_float(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _safe_int(value) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
