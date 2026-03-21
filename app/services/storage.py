from __future__ import annotations

import hashlib
import io
import json
import shutil
import subprocess
import tempfile
import uuid
import zipfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import aiofiles
from fastapi import UploadFile
from PIL import Image as PILImage, ImageSequence

from app.config import settings
from app.models import Media, MediaType

ALLOWED_MIME_TYPES: dict[str, tuple[str, MediaType]] = {
    "image/jpeg": (".jpg", MediaType.IMAGE),
    "image/png": (".png", MediaType.IMAGE),
    "image/webp": (".webp", MediaType.IMAGE),
    "image/gif": (".gif", MediaType.GIF),
    "video/mp4": (".mp4", MediaType.VIDEO),
    "video/webm": (".webm", MediaType.VIDEO),
    "video/quicktime": (".mov", MediaType.VIDEO),
}

THUMB_EXT = ".webp"


@dataclass(frozen=True)
class SavedUpload:
    path: Path
    sha256: str
    file_size: int
    media_type: MediaType
    mime_type: str


@dataclass(frozen=True)
class MediaMetadata:
    media_type: MediaType
    width: int | None
    height: int | None
    duration_seconds: float | None
    frame_count: int | None
    captured_at: datetime | None


def _shard_path(file_id: uuid.UUID, ext: str) -> Path:
    hex_id = file_id.hex
    return settings.storage_dir / hex_id[:2] / f"{hex_id}{ext}"


def _thumbnail_path(file_id: uuid.UUID) -> Path:
    hex_id = file_id.hex
    return settings.storage_dir / hex_id[:2] / f"{hex_id}_thumb{THUMB_EXT}"


def _poster_path(file_id: uuid.UUID) -> Path:
    hex_id = file_id.hex
    return settings.storage_dir / hex_id[:2] / f"{hex_id}_poster.png"


async def save_upload(upload: UploadFile) -> SavedUpload | None:
    file_info = ALLOWED_MIME_TYPES.get(upload.content_type or "")
    if file_info is None:
        return None

    ext, media_type = file_info
    content = await upload.read()
    if len(content) > settings.max_upload_size_mb * 1024 * 1024:
        return None

    sha256 = hashlib.sha256(content).hexdigest()
    file_id = uuid.uuid4()
    path = _shard_path(file_id, ext)
    path.parent.mkdir(parents=True, exist_ok=True)

    async with aiofiles.open(path, "wb") as f:
        await f.write(content)

    return SavedUpload(
        path=path,
        sha256=sha256,
        file_size=len(content),
        media_type=media_type,
        mime_type=upload.content_type or "",
    )


def extract_media_metadata(filepath: str, media_type: MediaType) -> MediaMetadata:
    if media_type == MediaType.IMAGE:
        return _extract_still_image_metadata(filepath)
    if media_type == MediaType.GIF:
        return _extract_gif_metadata(filepath)
    return _extract_video_metadata(filepath)


def generate_poster_and_thumbnail(filepath: str, media_type: MediaType) -> tuple[Path | None, Path | None]:
    if media_type == MediaType.IMAGE:
        thumb = _generate_square_thumbnail(Path(filepath), _thumbnail_path(uuid.UUID(Path(filepath).stem)))
        return None, thumb

    if media_type == MediaType.GIF:
        poster = _poster_path(uuid.UUID(Path(filepath).stem))
        if _extract_gif_poster(Path(filepath), poster) is None:
            return None, None
        thumb = _generate_square_thumbnail(poster, _thumbnail_path(uuid.UUID(Path(filepath).stem)))
        return poster, thumb

    poster = _poster_path(uuid.UUID(Path(filepath).stem))
    if _extract_video_poster(Path(filepath), poster) is None:
        return None, None
    thumb = _generate_square_thumbnail(poster, _thumbnail_path(uuid.UUID(Path(filepath).stem)))
    return poster, thumb


def sample_media_frames(filepath: str, media_type: MediaType, sample_count: int = 5) -> list[Path]:
    if media_type == MediaType.IMAGE:
        return [Path(filepath)]
    if media_type == MediaType.GIF:
        return _sample_gif_frames(Path(filepath), sample_count)
    return _sample_video_frames(Path(filepath), sample_count)


def delete_media_files(filepath: str, poster_path: str | None = None, thumbnail_path: str | None = None) -> None:
    path = Path(filepath)
    for candidate in (path, Path(poster_path) if poster_path else None, Path(thumbnail_path) if thumbnail_path else None):
        if candidate and candidate.exists():
            candidate.unlink()
    try:
        path.parent.rmdir()
    except OSError:
        pass


