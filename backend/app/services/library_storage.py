"""Persistent NAS library discovery and verified, resumable relocation."""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select, text
from backend.app.config import settings
from backend.app.database import AsyncSessionLocal, engine
from backend.app.models.auth import User
from backend.app.models.embeddings import MediaEmbedding
from backend.app.models.library_storage import LibraryStorage, StorageMigration
from backend.app.models.media import Media, MediaVisibility, ProcessingStatus, TaggingStatus
from backend.app.services.storage_gate import storage_gate
from backend.app.utils.library_paths import contained_path, root_path, validate_generated_dir
from backend.app.utils.media_detection import resolve_supported_media_type
from backend.app.utils.media_metadata import extract_media_metadata
from backend.app.utils.thumbnails import generate_poster_and_thumbnail

logger = logging.getLogger(__name__)
MARKER = '.zukan-library-id'
PATH_FIELDS = ('filepath', 'thumbnail_path', 'poster_path')
job_tasks: set[asyncio.Task] = set()
scan_lock = asyncio.Lock()
control_lock = asyncio.Lock()


def file_digest(path: Path) -> tuple[int, str]:
    before = path.stat()
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    after = path.stat()
    if (before.st_size, before.st_mtime_ns, before.st_ino) != (after.st_size, after.st_mtime_ns, after.st_ino):
        raise OSError(f'File changed while being read: {path}')
    return after.st_size, digest.hexdigest()


def storage_available(root: Path | None = None, identity: str | None = None) -> bool:
    root = root or root_path()
    identity = identity if identity is not None else settings.library_root_identity
    try:
        return root.is_dir() and (not identity or (root / MARKER).read_text().strip() == identity)
    except OSError:
        return False


def legacy_relative(value: str, root: Path) -> str:
    raw = Path(value)
    # Original installs recorded either absolute paths or storage/xx/file paths.
    candidate = raw if raw.is_absolute() else raw.resolve()
    if candidate.is_relative_to(root):
        relative = str(candidate.relative_to(root))
    else:
        raise ValueError(f'Legacy media path is outside the configured storage root: {value}')
    contained_path(root, relative)
    return relative


def apply_config(config: LibraryStorage):
    settings.storage_dir = Path(config.root)
    settings.generated_files_dir = config.generated_dir
    settings.library_root_identity = config.root_identity
    settings.library_paths_relative = True
    storage_gate.available = storage_available()


async def acquire_storage_lease():
    # The filesystem gate belongs to one API process. Enforce that invariant
    # across replicas/workers instead of allowing an unsafe second writer.
    connection = await engine.connect()
    try:
        locked = await connection.scalar(text('SELECT pg_try_advisory_lock(1515544910)'))
        await connection.commit()
        if not locked:
            raise RuntimeError('Another Zukan API process owns this library; run a single API worker')
        return connection
    except BaseException:
        await connection.close()
        raise


async def release_storage_lease(connection):
    if connection is not None:
        try:
            await connection.execute(text('SELECT pg_advisory_unlock(1515544910)'))
        finally:
            await connection.close()


async def pause_version_trigger(db):
    exists = await db.scalar(text("SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'media'::regclass AND tgname = 'trg_media_version' AND tgenabled <> 'D')"))
    if exists:
        await db.execute(text('ALTER TABLE media DISABLE TRIGGER trg_media_version'))
    return exists


async def restore_version_trigger(db, paused):
    await db.flush()
    if paused:
        await db.execute(text('ALTER TABLE media ENABLE TRIGGER trg_media_version'))


async def initialize_library():
    async with AsyncSessionLocal() as db:
        config = await db.get(LibraryStorage, 1)
        if config is None:
            root = settings.storage_dir.resolve()
            root.mkdir(parents=True, exist_ok=True)
            config = LibraryStorage(id=1, root=str(root), generated_dir='.zukan', scan_interval_seconds=3600)
            config.root_identity = ensure_marker(root)
            paused = await pause_version_trigger(db)
            for media in (await db.scalars(select(Media))).all():
                for field in PATH_FIELDS:
                    value = getattr(media, field)
                    if value:
                        setattr(media, field, legacy_relative(value, root))
            db.add(config)
            await restore_version_trigger(db, paused)
            await db.commit()
        apply_config(config)


