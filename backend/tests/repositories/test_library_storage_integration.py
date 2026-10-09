import asyncio
import uuid
from pathlib import Path
from datetime import datetime, timezone

import pytest
from PIL import Image
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker
from backend.app.config import settings
from backend.app.models.library_storage import LibraryStorage, StorageMigration
from backend.app.models.media import Media, MediaType, MediaVisibility, TaggingStatus, ProcessingStatus
from backend.app.services import library_storage as service
from backend.app.services.storage_gate import StorageGate


@pytest.fixture
def library(tmp_path, monkeypatch, db_engine):
    source = tmp_path / 'old'; source.mkdir()
    target = tmp_path / 'nas'; target.mkdir()
    monkeypatch.setattr(settings, 'storage_dir', source)
    monkeypatch.setattr(settings, 'library_paths_relative', False)
    monkeypatch.setattr(settings, 'library_root_identity', None)
    monkeypatch.setattr(settings, 'generated_files_dir', '.zukan')
    monkeypatch.setattr(service, 'AsyncSessionLocal', async_sessionmaker(db_engine, expire_on_commit=False))
    monkeypatch.setattr(service, 'storage_gate', StorageGate())
    return source, target


@pytest.mark.asyncio
async def test_legacy_migration_preserves_records_and_removes_only_verified_sources(library, db_session, make_user):
    source, target = library
    user = await make_user()
    path = source / 'aa' / (uuid.uuid4().hex + '.png'); path.parent.mkdir()
    Image.new('RGB', (20, 30), 'red').save(path)
    thumb = source / 'aa' / 'thumb.webp'; Image.new('RGB', (10, 10)).save(thumb)
    (source / 'unrelated.txt').write_text('retain')
    media = Media(uploader_id=user.id, owner_id=user.id, filename='favorite.png', original_filename='favorite.png',
                  filepath=str(path), thumbnail_path=str(thumb), media_type=MediaType.IMAGE,
                  tagging_status=TaggingStatus.DONE, captured_at=datetime.now(timezone.utc),
                  deleted_at=datetime.now(timezone.utc), ocr_text_override='manual annotation',
                  visibility=MediaVisibility.private, version=7)
    db_session.add(media); await db_session.commit()
    mid = media.id
    await db_session.execute(text("CREATE OR REPLACE FUNCTION fn_bump_version() RETURNS TRIGGER AS $$ BEGIN NEW.version = OLD.version + 1; RETURN NEW; END; $$ LANGUAGE plpgsql"))
    await db_session.execute(text("CREATE TRIGGER trg_media_version BEFORE UPDATE ON media FOR EACH ROW EXECUTE FUNCTION fn_bump_version()"))
    await db_session.commit()
    await service.initialize_library()
    await service.start_migration(db_session, str(target))
    await asyncio.gather(*list(service.job_tasks))
    await db_session.refresh(media)
    job = await db_session.scalar(select(StorageMigration))
    assert job.state == 'complete', job.error
    assert media.id == mid and media.version == 7 and media.deleted_at and media.ocr_text_override == 'manual annotation'
    assert media.tagging_status == TaggingStatus.DONE
    assert not Path(media.filepath).is_absolute()
    assert (target / media.filepath).exists() and (target / media.thumbnail_path).exists()
    assert not path.exists() and not thumb.exists() and (source / 'unrelated.txt').exists()
    await service.initialize_library()
    assert settings.storage_dir == target


@pytest.mark.asyncio
async def test_scan_moves_flags_changes_and_retains_missing_metadata(library, db_session, make_user):
    source, _ = library
    user = await make_user()
    await service.initialize_library()
    await service.update_storage_settings(db_session, {'discovery_owner_id': str(user.id)})
    path = source / 'anime' / 'favorite.png'; path.parent.mkdir()
    Image.new('RGB', (20, 30), 'red').save(path)
    queue = asyncio.Queue()
    first = await service.scan_library(queue)
    assert first['added'] == 1
    media = await db_session.scalar(select(Media))
    mid = media.id
    assert media.visibility == MediaVisibility.private and media.uploader_id == user.id
    assert await service.scan_library(queue) == first or queue.qsize() == 1
    moved = path.with_name('renamed.png'); path.rename(moved)
    result = await service.scan_library(queue)
    await db_session.refresh(media)
    assert result['moved'] == 1 and media.id == mid and media.filepath == 'anime/renamed.png'
    Image.new('RGB', (20, 30), 'blue').save(moved)
    old_hash = media.sha256
    await service.scan_library(queue); await db_session.refresh(media)
    assert media.file_status == 'changed' and media.sha256 == old_hash
    await service.accept_changed_file(db_session, mid, queue)
    assert media.file_status == 'available' and media.sha256 != old_hash
    moved.unlink()
    await service.scan_library(queue); await db_session.refresh(media)
    assert media.file_status == 'missing' and media.id == mid


