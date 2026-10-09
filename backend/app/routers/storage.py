import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession
from backend.app.database import get_db
from backend.app.models.library_storage import StorageMigration
from backend.app.routers.deps import admin_user
from backend.app.services import library_storage as service
from backend.app.services import storage_maintenance

router = APIRouter(prefix='/admin/storage', tags=['admin'], dependencies=[Depends(admin_user)])
media_queue = None


class StorageSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    generated_dir: str | None = Field(default=None, min_length=1, max_length=512)
    discovery_owner_id: uuid.UUID | None = None
    scan_interval_seconds: int | None = Field(default=None, ge=0)


class Destination(BaseModel):
    model_config = ConfigDict(extra='forbid')
    root: str = Field(min_length=1, max_length=1024)


class MaintenanceCleanup(BaseModel):
    model_config = ConfigDict(extra='forbid')
    media_ids: list[uuid.UUID] = Field(min_length=1, max_length=10000)
    root: str
    root_identity: str | None
    confirm_permanent_deletion: bool


@router.get('/maintenance')
async def inspect_maintenance(db: AsyncSession = Depends(get_db)):
    async with service.control_lock, service.storage_gate.operation(writer=False):
        return await call(storage_maintenance.inspect(db))


@router.post('/maintenance/cleanup')
async def cleanup_maintenance(body: MaintenanceCleanup, db: AsyncSession = Depends(get_db)):
    if not body.confirm_permanent_deletion:
        raise HTTPException(422, 'Permanent deletion must be acknowledged')
    return await call(storage_maintenance.cleanup(db, body.media_ids, body.root, body.root_identity))


async def call(awaitable):
    try:
        return await awaitable
    except (ValueError, OSError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get('')
async def get_storage(db: AsyncSession = Depends(get_db)):
    return await service.get_storage_status(db)


@router.patch('')
async def update_storage(body: StorageSettingsUpdate, db: AsyncSession = Depends(get_db)):
    changes = body.model_dump(exclude_unset=True)
    if 'generated_dir' in changes and changes['generated_dir'] is None:
        raise HTTPException(422, 'Generated directory cannot be null')
    if 'scan_interval_seconds' in changes and changes['scan_interval_seconds'] is None:
        raise HTTPException(422, 'Scan interval cannot be null')
    if changes.get('discovery_owner_id'):
        changes['discovery_owner_id'] = str(changes['discovery_owner_id'])
    return await call(service.update_storage_settings(db, changes))


@router.post('/confirm')
async def confirm(body: Destination, db: AsyncSession = Depends(get_db)):
    return await call(service.confirm_storage_folder(db, body.root))


@router.post('/validate')
async def validate(body: Destination, db: AsyncSession = Depends(get_db)):
    return await call(service.validate_destination(db, body.root))


@router.post('/migrations', status_code=202)
async def migrate(body: Destination, db: AsyncSession = Depends(get_db)):
    return await call(service.start_migration(db, body.root))


@router.get('/migrations/{job_id}')
async def get_migration(job_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    job = await db.get(StorageMigration, str(job_id))
    if not job:
        raise HTTPException(404, 'Migration not found')
    return service.job_status(job)


@router.post('/migrations/{job_id}/resume', status_code=202)
async def resume(job_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    job = await db.get(StorageMigration, str(job_id))
    if not job:
        raise HTTPException(404, 'Migration not found')
    if service.job_tasks or service.scan_lock.locked():
        raise HTTPException(409, 'A storage operation is already running')
    if job.state != 'complete':
        service.spawn_job(job.id)
    return service.job_status(job)


@router.post('/scan')
async def scan():
    return await call(service.scan_library(media_queue))


@router.post('/conflicts/{media_id}/accept')
async def accept(media_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    await call(service.accept_changed_file(db, media_id, media_queue))
    return {'status': 'queued'}