def ensure_marker(root: Path, identity: str | None = None) -> str:
    marker = root / MARKER
    if marker.is_symlink():
        raise ValueError('Library identity marker cannot be a symlink')
    if marker.exists():
        existing = marker.read_text().strip()
        uuid.UUID(existing)
        if identity and existing != identity:
            raise ValueError('Library destination identity changed')
        return existing
    identity = identity or str(uuid.uuid4())
    with marker.open('x') as stream:
        stream.write(identity)
    return identity


async def get_storage_status(db):
    config = await db.get(LibraryStorage, 1)
    available = await asyncio.to_thread(storage_available)
    storage_gate.available = available
    latest = await db.scalar(select(StorageMigration).order_by(StorageMigration.created_at.desc()).limit(1))
    conflicts = (await db.scalars(select(Media).where(Media.file_status != 'available'))).all()
    return {
        'root': config.root, 'generated_dir': config.generated_dir,
        'folder_configured': config.folder_configured,
        'discovery_owner_id': config.discovery_owner_id,
        'scan_interval_seconds': config.scan_interval_seconds,
        'available': available, 'scanning': scan_lock.locked(), 'last_scan': config.last_scan,
        'migration': job_status(latest) if latest else None,
        'conflicts': [{'id': str(m.id), 'path': m.filepath, 'status': m.file_status} for m in conflicts],
    }


def job_status(job):
    return {'id': job.id, 'state': job.state, 'error': job.error,
            'source_root': job.source_root, 'destination_root': job.destination_root,
            'total_files': len(job.manifest),
            'copied_files': sum(bool(x.get('copied')) for x in job.manifest),
            'cleaned_files': sum(bool(x.get('cleaned')) for x in job.manifest)}


async def confirm_storage_folder(db, root: str):
    if storage_gate.paused:
        raise ValueError('Wait for migration to finish before confirming the folder')
    async with control_lock, storage_gate.operation():
        config = await db.get(LibraryStorage, 1, populate_existing=True)
        if root != config.root:
            raise ValueError('The library folder changed; refresh and confirm the current folder')
        if not storage_available(Path(config.root), config.root_identity) or not os.access(config.root, os.R_OK | os.W_OK | os.X_OK):
            raise ValueError('The library folder must be available, readable and writable')
        config.folder_configured = True
        await db.commit()
    return {'folder_configured': True}


async def update_storage_settings(db, changes):
    if storage_gate.paused:
        raise ValueError('Wait for migration to finish')
    async with control_lock, storage_gate.operation(require_available=False):
        if storage_gate.migration_lock.locked() or scan_lock.locked():
            raise ValueError('Wait for the current storage operation to finish')
        config = await db.get(LibraryStorage, 1)
        owner = changes.get('discovery_owner_id')
        if owner and await db.get(User, uuid.UUID(owner)) is None:
            raise ValueError('Discovery owner does not exist')
        generated = changes.get('generated_dir')
        if generated is not None:
            validate_generated_dir(generated)
        for key, value in changes.items():
            setattr(config, key, value)
        await db.commit()
        apply_config(config)
    return await get_storage_status(db)