@pytest.mark.asyncio
async def test_disconnect_does_not_mark_library_missing(library, db_session, make_user):
    source, _ = library
    user = await make_user()
    await service.initialize_library()
    await service.update_storage_settings(db_session, {'discovery_owner_id': str(user.id)})
    marker = source / service.MARKER; marker.unlink()
    with pytest.raises((ValueError, OSError)):
        await service.scan_library(asyncio.Queue())
    config = await db_session.get(LibraryStorage, 1)
    assert config.last_scan is None


@pytest.mark.asyncio
async def test_failed_copy_resumes_without_cutover_or_losing_metadata(library, db_session, make_user, monkeypatch):
    source, target = library
    user = await make_user()
    await service.initialize_library()
    await service.update_storage_settings(db_session, {'discovery_owner_id': str(user.id)})
    for name, color in [('a.png', 'red'), ('b.png', 'blue')]:
        Image.new('RGB', (20, 30), color).save(source / name)
    await service.scan_library(asyncio.Queue())
    original_copy = service.copy_verified
    calls = 0
    def interrupted_copy(*args):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError('Simulated NAS interruption')
        return original_copy(*args)
    monkeypatch.setattr(service, 'copy_verified', interrupted_copy)
    result = await service.start_migration(db_session, str(target))
    await asyncio.gather(*list(service.job_tasks))
    job = await db_session.get(StorageMigration, result['id'], populate_existing=True)
    assert job.state == 'failed' and settings.storage_dir == source
    assert (source / 'a.png').exists() and (source / 'b.png').exists()
    assert any(entry['copied'] for entry in job.manifest)
    monkeypatch.setattr(service, 'copy_verified', original_copy)
    await service.run_migration(job.id)
    await db_session.refresh(job)
    assert job.state == 'complete' and settings.storage_dir == target
    assert len(list((await db_session.scalars(select(Media))).all())) == 2


@pytest.mark.asyncio
async def test_cleanup_retains_source_changed_after_switch(library, db_session, make_user, monkeypatch):
    source, target = library
    user = await make_user()
    await service.initialize_library()
    await service.update_storage_settings(db_session, {'discovery_owner_id': str(user.id)})
    path = source / 'a.png'; Image.new('RGB', (20, 30), 'red').save(path)
    original_bytes = path.read_bytes()
    await service.scan_library(asyncio.Queue())
    check = service.verify_runtime_assets
    def alter_source(manifest):
        check(manifest)
        path.write_bytes(b'new externally edited content')
    monkeypatch.setattr(service, 'verify_runtime_assets', alter_source)
    result = await service.start_migration(db_session, str(target))
    await asyncio.gather(*list(service.job_tasks))
    job = await db_session.get(StorageMigration, result['id'], populate_existing=True)
    assert job.state == 'cleanup_pending' and settings.storage_dir == target
    assert path.read_bytes() == b'new externally edited content'
    assert (target / 'a.png').read_bytes() == original_bytes
    monkeypatch.setattr(service, 'verify_runtime_assets', check)
    path.write_bytes(original_bytes)
    await service.run_migration(job.id); await db_session.refresh(job)
    assert job.state == 'complete' and not path.exists()


@pytest.mark.asyncio
async def test_ambiguous_moves_and_trashed_records_are_not_reimported(library, db_session, make_user):
    source, _ = library
    user = await make_user()
    await service.initialize_library()
    await service.update_storage_settings(db_session, {'discovery_owner_id': str(user.id)})
    path = source / 'a.png'; Image.new('RGB', (20, 30), 'red').save(path)
    queue = asyncio.Queue(); await service.scan_library(queue)
    media = await db_session.scalar(select(Media)); media.deleted_at = datetime.now(timezone.utc)
    await db_session.commit()
    await service.scan_library(queue); await db_session.refresh(media)
    assert media.deleted_at and queue.qsize() == 1
    content = path.read_bytes(); path.unlink()
    (source / 'copy1.png').write_bytes(content); (source / 'copy2.png').write_bytes(content)
    result = await service.scan_library(queue); await db_session.refresh(media)
    assert len(result['duplicates']) == 2 and result['added'] == result['moved'] == 0
    assert media.file_status == 'missing' and media.deleted_at


