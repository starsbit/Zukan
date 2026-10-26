import asyncio
import errno
import io
import threading
from pathlib import Path

import pytest

from backend.app.storage.filesystem import (
    LibraryFilesystem,
    StorageUnavailable,
    MARKER,
    STAGING_PREFIX,
    prepare_library_root,
)
from backend.app.storage.io import run_storage_io
from backend.app.services.storage_gate import StorageGate


@pytest.fixture
def filesystem(tmp_path):
    identity = prepare_library_root(tmp_path)
    return LibraryFilesystem(tmp_path, identity)


def test_failed_producer_leaves_previous_asset_and_no_partial_files(filesystem):
    target = filesystem.root / "thumb.webp"
    target.write_bytes(b"previous")
    with pytest.raises(RuntimeError):
        with filesystem.atomic_output(target) as staged:
            staged.write_bytes(b"half-written")
            assert target.read_bytes() == b"previous"
            raise RuntimeError("interrupted encoder")
    assert target.read_bytes() == b"previous"
    assert not list(filesystem.root.glob(f"{STAGING_PREFIX}*"))


def test_no_overwrite_publication_retains_external_files(filesystem):
    target = filesystem.root / "original.jpg"
    target.write_bytes(b"external original")
    with pytest.raises(FileExistsError):
        filesystem.write_stream(io.BytesIO(b"upload"), target)
    assert target.read_bytes() == b"external original"


def test_mount_loss_blocks_writes_and_deletes_then_recovers(filesystem):
    target = filesystem.root / "original.jpg"
    target.write_bytes(b"original")
    marker = filesystem.root / MARKER
    identity = marker.read_text()
    marker.unlink()
    with pytest.raises(StorageUnavailable):
        filesystem.remove("original.jpg")
    with pytest.raises(StorageUnavailable):
        filesystem.write_stream(io.BytesIO(b"upload"), filesystem.root / "new.jpg")
    assert target.read_bytes() == b"original"
    assert not (filesystem.root / "new.jpg").exists()
    marker.write_text(identity)
    filesystem.write_stream(io.BytesIO(b"restored"), filesystem.root / "new.jpg")
    assert (filesystem.root / "new.jpg").read_bytes() == b"restored"


def test_lost_mount_during_write_never_publishes(filesystem):
    target = filesystem.root / "original.jpg"
    with pytest.raises(StorageUnavailable):
        with filesystem.atomic_output(target) as staged:
            staged.write_bytes(b"complete")
            (filesystem.root / MARKER).unlink()
    assert not target.exists()


def test_mount_guard_never_creates_fallback_library(tmp_path, monkeypatch):
    mount = tmp_path / "mnt"
    mount.mkdir()
    root = mount / "library"
    monkeypatch.setattr(Path, "is_mount", lambda path: False)
    with pytest.raises(StorageUnavailable, match="not mounted"):
        prepare_library_root(root, mount)
    assert not root.exists()
    assert list(mount.iterdir()) == []


def test_share_acl_failures_are_reported_without_publishing_or_chmod(
    filesystem, monkeypatch
):
    target = filesystem.root / "asset.jpg"
    real_open = Path.open

    def acl_read(path, mode="r", *args, **kwargs):
        if path.name.startswith(STAGING_PREFIX) and mode == "rb":
            raise PermissionError(errno.EACCES, "NAS ACL denies reopening")
        return real_open(path, mode, *args, **kwargs)

    monkeypatch.setattr(Path, "open", acl_read)
    with pytest.raises(StorageUnavailable, match="share ACLs"):
        filesystem.write_stream(io.BytesIO(b"original"), target)
    assert not target.exists()
    assert not list(filesystem.root.glob(f"{STAGING_PREFIX}*"))


