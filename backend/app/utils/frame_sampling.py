from __future__ import annotations

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
        return [Path(filepath)]
    if media_type == MediaType.GIF:
        return _sample_gif_frames(Path(filepath), sample_count)
    return _sample_video_frames(Path(filepath), sample_count)


def cleanup_sampled_frames(frames: list[Path]) -> None:
    for frame in frames:
        try:
            if frame.exists():
                frame.unlink()
        except OSError:
            pass


def _sample_gif_frames(source_path: Path, sample_count: int) -> list[Path]:
    frames: list[Path] = []
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        with PILImage.open(source_path) as img:
            frame_total = max(1, getattr(img, "n_frames", 1))
            indexes = _sample_indexes(frame_total, sample_count)
            for idx, frame_index in enumerate(indexes):
                img.seek(frame_index)
                frame_path = tmp_path / f"frame_{idx}.png"
                img.convert("RGB").save(frame_path, "PNG")
                persisted = source_path.parent / f"{source_path.stem}_frame_{idx}.png"
                shutil.copy(frame_path, persisted)
                frames.append(persisted)
    return frames


def _sample_video_frames(source_path: Path, sample_count: int) -> list[Path]:
    if not ffmpeg_available():
        return []
    payload = probe_media(source_path)
    duration = _safe_float(payload.get("format", {}).get("duration")) or 0.0
    timestamps = _sample_timestamps(duration, sample_count)
    frames: list[Path] = []
    for idx, timestamp in enumerate(timestamps):
        frame_path = source_path.parent / f"{source_path.stem}_frame_{idx}.png"
        try:
            result = subprocess.run(
                ["ffmpeg", "-y", "-ss", f"{timestamp:.3f}", "-i", str(source_path), "-frames:v", "1", str(frame_path)],
                capture_output=True,
                text=True,
                timeout=settings.ffmpeg_timeout_seconds,
            )
        except subprocess.TimeoutExpired:
            continue
        if result.returncode == 0 and frame_path.exists():
            frames.append(frame_path)
    return frames


def _sample_indexes(total: int, sample_count: int) -> list[int]:
    if total <= 1:
        return [0]
    return sorted({min(total - 1, max(0, round((i + 1) * (total - 1) / (sample_count + 1)))) for i in range(sample_count)})


def _sample_timestamps(duration_seconds: float, sample_count: int) -> list[float]:
    if duration_seconds <= 0:
        return [0.0]
    return [duration_seconds * ((i + 1) / (sample_count + 1)) for i in range(sample_count)]