@pytest.mark.asyncio
async def test_file_routes_and_processing_after_migration(library, db_session, make_user, monkeypatch):
    import io
    import httpx
    from fastapi import FastAPI
    from backend.app.database import get_db
    from backend.app.routers import media as media_router
    from backend.app.routers.deps import current_user
    from backend.app.utils.frame_sampling import sample_media_frames
    from backend.app.utils.storage import zip_media
    source, target = library
    user = await make_user()
    await service.initialize_library()
    await service.update_storage_settings(db_session, {'discovery_owner_id': str(user.id)})
    Image.new('RGB', (20, 30), 'red').save(source / 'a.png')
    await service.scan_library(asyncio.Queue())
    record = await db_session.scalar(select(Media))
    await service.start_migration(db_session, str(target)); await asyncio.gather(*list(service.job_tasks))
    await db_session.refresh(record)
    app = FastAPI(); app.include_router(media_router.router, prefix='/api/v1')
    async def db_override():
        yield db_session
    app.dependency_overrides[get_db] = db_override
    app.dependency_overrides[current_user] = lambda: user
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        response = await client.get(f'/api/v1/media/{record.id}/file')
        assert response.status_code == 200 and response.content == (target / record.filepath).read_bytes()
        thumbnail = await client.get(f'/api/v1/media/{record.id}/thumbnail')
        assert thumbnail.status_code == 200
        with Image.open(io.BytesIO(thumbnail.content)) as image:
            assert image.format == 'WEBP'
    assert sample_media_frames(record.filepath, MediaType.IMAGE) == [target / record.filepath]
    import zipfile
    with zipfile.ZipFile(zip_media([record])) as archive:
        assert archive.read(record.filename) == response.content


