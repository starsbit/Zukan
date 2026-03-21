import hashlib
import uuid
from datetime import UTC, datetime
from pathlib import Path

import aiofiles
from fastapi import UploadFile

from app.config import settings

ALLOWED_MIME_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


def _shard_path(file_id: uuid.UUID, ext: str) -> Path:
    hex_id = file_id.hex
    return settings.storage_dir / hex_id[:2] / f"{hex_id}{ext}"


def _thumbnail_path(file_id: uuid.UUID) -> Path:
    hex_id = file_id.hex
    return settings.storage_dir / hex_id[:2] / f"{hex_id}_thumb.webp"


async def save_upload(upload: UploadFile) -> tuple[Path, str, int] | None:
    if upload.content_type not in ALLOWED_MIME_TYPES:
        return None

    ext = ALLOWED_MIME_TYPES[upload.content_type]
    content = await upload.read()

    if len(content) > settings.max_upload_size_mb * 1024 * 1024:
        return None

    sha256 = hashlib.sha256(content).hexdigest()
    file_id = uuid.uuid4()
    path = _shard_path(file_id, ext)
    path.parent.mkdir(parents=True, exist_ok=True)

    async with aiofiles.open(path, "wb") as f:
        await f.write(content)

    return path, sha256, len(content)


def generate_thumbnail(source_filepath: str) -> Path | None:
    try:
        from PIL import Image
        file_id = uuid.UUID(Path(source_filepath).stem)
        thumb_path = _thumbnail_path(file_id)
        with Image.open(source_filepath) as img:
            if img.mode != "RGB":
                img = img.convert("RGB")
            max_dim = max(img.size)
            canvas = Image.new("RGB", (max_dim, max_dim), (255, 255, 255))
            canvas.paste(img, ((max_dim - img.width) // 2, (max_dim - img.height) // 2))
            size = settings.thumbnail_size
            canvas = canvas.resize((size, size), Image.LANCZOS)
            thumb_path.parent.mkdir(parents=True, exist_ok=True)
            canvas.save(thumb_path, "WEBP", quality=85)
        return thumb_path
    except Exception:
        return None


def extract_image_timestamp(filepath: str) -> datetime | None:
    try:
        from PIL import Image

        with Image.open(filepath) as img:
            exif = img.getexif()
            for tag_id, offset_tag_id in ((36867, 36881), (36868, 36882), (306, 36880)):
                raw_value = exif.get(tag_id)
                if not raw_value:
                    continue
                parsed = _parse_image_timestamp(str(raw_value), exif.get(offset_tag_id))
                if parsed is not None:
                    return parsed

            for key in ("creation_time", "timestamp", "date:create", "date:modify"):
                raw_value = img.info.get(key)
                if not raw_value:
                    continue
                parsed = _parse_image_timestamp(str(raw_value))
                if parsed is not None:
                    return parsed
    except Exception:
        return None

    return None


def delete_file(filepath: str) -> None:
    path = Path(filepath)
    if path.exists():
        path.unlink()
    try:
        thumb = _thumbnail_path(uuid.UUID(path.stem))
        if thumb.exists():
            thumb.unlink()
    except (ValueError, Exception):
        pass
    try:
        path.parent.rmdir()
    except OSError:
        pass


def zip_images(images) -> "io.BytesIO":
    import io
    import zipfile

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_STORED) as zf:
        seen: dict[str, int] = {}
        for img in images:
            name = img.original_filename or img.filename
            if name in seen:
                seen[name] += 1
                stem, _, ext = name.rpartition(".")
                name = f"{stem}_{seen[name]}.{ext}" if ext else f"{name}_{seen[name]}"
            else:
                seen[name] = 0
            try:
                zf.write(img.filepath, arcname=name)
            except OSError:
                pass
    buf.seek(0)
    return buf


def get_image_dimensions(filepath: str) -> tuple[int, int] | None:
    try:
        from PIL import Image
        with Image.open(filepath) as img:
            return img.size
    except Exception:
        return None


def _parse_image_timestamp(value: str, offset: str | None = None) -> datetime | None:
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