def inspect_destination(destination: str, manifest: list, source: Path):
    target = Path(destination)
    if not target.is_absolute() or target.is_symlink():
        raise ValueError('Destination must be an absolute, mounted directory')
    target = target.resolve()
    if target.is_relative_to(source) or source.is_relative_to(target):
        raise ValueError('Source and destination must not overlap')
    if not target.is_dir():
        raise ValueError('Destination directory does not exist; mount it first')
    if not os.access(target, os.R_OK | os.W_OK | os.X_OK):
        raise ValueError('Destination must be readable and writable')
    required = 0
    for entry in manifest:
        src = contained_path(source, entry['source'])
        size, digest = file_digest(src)
        if (size, digest) != (entry['size'], entry['sha256']):
            raise ValueError(f"Source changed: {entry['source']}")
        dest = contained_path(target, entry['destination'])
        if dest.exists():
            if file_digest(dest) != (size, digest):
                raise ValueError(f"Destination contains different content: {entry['destination']}")
        else:
            required += size
    if shutil.disk_usage(target).free < required:
        raise ValueError('Insufficient destination space')
    return {'destination_root': str(target), 'required_bytes': required, 'total_files': len(manifest)}


async def build_manifest(db):
    entries = []
    for media in (await db.scalars(select(Media).execution_options(populate_existing=True))).all():
        for field in PATH_FIELDS:
            relative = getattr(media, field)
            if not relative:
                continue
            path = contained_path(root_path(), relative)
            size, digest = await asyncio.to_thread(file_digest, path)
            if field == "filepath" and media.sha256 and digest != media.sha256 and media.file_status == "available":
                raise ValueError(f"Source content changed; scan and review it before migration: {relative}")
            destination = relative
            if field != 'filepath':
                folder = 'thumbnails' if field == 'thumbnail_path' else 'posters'
                destination = f'{settings.generated_files_dir}/{folder}/{media.id.hex[:2]}/{media.id.hex}{path.suffix}'
            entries.append({'media_id': str(media.id), 'field': field, 'source': relative,
                            'destination': destination, 'size': size, 'sha256': digest,
                            'media_type': getattr(media.media_type, 'value', media.media_type),
                            'copied': False, 'cleaned': False})
    return entries


async def validate_destination(db, destination):
    if not storage_available():
        raise ValueError('Source library is unavailable')
    manifest = await build_manifest(db)
    return await asyncio.to_thread(inspect_destination, destination, manifest, root_path())


async def start_migration(db, destination):
    async with control_lock:
        return await _start_migration(db, destination)


async def _start_migration(db, destination):
    if storage_gate.migration_lock.locked() or scan_lock.locked() or job_tasks:
        raise ValueError('A storage operation is already running')
    unfinished = await db.scalar(select(StorageMigration).where(StorageMigration.state != 'complete').limit(1))
    if unfinished:
        raise ValueError('Resume the existing migration before starting another')
    # Hold writer pause through manifest construction, then transfer it to the job.
    async with storage_gate.migration():
        manifest = await build_manifest(db)
        if not storage_available():
            raise ValueError('Source library is unavailable')
        result = await asyncio.to_thread(inspect_destination, destination, manifest, root_path())
        target = Path(result['destination_root'])
        identity = await asyncio.to_thread(ensure_marker, target)
        job = StorageMigration(id=str(uuid.uuid4()), source_root=str(root_path()),
                               destination_root=str(target), destination_identity=identity,
                               state='copying', source_identity=settings.library_root_identity, manifest=manifest)
        db.add(job)
        await db.commit()
        spawn_job(job.id)
    return job_status(job)


def spawn_job(job_id):
    storage_gate.pending = True
    storage_gate.paused = True
    task = asyncio.create_task(run_migration(job_id))
    job_tasks.add(task)
    task.add_done_callback(job_tasks.discard)


async def save_manifest(db, job, manifest):
    job.manifest = [dict(entry) for entry in manifest]
    await db.commit()


