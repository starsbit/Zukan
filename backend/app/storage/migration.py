"""Verified filesystem operations for resumable library relocation.

The service layer owns database checkpoints and pauses writers. This layer owns
file publication and source cleanup, and revalidates both libraries before any
destructive step. A failed copy never publishes a partial destination.
"""

import shutil
from pathlib import Path

from backend.app.storage.filesystem import (
    LibraryFilesystem,
    configured_filesystem,
    file_digest,
    publish_without_overwrite,
)


def copy_verified(
    source: Path,
    target: Path,
    entry: dict,
    job_id: str,
    destination_root: Path | None = None,
    destination_identity: str | None = None,
    source_filesystem: LibraryFilesystem | None = None,
):
    expected = (entry["size"], entry["sha256"])
    destination = configured_filesystem(
        destination_root or target.parent, destination_identity
    )
    destination_snapshot = destination.snapshot()
    destination.path(destination.relative(target))
    source_snapshot = source_filesystem.snapshot() if source_filesystem else None
    if file_digest(source) != expected:
        raise ValueError(f"Source content changed: {source}")
    if target.exists():
        if file_digest(target) != expected:
            raise ValueError(f"Destination conflict: {target}")
        destination.verify(destination_snapshot)
        return
    try:
        with destination.atomic_output(target.absolute(), replace=False) as temporary:
            with source.open("rb") as src, temporary.open("wb") as dst:
                shutil.copyfileobj(src, dst, 1024 * 1024)
            if file_digest(temporary) != expected or file_digest(source) != expected:
                raise ValueError(f"Copy verification failed: {source}")
            if source_filesystem:
                source_filesystem.verify(source_snapshot)
    except FileExistsError:
        if file_digest(target) != expected:
            raise ValueError(f"Destination conflict: {target}")
    destination.verify(destination_snapshot)


def cleanup_verified_source(
    source: Path,
    destination: Path,
    entry: dict,
    job_id: str,
    source_filesystem: LibraryFilesystem | None = None,
    destination_filesystem: LibraryFilesystem | None = None,
):
    source_filesystem = source_filesystem or LibraryFilesystem(source.parent.absolute())
    destination_filesystem = destination_filesystem or LibraryFilesystem(
        destination.parent.absolute()
    )
    source_snapshot = source_filesystem.snapshot()
    destination_snapshot = destination_filesystem.snapshot()
    expected = (entry["size"], entry["sha256"])
    quarantine = source.with_name(f".{source.name}.{job_id}.cleanup")
    source_filesystem.path(source_filesystem.relative(source))
    source_filesystem.path(source_filesystem.relative(quarantine))
    destination_filesystem.path(destination_filesystem.relative(destination))

    def verify_libraries():
        source_filesystem.verify(source_snapshot)
        destination_filesystem.verify(destination_snapshot)

    def verify_content(path):
        if file_digest(path) != expected or file_digest(destination) != expected:
            raise ValueError(f"Source or destination changed; source retained: {path}")
        verify_libraries()

    if quarantine.exists():
        verify_content(quarantine)
        quarantine.unlink()
    if not source.exists():
        verify_libraries()
        return
    verify_content(source)
    publish_without_overwrite(source, quarantine)
    try:
        verify_content(quarantine)
    except BaseException:
        # Restore only on the same library and never overwrite an external edit.
        verify_libraries()
        if not source.exists():
            publish_without_overwrite(quarantine, source)
        raise
    verify_libraries()
    quarantine.unlink()