@pytest.mark.asyncio
async def test_gif_and_video_migration_with_posters(library, db_session, make_user):
    import subprocess
    import shutil
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
        pytest.skip('ffmpeg and ffprobe are required for video migration checks')
    source, target = library
    user = await make_user()
    await service.initialize_library()
    await service.update_storage_settings(db_session, {'discovery_owner_id': str(user.id)})
    Image.new('RGB', (32, 32), 'red').save(source / 'animation.gif', save_all=True,
        append_images=[Image.new('RGB', (32, 32), 'blue')], duration=100, loop=0)
    subprocess.run(['ffmpeg', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=32x32:d=0.3', '-c:v', 'mpeg4', str(source / 'clip.mp4')], check=True, capture_output=True, timeout=30)
    result = await service.scan_library(asyncio.Queue())
    assert result['added'] == 2
    records = list((await db_session.scalars(select(Media))).all())
    assert {r.media_type for r in records} == {MediaType.GIF, MediaType.VIDEO}
    assert all(r.poster_path and r.thumbnail_path for r in records)
    await service.start_migration(db_session, str(target)); await asyncio.gather(*list(service.job_tasks))
    job = await db_session.scalar(select(StorageMigration))
    assert job.state == 'complete', job.error
    for record in records:
        await db_session.refresh(record)
        assert (target / record.filepath).exists() and (target / record.poster_path).exists()
        assert not (source / record.filepath).exists()


@pytest.mark.asyncio
async def test_storage_schema_upgrade_from_previous_revision(db_engine, db_session, make_user, make_media):
    from importlib import import_module
    from unittest.mock import patch
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    user = await make_user(); media = await make_media(uploader_id=user.id)
    mid = media.id
    migration = import_module('backend.migrations.versions.0020_nas_library')
    await db_session.commit()
    async with db_engine.begin() as connection:
        await connection.execute(text('DROP TABLE storage_migrations'))
        await connection.execute(text('DROP TABLE library_storage'))
        await connection.execute(text('ALTER TABLE media DROP COLUMN file_status'))
        def upgrade(sync_connection):
            with patch.object(migration, 'op', Operations(MigrationContext.configure(sync_connection))):
                migration.upgrade()
                migration.upgrade()  # compatible with the live-metadata release baseline
            setup_migration = import_module('backend.migrations.versions.0021_storage_setup_prompt')
            with patch.object(setup_migration, 'op', Operations(MigrationContext.configure(sync_connection))):
                setup_migration.upgrade()
        await connection.run_sync(upgrade)
    await db_session.refresh(media)
    assert media.id == mid and media.file_status == 'available'


@pytest.mark.asyncio
async def test_folder_confirmation_is_explicit_persistent_and_rejects_stale_roots(library, db_session):
    source, _ = library
    await service.initialize_library()
    config = await db_session.get(LibraryStorage, 1)
    assert not config.folder_configured
    with pytest.raises(ValueError, match='changed'):
        await service.confirm_storage_folder(db_session, '/wrong-folder')
    assert not config.folder_configured
    await service.confirm_storage_folder(db_session, str(source))
    await service.initialize_library()
    await db_session.refresh(config)
    assert config.folder_configured


@pytest.mark.asyncio
async def test_setup_prompt_upgrade_respects_existing_migrations(library, db_session, db_engine):
    from importlib import import_module
    from unittest.mock import patch
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    source, _ = library
    await service.initialize_library()
    config = await db_session.get(LibraryStorage, 1)
    db_session.add(StorageMigration(id=str(uuid.uuid4()), source_root='/old-library',
        source_identity=str(uuid.uuid4()), destination_root=str(source), destination_identity=config.root_identity,
        state='complete', manifest=[]))
    await db_session.commit()
    migration = import_module('backend.migrations.versions.0021_storage_setup_prompt')
    async with db_engine.begin() as connection:
        def upgrade(sync_connection):
            with patch.object(migration, 'op', Operations(MigrationContext.configure(sync_connection))):
                migration.upgrade()
        await connection.run_sync(upgrade)
    await db_session.refresh(config)
    assert config.folder_configured


@pytest.mark.asyncio
async def test_maintenance_cleans_missing_records_and_preserves_recovered_and_shared_assets(library, db_session, make_user):
    from backend.app.services import storage_maintenance as maintenance
    from backend.app.models.tags import Tag, MediaTag
    source, _ = library
    user = await make_user()
    await service.initialize_library()
    shared = source / 'shared.webp'; shared.write_bytes(b'preview')
    missing = Media(uploader_id=user.id, filepath='missing.jpg', filename='missing.jpg',
                    media_type=MediaType.IMAGE, thumbnail_path='shared.webp')
    recovered = Media(uploader_id=user.id, filepath='recovered.jpg', filename='recovered.jpg', media_type=MediaType.IMAGE)
    healthy = Media(uploader_id=user.id, filepath='healthy.jpg', filename='healthy.jpg',
                    media_type=MediaType.IMAGE, thumbnail_path='shared.webp', poster_path='lost.webp', ocr_text_override='retain')
    (source / 'healthy.jpg').write_bytes(b'original')
    for item in (missing, recovered, healthy):
        item.captured_at = datetime.now(timezone.utc)
    db_session.add_all([missing, recovered, healthy]); await db_session.flush()
    tag = Tag(name='manual', owner_user_id=user.id); db_session.add(tag); await db_session.flush()
    db_session.add(MediaTag(media_id=missing.id, tag_id=tag.id, confidence=1.0))
    await db_session.commit()
    report = await maintenance.inspect(db_session)
    assert len(report['items']) == 3
    (source / 'recovered.jpg').write_bytes(b'returned')
    result = await maintenance.cleanup(db_session, [missing.id, recovered.id, healthy.id], report['root'], report['root_identity'])
    assert result['deleted_ids'] == [str(missing.id)]
    assert result['repaired_ids'] == [str(healthy.id)]
    assert result['skipped_ids'] == [str(recovered.id)]
    assert await db_session.scalar(select(MediaTag).where(MediaTag.media_id == missing.id)) is None
    assert shared.exists() and healthy.ocr_text_override == 'retain' and healthy.poster_path is None
    assert healthy.poster_status == ProcessingStatus.FAILED
    assert (source / 'healthy.jpg').exists() and (source / 'recovered.jpg').exists()
    assert await service.validate_destination(db_session, str(library[1]))


@pytest.mark.asyncio
async def test_maintenance_refuses_disconnected_library_and_changed_root(library, db_session, make_user):
    from backend.app.services import storage_maintenance as maintenance
    await service.initialize_library()
    with pytest.raises(ValueError, match='Library changed'):
        await maintenance.cleanup(db_session, [], '/other', settings.library_root_identity)
    (library[0] / service.MARKER).unlink()
    with pytest.raises(ValueError, match='unavailable'):
        await maintenance.inspect(db_session)
    with pytest.raises(ValueError, match='unavailable'):
        await maintenance.cleanup(db_session, [], str(library[0]), settings.library_root_identity)


@pytest.mark.asyncio
async def test_maintenance_aborts_on_io_errors_and_unsafe_paths(library, db_session, make_user, monkeypatch):
    from backend.app.services import storage_maintenance as maintenance
    await service.initialize_library()
    user = await make_user()
    media = Media(uploader_id=user.id, filepath='missing.jpg', filename='missing.jpg',
                  media_type=MediaType.IMAGE, captured_at=datetime.now(timezone.utc))
    db_session.add(media); await db_session.commit()
    def io_failure(_):
        raise PermissionError('NAS access denied')
    with monkeypatch.context() as patch:
        patch.setattr(maintenance, 'missing_fields', io_failure)
        with pytest.raises(PermissionError):
            await maintenance.cleanup(db_session, [media.id], str(library[0]), settings.library_root_identity)
    await db_session.refresh(media)
    assert media.filepath == 'missing.jpg'
    media.filepath = '../outside.jpg'; await db_session.commit()
    with pytest.raises(ValueError, match='traversal'):
        await maintenance.cleanup(db_session, [media.id], str(library[0]), settings.library_root_identity)
    await db_session.refresh(media)
    assert media.id