def publish_without_overwrite(temp: Path, target: Path):
    import errno
    try:
        os.link(temp, target)
        return
    except OSError as exc:
        if exc.errno not in (errno.EPERM, errno.ENOTSUP, errno.EXDEV):
            raise
    # Shares without hard-link support can still publish via an exclusive
    # atomic rename. Never fall back to an overwrite-capable rename.
    import ctypes
    import sys
    libc = ctypes.CDLL(None, use_errno=True)
    if sys.platform == 'darwin':
        result = libc.renamex_np(os.fsencode(temp), os.fsencode(target), 4)  # RENAME_EXCL
    elif hasattr(libc, 'renameat2'):
        result = libc.renameat2(-100, os.fsencode(temp), -100, os.fsencode(target), 1)  # RENAME_NOREPLACE
    else:
        raise OSError('This filesystem does not support exclusive atomic file publication')
    if result:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error), str(target))


def copy_verified(source: Path, target: Path, entry: dict, job_id: str):
    expected = (entry['size'], entry['sha256'])
    if file_digest(source) != expected:
        raise ValueError(f'Source content changed: {source}')
    if target.exists():
        if file_digest(target) != expected:
            raise ValueError(f'Destination conflict: {target}')
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_name(f'.{target.name}.{job_id}.partial')
    if temp.is_symlink():
        raise ValueError('Temporary migration path is a symlink')
    with source.open('rb') as src, temp.open('wb') as dst:
        shutil.copyfileobj(src, dst, 1024 * 1024)
        dst.flush()
        os.fsync(dst.fileno())
    if file_digest(temp) != expected or file_digest(source) != expected:
        raise ValueError(f'Copy verification failed: {source}')
    # Exclusive hard-link publication prevents replacing a concurrently-created file.
    try:
        publish_without_overwrite(temp, target)
    except FileExistsError:
        if file_digest(target) != expected:
            raise ValueError(f'Destination conflict: {target}')
    finally:
        temp.unlink(missing_ok=True)


def cleanup_verified_source(source: Path, destination: Path, entry: dict, job_id: str):
    expected = (entry['size'], entry['sha256'])
    quarantine = source.with_name(f'.{source.name}.{job_id}.cleanup')
    if quarantine.is_symlink():
        raise ValueError('Cleanup staging path is a symlink')
    if quarantine.exists():
        if file_digest(quarantine) != expected or file_digest(destination) != expected:
            raise ValueError(f'Cleanup staging content changed; retained: {quarantine}')
        quarantine.unlink()
    if not source.exists():
        return
    if file_digest(source) != expected or file_digest(destination) != expected:
        raise ValueError(f'Source or destination changed; source retained: {source}')
    source.rename(quarantine)
    try:
        if file_digest(quarantine) != expected or file_digest(destination) != expected:
            raise ValueError(f'File changed during cleanup; retained: {quarantine}')
    except BaseException:
        if not source.exists():
            publish_without_overwrite(quarantine, source)
            quarantine.unlink(missing_ok=True)
        raise
    quarantine.unlink()


def verify_manifest(target: Path, manifest: list):
    for entry in manifest:
        path = contained_path(target, entry['destination'])
        if file_digest(path) != (entry['size'], entry['sha256']):
            raise ValueError(f'Destination verification failed: {path}')
        # Exercise the exact paths consumed by responses and processing services.
        with path.open('rb') as stream:
            stream.read(64)


def verify_runtime_assets(manifest: list):
    from PIL import Image
    from backend.app.utils.library_paths import resolve_media_path
    from backend.app.utils.frame_sampling import sample_media_frames, cleanup_sampled_frames
    from backend.app.utils.storage import ffmpeg_available
    for entry in manifest:
        path = resolve_media_path(entry['destination'])
        with path.open('rb') as stream:
            stream.read(64)
        if entry['field'] != 'filepath' or entry.get('media_type') in ('image', 'gif'):
            with Image.open(path) as image:
                image.verify()
        elif entry.get('media_type') == 'video' and ffmpeg_available():
            frames = sample_media_frames(entry['destination'], 'video', sample_count=1)
            try:
                if not frames:
                    raise ValueError(f'Video processing check failed: {path}')
                with Image.open(frames[0]) as image:
                    image.verify()
            finally:
                cleanup_sampled_frames(frames)


