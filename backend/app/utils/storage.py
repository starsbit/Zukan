from __future__ import annotations

import io
import shutil
import uuid
import zipfile
import tempfile
from typing import BinaryIO
from dataclasses import dataclass
from pathlib import Path

from fastapi import UploadFile

from backend.app.config import settings
from backend.app.storage.filesystem import filesystem_for_path
from backend.app.storage.io import run_storage_io
from backend.app.utils.library_paths import (
    resolve_media_path,
    contained_path,
    root_path,
)
from backend.app.models.media import Media, MediaType
from backend.app.utils.media_detection import (
    SUPPORTED_MEDIA_TYPES,
    resolve_supported_media_type,
)

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
    return (
        settings.storage_dir / "uploads" / hex_id[:2] / f"{hex_id}{ext}"
        if settings.library_paths_relative
        else settings.storage_dir / hex_id[:2] / f"{hex_id}{ext}"
    )


def thumbnail_path(file_id: uuid.UUID) -> Path:
    hex_id = file_id.hex
    return (
        contained_path(
            root_path(),
            f"{settings.generated_files_dir}/thumbnails/{hex_id[:2]}/{hex_id}{THUMB_EXT}",
        )
        if settings.library_paths_relative
        else settings.storage_dir / hex_id[:2] / f"{hex_id}_thumb{THUMB_EXT}"
    )


def poster_path(file_id: uuid.UUID) -> Path:
    hex_id = file_id.hex
    return (
        contained_path(
            root_path(),
            f"{settings.generated_files_dir}/posters/{hex_id[:2]}/{hex_id}.png",
        )
        if settings.library_paths_relative
        else settings.storage_dir / hex_id[:2] / f"{hex_id}_poster.png"
    )


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def finalize_media_file(path: Path) -> None:
    # Compatibility for callers that only need a read-back check. Share ACLs
    # belong to the operator; never change file permissions to mask a failure.
    with path.open("rb") as stream:
        stream.read(1)


def _save_stream(source, declared_mime_type, source_name) -> SavedUpload | None:
    source.seek(0)
    header = source.read(65536)
    supported_type = resolve_supported_media_type(
        header,
        declared_mime_type=declared_mime_type,
        source_name=source_name,
    )
    if supported_type is None:
        return None
    source.seek(0)
    path = shard_path(uuid.uuid4(), supported_type.extension)
    size, digest = filesystem_for_path(path).write_stream(source, path)
    return SavedUpload(
        path=path,
        sha256=digest,
        file_size=size,
        media_type=supported_type.media_type,
        mime_type=supported_type.canonical_mime_type,
    )


async def save_upload(upload: UploadFile) -> SavedUpload | None:
    # UploadFile is already spooled by Starlette. Copy and hash incrementally;
    # large NAS uploads must not be loaded into application memory in full.
    return await run_storage_io(
        _save_stream,
        upload.file,
        upload.content_type or "",
        upload.filename,
    )


async def save_bytes(
    content: bytes,
    declared_mime_type: str | None = None,
    source_name: str | None = None,
) -> SavedUpload | None:
    return await run_storage_io(
        _save_stream,
        io.BytesIO(content),
        declared_mime_type,
        source_name,
    )


def delete_media_files(
    filepath: str,
    poster_path_str: str | None = None,
    thumbnail_path_str: str | None = None,
) -> None:
    path = resolve_media_path(filepath)
    for candidate in (
        path,
        resolve_media_path(poster_path_str) if poster_path_str else None,
        resolve_media_path(thumbnail_path_str) if thumbnail_path_str else None,
    ):
        if candidate:
            filesystem = filesystem_for_path(candidate)
            filesystem.remove(filesystem.relative(candidate))
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

    delete_media_files(
        filepath,
        stored_path(poster) if poster else None,
        stored_path(thumb) if thumb else None,
    )


def zip_media(rows: list[Media]) -> BinaryIO:
    buf = tempfile.SpooledTemporaryFile(
        max_size=8 * 1024 * 1024, dir=settings.processing_temp_dir
    )
    try:
        with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_STORED) as zf:
            seen: dict[str, int] = {}
            for media in rows:
                name = media.filename
                if name in seen:
                    seen[name] += 1
                    stem, _, ext = name.rpartition(".")
                    name = (
                        f"{stem}_{seen[name]}.{ext}" if ext else f"{name}_{seen[name]}"
                    )
                else:
                    seen[name] = 0
                try:
                    zf.write(resolve_media_path(media.filepath), arcname=name)
                except FileNotFoundError:
                    filesystem_for_path(resolve_media_path(media.filepath)).snapshot()
        buf.seek(0)
        return buf
    except BaseException:
        buf.close()
        raise


def stream_archive(archive):
    try:
        while chunk := archive.read(1024 * 1024):
            yield chunk
    finally:
        archive.close()
