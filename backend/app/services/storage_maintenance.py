"""Explicit, schema-aware maintenance of unavailable catalog assets."""
import asyncio
import logging

from sqlalchemy import select
from backend.app.models.media import Media, ProcessingStatus
from backend.app.models.library_storage import StorageMigration
from backend.app.services import library_storage as storage
from backend.app.services.media.lifecycle import MediaLifecycleService
from backend.app.services.media.query import MediaQueryService
from backend.app.utils.library_paths import contained_path, root_path

logger = logging.getLogger(__name__)


def missing_fields(media):
    missing = []
    for field in storage.PATH_FIELDS:
        value = getattr(media, field)
        if not value:
            continue
        path = contained_path(root_path(), value)
        try:
            path.stat()  # Only ENOENT is missing; permission/I/O failures abort maintenance.
        except FileNotFoundError:
            missing.append(field)
        else:
            if not path.is_file():
                raise ValueError(f'Asset is not a regular file: {value}')
    return missing


async def inspect(db):
    if not storage.storage_available():
        raise ValueError('Library is unavailable; maintenance cannot infer missing files')
    items = []
    records = (await db.scalars(select(Media).execution_options(populate_existing=True))).all()
    for media in records:
        fields = await asyncio.to_thread(missing_fields, media)
        if fields:
            items.append({'id': str(media.id), 'path': media.filepath,
                          'missing_fields': fields, 'trashed': media.deleted_at is not None})
    if not storage.storage_available():
        raise ValueError('Library disconnected during inspection; results discarded')
    return {'root': str(root_path()), 'root_identity': storage.settings.library_root_identity,
            'checked_records': len(records), 'items': items}


async def cleanup(db, media_ids, root, identity):
    async with storage.control_lock:
        unfinished = await db.scalar(select(StorageMigration).where(StorageMigration.state != 'complete').limit(1))
        if storage.job_tasks or storage.scan_lock.locked() or storage.storage_gate.paused or unfinished:
            raise ValueError('Finish storage scanning or migration before maintenance')
        if root != str(root_path()) or identity != storage.settings.library_root_identity:
            raise ValueError('Library changed; inspect it again before cleanup')
        async with storage.scan_lock, storage.storage_gate.migration():
            if not storage.storage_available():
                raise ValueError('Library is unavailable; cleanup refused')
            records = (await db.scalars(select(Media).with_for_update().execution_options(populate_existing=True))).all()
            selected = set(media_ids)
            lifecycle = MediaLifecycleService(db, MediaQueryService(db))
            deleted, repaired = [], []
            skipped = [str(mid) for mid in selected - {m.id for m in records}]
            generated_candidates = set()
            # Complete filesystem checks before making database changes.
            findings = [(m, await asyncio.to_thread(missing_fields, m)) for m in records if m.id in selected]
            if not storage.storage_available():
                raise ValueError('Library disconnected; cleanup refused')
            for media, fields in findings:
                if 'filepath' in fields:
                    generated_candidates.update(v for v in (media.thumbnail_path, media.poster_path) if v)
                    await lifecycle.purge_media_record(media, delete_files=False)
                    deleted.append(str(media.id))
                elif fields:
                    for field in fields:
                        setattr(media, field, None)
                        status = 'thumbnail_status' if field == 'thumbnail_path' else 'poster_status'
                        setattr(media, status, ProcessingStatus.FAILED)
                    repaired.append(str(media.id))
                else:
                    skipped.append(str(media.id))
            if not storage.storage_available():
                await db.rollback()
                raise ValueError('Library disconnected; cleanup rolled back')
            await db.commit()
            # Retain any generated file referenced by another record. Never remove originals.
            references = {getattr(m, f) for m in records if str(m.id) not in deleted for f in storage.PATH_FIELDS}
            errors = []
            for value in generated_candidates - references:
                try:
                    if not storage.storage_available():
                        raise OSError('Library disconnected')
                    contained_path(root_path(), value).unlink(missing_ok=True)
                except (OSError, ValueError) as exc:
                    errors.append({'path': value, 'error': str(exc)})
            logger.warning('Storage maintenance deleted=%s repaired=%s skipped=%s', deleted, repaired, skipped)
            return {'deleted_ids': deleted, 'repaired_ids': repaired, 'skipped_ids': skipped,
                    'file_cleanup_errors': errors}
