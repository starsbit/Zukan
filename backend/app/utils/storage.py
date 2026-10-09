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
from backend.app.utils.library_paths import resolve_media_path, contained_path, root_path
from backend.app.models.media import Media, MediaType
from backend.app.utils.media_detection import SUPPORTED_MEDIA_TYPES, resolve_supported_media_type

ALLOWED_MIME_TYPES: dict[str, tuple[str, MediaType]] = {
    mime_type: (supported.extension, supported.media_type)
    for mime_type, supported in SUPPORTED_MEDIA_TYPES.items()
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
    return settings.storage_dir / "uploads" / hex_id[:2] / f"{hex_id}{ext}" if settings.library_paths_relative else settings.storage_dir / hex_id[:2] / f"{hex_id}{ext}"


def thumbnail_path(file_id: uuid.UUID) -> Path:
    hex_id = file_id.hex
    return contained_path(root_path(), f"{settings.generated_files_dir}/thumbnails/{hex_id[:2]}/{hex_id}{THUMB_EXT}") if settings.library_paths_relative else settings.storage_dir / hex_id[:2] / f"{hex_id}_thumb{THUMB_EXT}"


def poster_path(file_id: uuid.UUID) -> Path:
    hex_id = file_id.hex
    return contained_path(root_path(), f"{settings.generated_files_dir}/posters/{hex_id[:2]}/{hex_id}.png") if settings.library_paths_relative else settings.storage_dir / hex_id[:2] / f"{hex_id}_poster.png"


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


async def save_upload(upload: UploadFile) -> SavedUpload | None:
    content = await upload.read()
    return await save_bytes(
        content,
        declared_mime_type=upload.content_type or "",
        source_name=upload.filename,
    )


async def save_bytes(
    content: bytes,
    declared_mime_type: str | None = None,
    source_name: str | None = None,
) -> SavedUpload | None:
    supported_type = resolve_supported_media_type(
        content,
        declared_mime_type=declared_mime_type,
        source_name=source_name,
    )
    if supported_type is None:
        return None

    sha256 = hashlib.sha256(content).hexdigest()
    file_id = uuid.uuid4()
    path = shard_path(file_id, supported_type.extension)
    if settings.library_paths_relative:
        contained_path(root_path(), str(path.relative_to(root_path())))
    path.parent.mkdir(parents=True, exist_ok=True)

    async with aiofiles.open(path, "wb") as f:
        await f.write(content)

    return SavedUpload(
        path=path,
        sha256=sha256,
        file_size=len(content),
        media_type=supported_type.media_type,
        mime_type=supported_type.canonical_mime_type,
    )


def delete_media_files(filepath: str, poster_path_str: str | None = None, thumbnail_path_str: str | None = None) -> None:
    path = resolve_media_path(filepath)
    for candidate in (
        path,
        resolve_media_path(poster_path_str) if poster_path_str else None,
        resolve_media_path(thumbnail_path_str) if thumbnail_path_str else None,
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
    from backend.app.utils.library_paths import stored_path
    delete_media_files(filepath, stored_path(poster) if poster else None, stored_path(thumb) if thumb else None)


def zip_media(rows: list[Media]) -> io.BytesIO:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_STORED) as zf:
        seen: dict[str, int] = {}
        for media in rows:
            name = media.filename
            if name in seen:
                seen[name] += 1
                stem, _, ext = name.rpartition(".")
                name = f"{stem}_{seen[name]}.{ext}" if ext else f"{name}_{seen[name]}"
            else:
                seen[name] = 0
            try:
                zf.write(resolve_media_path(media.filepath), arcname=name)
            except OSError:
                pass
    buf.seek(0)
    return buf
