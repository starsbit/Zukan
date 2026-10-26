import os
from pathlib import Path

import pytest

from backend.app.storage.filesystem import (
    LibraryFilesystem,
    STAGING_PREFIX,
    prepare_library_root,
)
from backend.app.storage.scanner import KnownAsset, scan_files


def test_incremental_scans_skip_unchanged_reads_but_manual_scan_hashes(
    tmp_path, monkeypatch
):
    filesystem = LibraryFilesystem(tmp_path, prepare_library_root(tmp_path))
    path = tmp_path / "image.png"
    path.write_bytes(b"first")
    monkeypatch.setattr(
        "backend.app.storage.scanner.resolve_supported_media_type",
        lambda *args, **kwargs: object(),
    )
    first = scan_files(filesystem, ".zukan", {}, set(), verify_contents=False)[0]
    known = {"image.png": KnownAsset(first.size, first.mtime_ns, first.sha256, True)}

    def forbidden(*args, **kwargs):
        raise AssertionError("An unchanged scheduled scan must not reread content")

    with monkeypatch.context() as patch:
        patch.setattr("backend.app.storage.scanner.file_digest", forbidden)
        result = scan_files(filesystem, ".zukan", known, set(), verify_contents=False)
        assert result[0].sha256 == first.sha256
    # A tool can preserve size and mtime when editing. Manual verification still detects it.
    path.write_bytes(b"other")
    os.utime(path, ns=(first.mtime_ns, first.mtime_ns))
    result = scan_files(filesystem, ".zukan", known, set(), verify_contents=True)
    assert result[0].sha256 != first.sha256


def test_scanning_ignores_staged_outputs_and_aborts_on_read_failure(
    tmp_path, monkeypatch
):
    filesystem = LibraryFilesystem(tmp_path, prepare_library_root(tmp_path))
    (tmp_path / f"{STAGING_PREFIX}unfinished.png").write_bytes(b"incomplete")
    assert scan_files(filesystem, ".zukan", {}, set(), verify_contents=True) == []
    path = tmp_path / "image.png"
    path.write_bytes(b"image")
    real_open = Path.open

    def inaccessible(candidate, *args, **kwargs):
        if candidate == path:
            raise PermissionError("Share ACL denied access")
        return real_open(candidate, *args, **kwargs)

    monkeypatch.setattr(Path, "open", inaccessible)
    with pytest.raises(PermissionError):
        scan_files(filesystem, ".zukan", {}, set(), verify_contents=True)
