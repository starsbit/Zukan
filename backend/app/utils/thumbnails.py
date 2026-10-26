from __future__ import annotations

import logging
import subprocess
import uuid
from pathlib import Path

from PIL import Image as PILImage, ImageOps

from backend.app.config import settings
from backend.app.storage.filesystem import filesystem_for_path, StorageUnavailable
from backend.app.models.media import MediaType
from backend.app.utils.media_metadata import (
    _extract_still_image_metadata,
    _safe_float,
    probe_media,
)
from backend.app.utils.storage import ffmpeg_available, thumbnail_path, poster_path

logger = logging.getLogger(__name__)


def generate_poster_and_thumbnail(
    filepath: str, media_type: MediaType, file_id: uuid.UUID | None = None
) -> tuple[Path | None, Path | None]:
    file_id = file_id or uuid.UUID(Path(filepath).stem)
    if media_type == MediaType.IMAGE:
        thumb = _generate_square_thumbnail(Path(filepath), thumbnail_path(file_id))
        return None, thumb

    if media_type == MediaType.GIF:
        p = poster_path(file_id)
        if _extract_gif_poster(Path(filepath), p) is None:
            return None, None
        thumb = _generate_square_thumbnail(p, thumbnail_path(file_id))
        return p, thumb

    p = poster_path(file_id)
    if _extract_video_poster(Path(filepath), p) is None:
        return None, None
    thumb = _generate_square_thumbnail(p, thumbnail_path(file_id))
    return p, thumb


def generate_thumbnail(source_filepath: str) -> Path | None:
    file_id = uuid.UUID(Path(source_filepath).stem)
    return _generate_square_thumbnail(Path(source_filepath), thumbnail_path(file_id))


def get_media_dimensions(filepath: str) -> tuple[int, int] | None:
    metadata = _extract_still_image_metadata(filepath)
    if metadata.width is None or metadata.height is None:
        return None
    return metadata.width, metadata.height


def _generate_square_thumbnail(source_path: Path, thumb_path: Path) -> Path | None:
    try:
        with PILImage.open(source_path) as img:
            if img.mode != "RGB":
                img = img.convert("RGB")
            size = settings.thumbnail_size
            canvas = ImageOps.fit(
                img, (size, size), method=PILImage.LANCZOS, centering=(0.5, 0.5)
            )
            with filesystem_for_path(thumb_path).atomic_output(thumb_path) as output:
                canvas.save(output, "WEBP", quality=85)
        return thumb_path
    except StorageUnavailable:
        raise
    except Exception:
        logger.warning(
            "Thumbnail generation failed source=%s target=%s",
            source_path,
            thumb_path,
            exc_info=True,
        )
        return None


def _extract_gif_poster(source_path: Path, dest_path: Path) -> Path | None:
    try:
        with PILImage.open(source_path) as img:
            frame_index = max(0, (getattr(img, "n_frames", 1) - 1) // 2)
            img.seek(frame_index)
            frame = img.convert("RGB")
            with filesystem_for_path(dest_path).atomic_output(dest_path) as output:
                frame.save(output, "PNG")
        return dest_path
    except StorageUnavailable:
        raise
    except Exception:
        logger.warning(
            "GIF poster generation failed source=%s target=%s",
            source_path,
            dest_path,
            exc_info=True,
        )
        return None


def _extract_video_poster(source_path: Path, dest_path: Path) -> Path | None:
    if not ffmpeg_available():
        return None
    payload = probe_media(source_path)
    duration = _safe_float(payload.get("format", {}).get("duration")) or 0.0
    timestamp = duration * 0.5 if duration > 0 else 0.0
    try:
        with filesystem_for_path(dest_path).atomic_output(dest_path) as output:
            result = subprocess.run(
                [
                    "ffmpeg",
                    "-y",
                    "-ss",
                    f"{timestamp:.3f}",
                    "-i",
                    str(source_path),
                    "-frames:v",
                    "1",
                    str(output),
                ],
                capture_output=True,
                text=True,
                timeout=settings.ffmpeg_timeout_seconds,
            )
            if result.returncode != 0 or output.stat().st_size == 0:
                raise ValueError("FFmpeg did not produce a poster")
    except StorageUnavailable:
        raise
    except (OSError, ValueError, subprocess.TimeoutExpired):
        logger.warning(
            "Video poster generation failed target=%s", dest_path, exc_info=True
        )
        return None
    return dest_path