def test_delete_io_failure_is_not_treated_as_missing(filesystem, monkeypatch):
    target = filesystem.root / "original.jpg"
    target.write_bytes(b"original")
    real_unlink = Path.unlink

    def unlink(path, *args, **kwargs):
        if path == target:
            raise OSError(errno.EIO, "NAS I/O error")
        return real_unlink(path, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", unlink)
    with pytest.raises(OSError, match="NAS I/O error"):
        filesystem.remove("original.jpg")
    assert target.exists()


@pytest.mark.asyncio
async def test_cancelled_io_keeps_writer_lease_until_thread_stops(
    tmp_path, monkeypatch
):
    from backend.app.config import settings

    monkeypatch.setattr(settings, "storage_dir", tmp_path)
    monkeypatch.setattr(settings, "library_root_identity", None)
    gate = StorageGate()
    entered = threading.Event()
    release = threading.Event()

    def write():
        entered.set()
        release.wait(timeout=5)

    async def operation():
        async with gate.operation():
            await run_storage_io(write)

    task = asyncio.create_task(operation())
    while not entered.is_set():
        await asyncio.sleep(0.01)
    task.cancel()
    try:
        await asyncio.sleep(0.02)
        assert gate.writers == 1
    finally:
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await task
    assert gate.writers == 0


def test_nas_guard_rejects_local_filesystem_bound_into_container(tmp_path, monkeypatch):
    from backend.app.storage.mounts import MountedVolume

    monkeypatch.setattr(
        "backend.app.storage.filesystem.mount_at",
        lambda path: MountedVolume(42, "ext4"),
    )
    filesystem = LibraryFilesystem(
        tmp_path, mount_path=tmp_path, mount_types=("nfs", "nfs4", "cifs")
    )
    with pytest.raises(StorageUnavailable, match="not allowed"):
        filesystem.snapshot()
    with pytest.raises(StorageUnavailable):
        prepare_library_root(tmp_path, tmp_path, ("nfs", "nfs4", "cifs"))
    assert list(tmp_path.iterdir()) == []


def test_changed_mount_id_aborts_even_if_marker_and_root_inode_match(
    filesystem, monkeypatch
):
    from backend.app.storage.mounts import MountedVolume

    filesystem = LibraryFilesystem(
        filesystem.root, filesystem.identity, filesystem.root
    )
    monkeypatch.setattr(
        "backend.app.storage.filesystem.mount_at",
        lambda path: MountedVolume(42, "nfs4"),
    )
    snapshot = filesystem.snapshot()
    monkeypatch.setattr(
        "backend.app.storage.filesystem.mount_at",
        lambda path: MountedVolume(43, "nfs4"),
    )
    with pytest.raises(StorageUnavailable, match="changed"):
        filesystem.verify(snapshot)


@pytest.mark.asyncio
async def test_upload_streams_spooled_file_without_unbounded_reads(
    tmp_path, monkeypatch
):
    from fastapi import UploadFile
    from starlette.datastructures import Headers
    from backend.app.config import settings
    from backend.app.utils.storage import save_upload

    monkeypatch.setattr(settings, "storage_dir", tmp_path)
    monkeypatch.setattr(settings, "library_paths_relative", False)
    monkeypatch.setattr(settings, "library_mount_path", None)
    content = b"x" * (3 * 1024 * 1024 + 19)

    class Source(io.BytesIO):
        def read(self, size=-1):
            assert 0 <= size <= 1024 * 1024
            return super().read(size)

    upload = UploadFile(
        filename="large.png",
        file=Source(content),
        headers=Headers({"content-type": "image/png"}),
    )
    saved = await save_upload(upload)
    assert saved.file_size == len(content)
    assert saved.path.read_bytes() == content


def test_write_probe_uses_real_operations_and_leaves_no_files(filesystem):
    filesystem.probe_writable()
    assert [p.name for p in filesystem.root.iterdir()] == [MARKER]


@pytest.mark.asyncio
async def test_workflow_io_is_bounded_and_keeps_event_loop_responsive():
    lock = threading.Lock()
    release = threading.Event()
    active = 0
    peak = 0

    def operation():
        nonlocal active, peak
        with lock:
            active += 1
            peak = max(peak, active)
        release.wait(timeout=5)
        with lock:
            active -= 1

    tasks = [asyncio.create_task(run_storage_io(operation)) for _ in range(6)]
    try:
        async with asyncio.timeout(3):
            while peak < 4:
                await asyncio.sleep(0.01)
        await asyncio.sleep(0.02)
        assert peak == 4
        assert not any(task.done() for task in tasks)
    finally:
        release.set()
        await asyncio.gather(*tasks)
    assert active == 0
    assert peak == 4
