"""A mounted library's filesystem boundary.

Database values are relative to a library, never to the process's working
folder. Marker and mount checks fail closed; writes stage on the destination
filesystem before atomic publication. Share ACLs and the process umask determine
permissions. No chmod, chown or cross-filesystem rename is required.
"""

from __future__ import annotations

import ctypes
import errno
import hashlib
import io
import logging
import os
import stat
import sys
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from backend.app.storage.mounts import mount_at

MARKER = ".zukan-library-id"
STAGING_PREFIX = ".zukan-write-"
logger = logging.getLogger(__name__)


class StorageUnavailable(OSError):
    """The expected library cannot currently be used safely."""


@dataclass(frozen=True)
class LibrarySnapshot:
    device: int
    inode: int
    identity: str | None
    mount_id: int | None = None


def contained_path(root: Path, relative: str | Path) -> Path:
    root = root.absolute()
    raw = Path(relative)
    if raw.is_absolute() or ".." in raw.parts:
        raise ValueError("Library paths must be relative and cannot contain traversal")
    target = root / raw
    current = target
    while current != root:
        if current.is_symlink():
            raise ValueError("Symlinks are not supported in the library")
        current = current.parent
    if root.is_symlink():
        raise ValueError("Library root cannot be a symlink")
    if not target.resolve().is_relative_to(root.resolve()):
        raise ValueError("Library path escapes the configured root")
    return target


def publish_without_overwrite(temp: Path, target: Path):
    """Publish with a no-replace rename, falling back to a hard link.

    NFS and SMB need not support hard links. Never emulate exclusivity using an
    exists-then-rename sequence, which could destroy an externally added file.
    """
    libc = ctypes.CDLL(None, use_errno=True)
    if sys.platform == "darwin" and hasattr(libc, "renamex_np"):
        result = libc.renamex_np(os.fsencode(temp), os.fsencode(target), 4)
    elif hasattr(libc, "renameat2"):
        result = libc.renameat2(-100, os.fsencode(temp), -100, os.fsencode(target), 1)
    else:
        result = -1
        ctypes.set_errno(errno.ENOSYS)
    if result == 0:
        return
    error = ctypes.get_errno()
    if error not in (errno.ENOSYS, errno.EINVAL, errno.ENOTSUP):
        raise OSError(error, os.strerror(error), str(target))
    os.link(temp, target)
    temp.unlink()


@dataclass(frozen=True)
class LibraryFilesystem:
    root: Path
    identity: str | None = None
    mount_path: Path | None = None
    mount_types: tuple[str, ...] = ()

    def snapshot(self) -> LibrarySnapshot:
        try:
            if self.root.is_symlink():
                raise StorageUnavailable("Library root cannot be a symlink")
            mount = None
            if self.mount_path and self.root.is_relative_to(self.mount_path):
                mount = mount_at(self.mount_path)
                if mount is None:
                    raise StorageUnavailable(
                        f"Library mount is not mounted: {self.mount_path}"
                    )
                if self.mount_types and mount.filesystem_type not in self.mount_types:
                    raise StorageUnavailable(
                        f"Library mount type {mount.filesystem_type!r} is not allowed; expected {self.mount_types}"
                    )
            info = self.root.stat()
            if not stat.S_ISDIR(info.st_mode):
                raise StorageUnavailable(f"Library is not a directory: {self.root}")
            identity = None
            if self.identity:
                marker = self.root / MARKER
                if marker.is_symlink():
                    raise StorageUnavailable("Library marker cannot be a symlink")
                identity = marker.read_text().strip()
                if identity != self.identity:
                    raise StorageUnavailable(
                        f"Library identity changed or mount is unavailable: {self.root}"
                    )
            return LibrarySnapshot(
                info.st_dev, info.st_ino, identity, mount.mount_id if mount else None
            )
        except StorageUnavailable:
            raise
        except OSError as exc:
            raise StorageUnavailable(
                f"Library is unavailable: {self.root}: {exc}"
            ) from exc

    def available(self) -> bool:
        try:
            self.snapshot()
            return True
        except StorageUnavailable:
            return False

    def verify(self, expected: LibrarySnapshot):
        if self.snapshot() != expected:
            raise StorageUnavailable("Library mount changed during the operation")

    def path(self, relative: str | Path) -> Path:
        return contained_path(self.root, relative)

    def relative(self, path: Path) -> Path:
        relative = path.absolute().relative_to(self.root)
        self.path(relative)
        return relative

    @contextmanager
    def atomic_output(self, path: Path, *, replace: bool = True):
        snapshot = self.snapshot()
        target = self.path(self.relative(path))
        temporary = target.parent / f"{STAGING_PREFIX}{uuid.uuid4().hex}{target.suffix}"
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            self.verify(snapshot)
            descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o666)
            os.close(descriptor)
            yield temporary
            # Reopen after the producer closes: detects share ACL/read failures.
            with temporary.open("rb") as stream:
                os.fsync(stream.fileno())
                stream.read(1)
            self.verify(snapshot)
            if replace:
                os.replace(temporary, target)
            else:
                publish_without_overwrite(temporary, target)
            self.verify(snapshot)
            with target.open("rb") as stream:
                stream.read(1)
        except FileExistsError:
            raise
        except OSError as exc:
            raise StorageUnavailable(
                f"Library write failed; check mount health and share ACLs: {target}: {exc}"
            ) from exc
        finally:
            # Never clean up a path on a replacement mount.
            try:
                if self.available() and self.snapshot() == snapshot:
                    temporary.unlink(missing_ok=True)
            except OSError:
                logger.warning(
                    "Unable to clean staged library file %s", temporary, exc_info=True
                )

    def write_stream(self, source, destination: Path) -> tuple[int, str]:
        digest = hashlib.sha256()
        size = 0
        with self.atomic_output(destination, replace=False) as temporary:
            with temporary.open("wb") as output:
                while chunk := source.read(1024 * 1024):
                    output.write(chunk)
                    digest.update(chunk)
                    size += len(chunk)
        return size, digest.hexdigest()

    def probe_writable(self):
        # os.access is insufficient for SMB/NFS ACLs. Exercise the same create,
        # flush, reopen, publish and delete operations as an actual upload.
        probe = self.root / f"{STAGING_PREFIX}probe-{uuid.uuid4().hex}"
        try:
            self.write_stream(io.BytesIO(b"zukan storage probe"), probe)
        finally:
            self.remove(probe.name)

    def read_header(self, relative: str | Path, size: int = 65536) -> bytes:
        snapshot = self.snapshot()
        with self.path(relative).open("rb") as stream:
            result = stream.read(size)
        self.verify(snapshot)
        return result

    def remove(self, relative: str | Path):
        snapshot = self.snapshot()
        path = self.path(relative)
        self.verify(snapshot)
        try:
            path.unlink()
        except FileNotFoundError:
            # Missing assets are harmless only on the expected mounted library.
            self.verify(snapshot)
        self.verify(snapshot)


