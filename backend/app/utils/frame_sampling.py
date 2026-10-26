from __future__ import annotations
from backend.app.utils.library_paths import resolve_media_path

import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image as PILImage

from backend.app.config import settings
from backend.app.models.media import MediaType
from backend.app.utils.media_metadata import _safe_float, probe_media
from backend.app.utils.storage import ffmpeg_available


def sample_media_frames(filepath: str, media_type: MediaType, sample_count: int = 5) -> list[Path]:
    if media_type == MediaType.IMAGE:
        return [resolve_media_path(filepath)]
    if media_type == MediaType.GIF:
        return _sample_gif_frames(resolve_media_path(filepath), sample_count)
    return _sample_video_frames(resolve_media_path(filepath), sample_count)


def cleanup_sampled_frames(frames: list[Path]) -> None:
    for directory in {p.parent for p in frames}:
        # Never delete originals, even if a caller passes the image fallback.
        if directory.name.startswith('zukan-frames-'):
            shutil.rmtree(directory, ignore_errors=True)


def _workspace() -> Path:
    return Path(tempfile.mkdtemp(prefix='zukan-frames-', dir=settings.processing_temp_dir))


def _sample_gif_frames(source_path: Path, sample_count: int) -> list[Path]:
    directory = _workspace()
    frames = []
    try:
        with PILImage.open(source_path) as img:
            frame_total = max(1, getattr(img, "n_frames", 1))
            for idx, frame_index in enumerate(_sample_indexes(frame_total, sample_count)):
                img.seek(frame_index)
                frame_path = directory / f"frame_{idx}.png"
                img.convert("RGB").save(frame_path, "PNG")
                frames.append(frame_path)
        if not frames:
            directory.rmdir()
        return frames
    except BaseException:
        shutil.rmtree(directory, ignore_errors=True)
        raise


def _sample_video_frames(source_path: Path, sample_count: int) -> list[Path]:
    if not ffmpeg_available():
        return []
    payload = probe_media(source_path)
    duration = _safe_float(payload.get("format", {}).get("duration")) or 0.0
    directory = _workspace()
    frames = []
    try:
        for idx, timestamp in enumerate(_sample_timestamps(duration, sample_count)):
            frame_path = directory / f"frame_{idx}.png"
            try:
                result = subprocess.run(
                    ["ffmpeg", "-y", "-ss", f"{timestamp:.3f}", "-i", str(source_path), "-frames:v", "1", str(frame_path)],
                    capture_output=True, text=True, timeout=settings.ffmpeg_timeout_seconds,
                )
            except subprocess.TimeoutExpired:
                continue
            if result.returncode == 0 and frame_path.exists():
                frames.append(frame_path)
        if not frames:
            shutil.rmtree(directory, ignore_errors=True)
        return frames
    except BaseException:
        shutil.rmtree(directory, ignore_errors=True)
        raise


def _sample_indexes(total: int, sample_count: int) -> list[int]:
    if total <= 1:
        return [0]
    return sorted({min(total - 1, max(0, round((i + 1) * (total - 1) / (sample_count + 1)))) for i in range(sample_count)})


def _sample_timestamps(duration_seconds: float, sample_count: int) -> list[float]:
    if duration_seconds <= 0:
        return [0.0]
    return [duration_seconds * ((i + 1) / (sample_count + 1)) for i in range(sample_count)]