async def run_migration(job_id):
    async with storage_gate.migration():
        async with AsyncSessionLocal() as db:
            job = await db.get(StorageMigration, job_id)
            if job is None or job.state == 'complete':
                return
            manifest = [dict(x) for x in job.manifest]
            source, target = Path(job.source_root), Path(job.destination_root)
            config = await db.get(LibraryStorage, 1)
            switched = config.root == job.destination_root
            try:
                if not storage_available(target, job.destination_identity):
                    raise ValueError('Destination NAS is unavailable or changed identity')
                job.error = None
                if not switched:
                    if not storage_available(source, config.root_identity):
                        raise ValueError('Source library is unavailable')
                    job.state = 'copying'
                    await db.commit()
                    for entry in manifest:
                        if not storage_available(source, job.source_identity) or not storage_available(target, job.destination_identity):
                            raise ValueError('Storage disconnected during copy')
                        src = contained_path(source, entry['source'])
                        dest = contained_path(target, entry['destination'])
                        await asyncio.to_thread(copy_verified, src, dest, entry, job.id)
                        entry['copied'] = True
                        await save_manifest(db, job, manifest)
                    job.state = 'verifying'
                    await db.commit()
                    await asyncio.to_thread(verify_manifest, target, manifest)
                    async with storage_gate.cutover():
                        # No mutation can have escaped the pause since manifest capture.
                        paused = await pause_version_trigger(db)
                        for entry in manifest:
                            media = await db.get(Media, uuid.UUID(entry['media_id']))
                            if media is None or getattr(media, entry['field']) != entry['source']:
                                raise ValueError('Library records changed during migration')
                            setattr(media, entry['field'], entry['destination'])
                        config.folder_configured = True
                        config.root = str(target)
                        config.root_identity = job.destination_identity
                        job.state = 'cleanup'
                        await restore_version_trigger(db, paused)
                        await db.commit()
                        apply_config(config)
                        switched = True
                if not storage_available(source, job.source_identity):
                    raise ValueError("Source storage unavailable; cleanup deferred")
                # Recheck every destination asset before removing any source asset.
                await asyncio.to_thread(verify_manifest, target, manifest)
                await asyncio.to_thread(verify_runtime_assets, manifest)
                for entry in manifest:
                    if entry.get('cleaned'):
                        continue
                    if not storage_available(source, job.source_identity):
                        raise ValueError('Source disappeared during cleanup')
                    if not storage_available(target, job.destination_identity):
                        raise ValueError('Destination disappeared during cleanup')
                    src = contained_path(source, entry['source'])
                    dest = contained_path(target, entry['destination'])
                    expected = (entry['size'], entry['sha256'])
                    if await asyncio.to_thread(file_digest, dest) != expected:
                        raise ValueError('Destination changed during cleanup')
                    await asyncio.to_thread(cleanup_verified_source, src, dest, entry, job.id)
                    entry['cleaned'] = True
                    await save_manifest(db, job, manifest)
                job.state = 'complete'
                await db.commit()
            except Exception as exc:
                await db.rollback()
                job = await db.get(StorageMigration, job_id)
                job.state = 'cleanup_pending' if switched else 'failed'
                job.error = str(exc)
                await db.commit()
                logger.exception('Storage migration %s paused', job_id)


async def resume_migrations():
    async with AsyncSessionLocal() as db:
        for job in (await db.scalars(select(StorageMigration).where(StorageMigration.state.in_(('copying', 'verifying', 'cleanup'))))).all():
            spawn_job(job.id)


def discover_paths(root: Path):
    generated = Path(settings.generated_files_dir)
    def walk_error(error):
        raise error
    for base, dirs, files in os.walk(root, followlinks=False, onerror=walk_error):
        dirs[:] = [d for d in dirs if (Path(base) / d).relative_to(root) != generated and not (Path(base) / d).is_symlink()]
        for name in files:
            path = Path(base) / name
            if name == MARKER or name.endswith(('.partial', '.tmp', '.part', '.cleanup')) or path.is_symlink():
                continue
            yield path


