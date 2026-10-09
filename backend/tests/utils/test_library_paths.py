from pathlib import Path
import pytest
from backend.app.config import settings
from backend.app.utils.library_paths import contained_path, resolve_media_path, stored_path
from backend.app.services.library_storage import file_digest, copy_verified, inspect_destination, discover_paths, ensure_marker, storage_available


@pytest.fixture
def library(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, 'storage_dir', tmp_path)
    monkeypatch.setattr(settings, 'library_paths_relative', True)
    return tmp_path


def test_relative_paths_are_contained(library):
    assert resolve_media_path('anime/a.png') == library / 'anime/a.png'
    assert stored_path(library / 'anime/a.png') == 'anime/a.png'
    for raw in ('../outside.png', '/etc/passwd', 'anime/../../outside.png'):
        with pytest.raises(ValueError):
            resolve_media_path(raw)
    (library / 'link').symlink_to(library / 'anime')
    with pytest.raises(ValueError):
        resolve_media_path('link/a.png')


def test_copy_is_verified_idempotent_and_never_overwrites(library, tmp_path):
    source = library / 'source.png'
    source.write_bytes(b'original')
    target = library / 'target.png'
    size, digest = file_digest(source)
    entry = {'size': size, 'sha256': digest}
    copy_verified(source, target, entry, 'job')
    copy_verified(source, target, entry, 'job')
    assert source.read_bytes() == target.read_bytes() == b'original'
    target.write_bytes(b'different')
    with pytest.raises(ValueError):
        copy_verified(source, target, entry, 'job')
    assert target.read_bytes() == b'different'


def test_destination_validation_overlap_and_conflict(tmp_path):
    source = tmp_path / 'source'; source.mkdir()
    target = tmp_path / 'target'; target.mkdir()
    (source / 'a').write_bytes(b'123')
    size, digest = file_digest(source / 'a')
    entries = [{'source': 'a', 'destination': 'a', 'size': size, 'sha256': digest}]
    assert inspect_destination(str(target), entries, source)['required_bytes'] == 3
    with pytest.raises(ValueError):
        inspect_destination(str(source), entries, source)
    (target / 'a').write_bytes(b'456')
    with pytest.raises(ValueError):
        inspect_destination(str(target), entries, source)


def test_scan_excludes_hidden_temporary_and_symlinks(library):
    (library / '.zukan').mkdir()
    (library / '.zukan' / 'thumb.png').write_bytes(b'x')
    (library / 'a.png').write_bytes(b'x')
    (library / 'b.partial').write_bytes(b'x')
    (library / 'link.png').symlink_to(library / 'a.png')
    assert list(discover_paths(library)) == [library / 'a.png']


def test_identity_distinguishes_disconnected_mount(library):
    identity = ensure_marker(library)
    assert storage_available(library, identity)
    (library / '.zukan-library-id').unlink()
    assert not storage_available(library, identity)


@pytest.mark.asyncio
async def test_migration_drains_writes_allows_reads_and_freezes_cutover(library, monkeypatch):
    import asyncio
    from backend.app.services.storage_gate import StorageGate
    gate = StorageGate()
    active = asyncio.Event(); release = asyncio.Event()
    async def writer():
        async with gate.operation():
            active.set(); await release.wait()
    task = asyncio.create_task(writer()); await active.wait()
    entered = asyncio.Event(); finish = asyncio.Event()
    async def migrate():
        async with gate.migration():
            entered.set(); await finish.wait()
    migration = asyncio.create_task(migrate()); await asyncio.sleep(0)
    assert gate.paused and not entered.is_set()
    release.set(); await task; await entered.wait()
    async with gate.operation(writer=False):
        assert gate.readers == 1
    async with gate.cutover():
        assert gate.frozen
    finish.set(); await migration
    assert not gate.paused and not gate.frozen


def test_copy_supports_shares_without_hardlinks(library, monkeypatch):
    import errno
    import os
    source = library / 'source'; source.write_bytes(b'original')
    target = library / 'target'
    size, digest = file_digest(source)
    def unsupported(*args):
        raise OSError(errno.ENOTSUP, 'Hard links unavailable')
    monkeypatch.setattr(os, 'link', unsupported)
    copy_verified(source, target, {'size': size, 'sha256': digest}, 'job')
    assert target.read_bytes() == b'original'


def test_cleanup_recovers_staged_source_and_retains_changed_data(library):
    from backend.app.services.library_storage import cleanup_verified_source
    source = library / 'source'; destination = library / 'destination'
    source.write_bytes(b'original'); destination.write_bytes(b'original')
    size, digest = file_digest(source); entry = {'size': size, 'sha256': digest}
    staged = source.with_name('.source.job.cleanup'); source.rename(staged)
    cleanup_verified_source(source, destination, entry, 'job')
    assert not staged.exists() and destination.exists()
    source.write_bytes(b'external change')
    with pytest.raises(ValueError):
        cleanup_verified_source(source, destination, entry, 'job')
    assert source.read_bytes() == b'external change'
