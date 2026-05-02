from __future__ import annotations

import subprocess
import uuid
from pathlib import Path

from PIL import Image as PILImage, ImageOps

from backend.app.config import settings
from backend.app.models.media import MediaType
from backend.app.utils.media_metadata import _extract_still_image_metadata, _safe_float, probe_media
from backend.app.utils.storage import ffmpeg_available, thumbnail_path, poster_path


def generate_poster_and_thumbnail(filepath: str, media_type: MediaType) -> tuple[Path | None, Path | None]:
    file_id = uuid.UUID(Path(filepath).stem)
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
            canvas = ImageOps.fit(img, (size, size), method=PILImage.LANCZOS, centering=(0.5, 0.5))
            thumb_path.parent.mkdir(parents=True, exist_ok=True)
            canvas.save(thumb_path, "WEBP", quality=85)
        return thumb_path
    except Exception:
        return None


def _extract_gif_poster(source_path: Path, dest_path: Path) -> Path | None:
    try:
        with PILImage.open(source_path) as img:
            frame_index = max(0, (getattr(img, "n_frames", 1) - 1) // 2)
            img.seek(frame_index)
            frame = img.convert("RGB")
            dest_path.parent.mkdir(parents=True, exist_ok=True)
            frame.save(dest_path, "PNG")
        return dest_path
    except Exception:
        return None


def _extract_video_poster(source_path: Path, dest_path: Path) -> Path | None:
    if not ffmpeg_available():
        return None
    payload = probe_media(source_path)
    duration = _safe_float(payload.get("format", {}).get("duration")) or 0.0
    timestamp = duration * 0.5 if duration > 0 else 0.0
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        result = subprocess.run(
            ["ffmpeg", "-y", "-ss", f"{timestamp:.3f}", "-i", str(source_path), "-frames:v", "1", str(dest_path)],
            capture_output=True,
            text=True,
            timeout=settings.ffmpeg_timeout_seconds,
        )
    except subprocess.TimeoutExpired:
        return None
    return dest_path if result.returncode == 0 and dest_path.exists() else None