async def scan_library(queue):
    if scan_lock.locked() or storage_gate.paused:
        raise ValueError('A scan or migration is already running')
    async with scan_lock, storage_gate.operation():
        async with AsyncSessionLocal() as db:
            config = await db.get(LibraryStorage, 1)
            if not config.discovery_owner_id:
                raise ValueError('Select a discovery owner before scanning')
            owner = await db.get(User, uuid.UUID(config.discovery_owner_id))
            if owner is None:
                raise ValueError('Discovery owner no longer exists')
            if not storage_available():
                storage_gate.available = False
                raise ValueError('NAS library is unavailable')
            records = list((await db.scalars(select(Media))).all())
            by_path = {m.filepath: m for m in records}
            derivative_paths = {getattr(m, f) for m in records for f in ('thumbnail_path', 'poster_path')}
            root = root_path()
            discovered = []
            # Complete enumeration and hashes before marking anything missing.
            paths = await asyncio.to_thread(lambda: list(discover_paths(root)))
            for path in paths:
                relative = str(path.relative_to(root))
                if relative in derivative_paths:
                    continue
                contained_path(root, relative)
                with path.open('rb') as stream:
                    header = stream.read(65536)
                supported = await asyncio.to_thread(resolve_supported_media_type, header, source_name=path.name)
                if supported is None and relative not in by_path:
                    continue
                size, digest = await asyncio.to_thread(file_digest, path)
                discovered.append((relative, path, size, digest, supported))
            if not storage_available():
                raise ValueError('NAS disconnected during scan; changes discarded')
            seen = {x[0] for x in discovered}
            owner_hashes = {(m.uploader_id, m.sha256): m.id for m in records if m.sha256}
            missing_by_hash = {}
            for media in records:
                if media.filepath not in seen and media.sha256:
                    missing_by_hash.setdefault(media.sha256, []).append(media)
            new_by_hash = {}
            for item in discovered:
                if item[0] not in by_path:
                    new_by_hash.setdefault(item[3], []).append(item)
            result = {'scanned_at': datetime.now(timezone.utc).isoformat(), 'added': 0, 'moved': 0,
                      'missing': 0, 'changed': 0, 'duplicates': [], 'errors': []}
            queued = []
            for relative, path, size, digest, supported in discovered:
                media = by_path.get(relative)
                if media:
                    if media.sha256 and media.sha256 != digest:
                        media.file_status = 'changed'
                        result['changed'] += 1
                    else:
                        previous_status = media.file_status
                        if owner_hashes.get((media.uploader_id, digest), media.id) != media.id:
                            result['duplicates'].append(relative)
                        else:
                            media.sha256 = digest
                            owner_hashes[(media.uploader_id, digest)] = media.id
                        media.file_status = 'available'
                        if previous_status != 'available' and media.deleted_at is None and media.tagging_status in (TaggingStatus.PENDING, TaggingStatus.PROCESSING):
                            queued.append(media.id)
                    continue
                matches = missing_by_hash.get(digest, [])
                if len(matches) == 1 and len(new_by_hash[digest]) == 1:
                    media = matches[0]
                    media.filepath = relative
                    media.file_status = 'available'
                    result['moved'] += 1
                    continue
                if matches or (owner.id, digest) in owner_hashes:
                    result['duplicates'].append(relative)
                    continue
                media_id = uuid.uuid4()
                metadata = await asyncio.to_thread(extract_media_metadata, str(path), supported.media_type)
                poster, thumb = await asyncio.to_thread(generate_poster_and_thumbnail, str(path), supported.media_type, media_id)
                media = Media(id=media_id, uploader_id=owner.id, owner_id=owner.id, filename=path.name,
                              original_filename=path.name, filepath=relative, file_size=size, sha256=digest,
                              mime_type=supported.canonical_mime_type, media_type=supported.media_type,
                              width=metadata.width, height=metadata.height, duration_seconds=metadata.duration_seconds,
                              frame_count=metadata.frame_count, captured_at=datetime.fromtimestamp(path.stat().st_mtime, timezone.utc),
                              visibility=MediaVisibility.private, tagging_status=TaggingStatus.PENDING,
                              thumbnail_path=str(thumb.relative_to(root)) if thumb else None,
                              poster_path=str(poster.relative_to(root)) if poster else None,
                              thumbnail_status=ProcessingStatus.DONE if thumb else ProcessingStatus.FAILED,
                              poster_status=ProcessingStatus.DONE if poster else ProcessingStatus.NOT_APPLICABLE,
                              file_status='available')
                db.add(media)
                records.append(media)
                owner_hashes[(owner.id, digest)] = media.id
                queued.append(media_id)
                result['added'] += 1
            for media in records:
                if media.filepath not in seen:
                    media.file_status = 'missing'
                    result['missing'] += 1
            if not storage_available():
                raise ValueError('NAS disconnected during scan; changes discarded')
            config.last_scan = result
            await db.commit()
            for media_id in queued:
                await queue.put(media_id)
            return result