def zip_media(rows: list[Media]) -> io.BytesIO:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_STORED) as zf:
        seen: dict[str, int] = {}
        for media in rows:
            name = media.original_filename or media.filename
            if name in seen:
                seen[name] += 1
                stem, _, ext = name.rpartition(".")
                name = f"{stem}_{seen[name]}.{ext}" if ext else f"{name}_{seen[name]}"
            else:
                seen[name] = 0
            try:
                zf.write(media.filepath, arcname=name)
            except OSError:
                pass
    buf.seek(0)
    return buf


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def generate_thumbnail(source_filepath: str) -> Path | None:
    return _generate_square_thumbnail(Path(source_filepath), _thumbnail_path(uuid.UUID(Path(source_filepath).stem)))


def get_media_dimensions(filepath: str) -> tuple[int, int] | None:
    metadata = _extract_still_image_metadata(filepath)
    if metadata.width is None or metadata.height is None:
        return None
    return metadata.width, metadata.height


def delete_file(filepath: str) -> None:
    path = Path(filepath)
    poster_path = None
    thumb_path = None
    try:
        file_id = uuid.UUID(path.stem)
        thumb_path = str(_thumbnail_path(file_id))
        poster_path = str(_poster_path(file_id))
    except ValueError:
        pass
    delete_media_files(filepath, poster_path, thumb_path)


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
    payload = _probe_media(Path(filepath))
    streams = payload.get("streams", [])
    format_info = payload.get("format", {})
    video_stream = next((stream for stream in streams if stream.get("codec_type") == "video"), {})
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


def _generate_square_thumbnail(source_path: Path, thumb_path: Path) -> Path | None:
    try:
        with PILImage.open(source_path) as img:
            if img.mode != "RGB":
                img = img.convert("RGB")
            max_dim = max(img.size)
            canvas = PILImage.new("RGB", (max_dim, max_dim), (255, 255, 255))
            canvas.paste(img, ((max_dim - img.width) // 2, (max_dim - img.height) // 2))
            size = settings.thumbnail_size
            canvas = canvas.resize((size, size), PILImage.LANCZOS)
            thumb_path.parent.mkdir(parents=True, exist_ok=True)
            canvas.save(thumb_path, "WEBP", quality=85)
        return thumb_path
    except Exception:
        return None


def _extract_gif_poster(source_path: Path, poster_path: Path) -> Path | None:
    try:
        with PILImage.open(source_path) as img:
            frame_index = max(0, (getattr(img, "n_frames", 1) - 1) // 2)
            img.seek(frame_index)
            frame = img.convert("RGB")
            poster_path.parent.mkdir(parents=True, exist_ok=True)
            frame.save(poster_path, "PNG")
        return poster_path
    except Exception:
        return None


def _extract_video_poster(source_path: Path, poster_path: Path) -> Path | None:
    if not ffmpeg_available():
        return None
    payload = _probe_media(source_path)
    duration = _safe_float(payload.get("format", {}).get("duration")) or 0.0
    timestamp = duration * 0.5 if duration > 0 else 0.0
    poster_path.parent.mkdir(parents=True, exist_ok=True)
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
            str(poster_path),
        ],
        capture_output=True,
        text=True,
    )
    return poster_path if result.returncode == 0 and poster_path.exists() else None


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
    payload = _probe_media(source_path)
    duration = _safe_float(payload.get("format", {}).get("duration")) or 0.0
    timestamps = _sample_timestamps(duration, sample_count)
    frames: list[Path] = []
    for idx, timestamp in enumerate(timestamps):
        frame_path = source_path.parent / f"{source_path.stem}_frame_{idx}.png"
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
                str(frame_path),
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode == 0 and frame_path.exists():
            frames.append(frame_path)
    return frames


def cleanup_sampled_frames(frames: list[Path]) -> None:
    for frame in frames:
        try:
            if frame.exists():
                frame.unlink()
        except OSError:
            pass


def _probe_media(source_path: Path) -> dict:
    if not ffmpeg_available():
        return {}
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
    )
    if result.returncode != 0:
        return {}
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return {}


def _sample_indexes(total: int, sample_count: int) -> list[int]:
    if total <= 1:
        return [0]
    return sorted({min(total - 1, max(0, round((i + 1) * (total - 1) / (sample_count + 1)))) for i in range(sample_count)})


def _sample_timestamps(duration_seconds: float, sample_count: int) -> list[float]:
    if duration_seconds <= 0:
        return [0.0]
    return [duration_seconds * ((i + 1) / (sample_count + 1)) for i in range(sample_count)]


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
