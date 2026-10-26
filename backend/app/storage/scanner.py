"""NAS discovery and fingerprints, independent of database/session state."""

import os
import stat
from dataclasses import dataclass
from pathlib import Path

from backend.app.storage.filesystem import (
    LibraryFilesystem,
    MARKER,
    STAGING_PREFIX,
    file_digest,
)
from backend.app.utils.media_detection import (
    SupportedMediaType,
    resolve_supported_media_type,
)


@dataclass(frozen=True)
class KnownAsset:
    size: int | None
    mtime_ns: int | None
    sha256: str | None
    available: bool


@dataclass(frozen=True)
class ScannedAsset:
    relative: str
    path: Path
    size: int
    sha256: str
    supported: SupportedMediaType | None
    mtime_ns: int
    mtime: float


def discover_paths(root: Path, generated_dir: str):
    generated = Path(generated_dir)

    def walk_error(error):
        raise error

    for base, dirs, files in os.walk(root, followlinks=False, onerror=walk_error):
        dirs[:] = [
            d
            for d in dirs
            if (Path(base) / d).relative_to(root) != generated
            and not (Path(base) / d).is_symlink()
        ]
        for name in files:
            path = Path(base) / name
            if (
                name == MARKER
                or name.startswith(STAGING_PREFIX)
                or name.endswith((".partial", ".tmp", ".part", ".cleanup"))
                or path.is_symlink()
            ):
                continue
            yield path


def scan_files(
    filesystem: LibraryFilesystem,
    generated_dir: str,
    known: dict[str, KnownAsset],
    derivatives: set[str],
    *,
    verify_contents: bool,
):
    snapshot = filesystem.snapshot()
    discovered = []
    for path in discover_paths(filesystem.root, generated_dir):
        relative = str(filesystem.relative(path))
        if relative in derivatives:
            continue
        info = path.stat()
        previous = known.get(relative)
        if not stat.S_ISREG(info.st_mode):
            if previous:
                raise OSError(f"Catalog asset is not a regular file: {path}")
            continue
        if (
            not verify_contents
            and previous
            and previous.available
            and previous.sha256
            and (previous.size, previous.mtime_ns) == (info.st_size, info.st_mtime_ns)
        ):
            # A full manual scan deliberately bypasses this metadata shortcut.
            discovered.append(
                ScannedAsset(
                    relative,
                    path,
                    info.st_size,
                    previous.sha256,
                    None,
                    info.st_mtime_ns,
                    info.st_mtime,
                )
            )
            continue
        with path.open("rb") as stream:
            header = stream.read(65536)
        supported = resolve_supported_media_type(header, source_name=path.name)
        if supported is None and previous is None:
            continue
        size, digest = file_digest(path)
        after = path.stat()
        if (info.st_size, info.st_mtime_ns, info.st_ino) != (
            after.st_size,
            after.st_mtime_ns,
            after.st_ino,
        ):
            raise OSError(f"File changed during scan: {path}")
        discovered.append(
            ScannedAsset(
                relative,
                path,
                size,
                digest,
                supported,
                after.st_mtime_ns,
                after.st_mtime,
            )
        )
    # No database changes occur if enumeration/read errors or mount loss occur.
    filesystem.verify(snapshot)
    return discovered