async def accept_changed_file(db, media_id, queue):
    if storage_gate.paused or scan_lock.locked():
        raise ValueError('Wait for the current storage operation to finish')
    async with scan_lock, storage_gate.operation():
        media = await db.get(Media, media_id)
        if media is None or media.file_status != 'changed' or media.deleted_at:
            raise ValueError('Select an active record with changed content')
        path = contained_path(root_path(), media.filepath)
        with path.open('rb') as stream:
            header = stream.read(65536)
        supported = resolve_supported_media_type(header, source_name=path.name)
        if supported is None:
            raise ValueError('Changed file has an unsupported media type')
        size, digest = await asyncio.to_thread(file_digest, path)
        duplicate = await db.scalar(select(Media).where(Media.uploader_id == media.uploader_id,
                                                        Media.sha256 == digest, Media.id != media.id))
        if duplicate:
            raise ValueError('Changed content duplicates another record belonging to this user')
        metadata = await asyncio.to_thread(extract_media_metadata, str(path), supported.media_type)
        poster, thumb = await asyncio.to_thread(generate_poster_and_thumbnail, str(path), supported.media_type, media.id)
        media.sha256, media.file_size = digest, size
        media.mime_type, media.media_type = supported.canonical_mime_type, supported.media_type
        media.width, media.height = metadata.width, metadata.height
        media.duration_seconds, media.frame_count = metadata.duration_seconds, metadata.frame_count
        media.thumbnail_path = str(thumb.relative_to(root_path())) if thumb else None
        media.poster_path = str(poster.relative_to(root_path())) if poster else None
        media.thumbnail_status = ProcessingStatus.DONE if thumb else ProcessingStatus.FAILED
        media.poster_status = ProcessingStatus.DONE if poster else ProcessingStatus.NOT_APPLICABLE
        media.file_status, media.tagging_status = 'available', TaggingStatus.PENDING
        media.ocr_text = None
        embedding = await db.scalar(select(MediaEmbedding).where(MediaEmbedding.media_id == media.id))
        if embedding:
            await db.delete(embedding)
        media.version += 1
        await db.commit()
        await queue.put(media.id)


async def library_worker(queue):
    last_scan = 0.0
    while True:
        try:
            storage_gate.available = await asyncio.to_thread(storage_available)
            async with AsyncSessionLocal() as db:
                config = await db.get(LibraryStorage, 1)
                interval = config.scan_interval_seconds
                owner = config.discovery_owner_id
            now = asyncio.get_running_loop().time()
            if storage_gate.available and owner and interval and now - last_scan >= interval and not storage_gate.paused:
                await scan_library(queue)
                last_scan = now
        except Exception:
            logger.exception('Library scan failed; metadata retained')
            last_scan = asyncio.get_running_loop().time()
        await asyncio.sleep(30)
