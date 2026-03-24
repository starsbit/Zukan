from __future__ import annotations

import hashlib
import io
import shutil
import uuid
import zipfile
from dataclasses import dataclass
from pathlib import Path

import aiofiles
from fastapi import UploadFile

from backend.app.config import settings
from backend.app.models.media import Media, MediaType

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


def shard_path(file_id: uuid.UUID, ext: str) -> Path:
    hex_id = file_id.hex
    return settings.storage_dir / hex_id[:2] / f"{hex_id}{ext}"


def thumbnail_path(file_id: uuid.UUID) -> Path:
    hex_id = file_id.hex
    return settings.storage_dir / hex_id[:2] / f"{hex_id}_thumb{THUMB_EXT}"


def poster_path(file_id: uuid.UUID) -> Path:
    hex_id = file_id.hex
    return settings.storage_dir / hex_id[:2] / f"{hex_id}_poster.png"


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


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
    path = shard_path(file_id, ext)
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


def delete_media_files(filepath: str, poster_path_str: str | None = None, thumbnail_path_str: str | None = None) -> None:
    path = Path(filepath)
    for candidate in (
        path,
        Path(poster_path_str) if poster_path_str else None,
        Path(thumbnail_path_str) if thumbnail_path_str else None,
    ):
        if candidate and candidate.exists():
            candidate.unlink()
    try:
        path.parent.rmdir()
    except OSError:
        pass


def delete_file(filepath: str) -> None:
    path = Path(filepath)
    poster = None
    thumb = None
    try:
        file_id = uuid.UUID(path.stem)
        thumb = str(thumbnail_path(file_id))
        poster = str(poster_path(file_id))
    except ValueError:
        pass
    delete_media_files(filepath, poster, thumb)


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