def configured_filesystem(root: Path, identity: str | None = None) -> LibraryFilesystem:
    from backend.app.config import settings

    return LibraryFilesystem(
        root.absolute(),
        identity,
        settings.library_mount_path.absolute() if settings.library_mount_path else None,
        tuple(
            part.strip()
            for part in settings.library_mount_types.split(",")
            if part.strip()
        ),
    )


def current_filesystem() -> LibraryFilesystem:
    from backend.app.config import settings

    return configured_filesystem(
        settings.storage_dir,
        settings.library_root_identity if settings.library_paths_relative else None,
    )


def filesystem_for_path(path: Path) -> LibraryFilesystem:
    """Support pre-conversion legacy absolute paths at the compatibility edge."""
    from backend.app.config import settings

    filesystem = current_filesystem()
    if not settings.library_paths_relative and not path.absolute().is_relative_to(
        filesystem.root
    ):
        return LibraryFilesystem(path.absolute().parent)
    return filesystem


def file_digest(path: Path) -> tuple[int, str]:
    before = path.stat()
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    after = path.stat()
    if (before.st_size, before.st_mtime_ns, before.st_ino) != (
        after.st_size,
        after.st_mtime_ns,
        after.st_ino,
    ):
        raise OSError(f"File changed while being read: {path}")
    return after.st_size, digest.hexdigest()


def prepare_library_root(
    root: Path, mount_path: Path | None = None, mount_types: tuple[str, ...] = ()
) -> str:
    """Initialize local storage, or validate an operator-mounted NAS directory."""
    if not root.is_absolute() or (mount_path and not mount_path.is_absolute()):
        raise ValueError("Library and mount paths must be absolute")
    if mount_path and not root.is_relative_to(mount_path):
        raise ValueError(
            "Initial library root must be inside the configured mountpoint"
        )
    if mount_path and root.is_relative_to(mount_path):
        # Do not mkdir the mountpoint or a missing library on the host fallback.
        LibraryFilesystem(
            mount_path, mount_path=mount_path, mount_types=mount_types
        ).snapshot()
        if not root.is_dir():
            raise StorageUnavailable(
                "Create the library directory on the mounted NAS first"
            )
    else:
        if root.is_symlink():
            raise ValueError("Library root cannot be a symlink")
        root.mkdir(parents=True, exist_ok=True)
    filesystem = LibraryFilesystem(root, mount_path=mount_path, mount_types=mount_types)
    filesystem.snapshot()
    return ensure_marker(filesystem)


def ensure_marker(filesystem: LibraryFilesystem, identity: str | None = None) -> str:
    marker = filesystem.path(MARKER)
    if marker.exists():
        existing = marker.read_text().strip()
        uuid.UUID(existing)
        if identity and existing != identity:
            raise ValueError("Library destination identity changed")
        return existing
    identity = identity or str(uuid.uuid4())
    try:
        with filesystem.atomic_output(marker, replace=False) as temporary:
            temporary.write_text(identity)
    except FileExistsError:
        return ensure_marker(filesystem, identity=None)
    return identity
