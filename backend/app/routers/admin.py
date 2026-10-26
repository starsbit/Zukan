import logging
import uuid
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from backend.app.config import get_runtime_config, update_runtime_config
from backend.app.database import get_db
from backend.app.routers.deps import admin_user
from backend.app.models.notifications import AppAnnouncement
from backend.app.repositories.notifications import AppAnnouncementRepository
from backend.app.schemas import (
    ADMIN_ERROR_RESPONSES,
    AdminAppConfigRead,
    AdminAppConfigUpdate,
    AdminEmbeddingBackfillResponse,
    AdminEmbeddingBackfillStatus,
    AdminHealthResponse,
    AdminLibraryClassificationMetricsResponse,
    AdminServiceNotificationCreate,
    AdminServiceNotificationResult,
    AdminStatsResponse,
    AppAnnouncementCreate,
    AppAnnouncementRead,
    TaggingJobQueuedResponse,
    UpdateCheckResponse,
    error_responses,
)
from backend.app.services.admin import AdminService
from backend.app.services.notifications import NotificationService
from backend.app.services.update_check import check_for_updates_now, trigger_app_update
from backend.app.utils.rate_limit import rate_limit_store

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(admin_user)],
    responses=ADMIN_ERROR_RESPONSES,
)
logger = logging.getLogger(__name__)


@router.get("/app-config", response_model=AdminAppConfigRead)
async def get_app_config() -> AdminAppConfigRead:
    return AdminAppConfigRead(**get_runtime_config())


@router.patch("/app-config", response_model=AdminAppConfigRead)
async def update_app_config(
    body: AdminAppConfigUpdate,
) -> AdminAppConfigRead:
    next_config = update_runtime_config(body.model_dump(exclude_none=True))
    await rate_limit_store.reset()
    return AdminAppConfigRead(**next_config)


@router.get("/stats", response_model=AdminStatsResponse)
async def admin_stats(
    db: AsyncSession = Depends(get_db),
):
    return await AdminService(db).get_admin_stats()


@router.get("/health", response_model=AdminHealthResponse)
async def admin_health(
    db: AsyncSession = Depends(get_db),
):
    return await AdminService(db).get_health()


@router.post(
    "/tagging-jobs",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=TaggingJobQueuedResponse,
    responses=error_responses(404),
)
async def retag_all(db: AsyncSession = Depends(get_db)):
    queued = await AdminService(db).retag_all_media()
    return {"queued": queued}


@router.post(
    "/embedding-backfill",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=AdminEmbeddingBackfillResponse,
    responses=error_responses(404),
)
async def start_embedding_backfill(db: AsyncSession = Depends(get_db)):
    return await AdminService(db).start_embedding_backfill()


@router.get(
    "/embedding-backfills/{batch_id}",
    response_model=AdminEmbeddingBackfillStatus,
    responses=error_responses(404),
)
async def get_embedding_backfill_status(
    batch_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    return await AdminService(db).get_embedding_backfill_status(batch_id)


@router.get(
    "/library-classification-metrics",
    response_model=AdminLibraryClassificationMetricsResponse,
    responses=error_responses(404),
)
async def get_library_classification_metrics(
    model_version: str | None = Query(default=None, max_length=64),
    db: AsyncSession = Depends(get_db),
):
    return await AdminService(db).get_library_classification_metrics(
        model_version=model_version
    )


@router.get("/announcements", response_model=list[AppAnnouncementRead])
async def list_announcements(
    db: AsyncSession = Depends(get_db),
):
    repo = AppAnnouncementRepository(db)
    return await repo.list_all(offset=0, limit=200)


@router.post("/announcements", response_model=AppAnnouncementRead, status_code=status.HTTP_201_CREATED)
async def create_announcement(
    body: AppAnnouncementCreate,
    db: AsyncSession = Depends(get_db),
):
    announcement = AppAnnouncement(
        version=body.version,
        title=body.title,
        message=body.message,
        severity=body.severity,
        starts_at=body.starts_at,
        ends_at=body.ends_at,
    )
    db.add(announcement)
    await db.commit()
    await db.refresh(announcement)
    await NotificationService(db).publish_announcement(announcement)
    return announcement


@router.post(
    "/service-notifications",
    response_model=AdminServiceNotificationResult,
    status_code=status.HTTP_201_CREATED,
    summary="Publish Admin Service Notification",
    description="Publish an operational notification to all admin users. Intended for trusted automation tools.",
)
async def create_service_notification(
    body: AdminServiceNotificationCreate,
    db: AsyncSession = Depends(get_db),
):
    notified = await NotificationService(db).publish_admin_notification(
        title=body.title,
        body=body.body,
        link_url=body.link_url,
        data=body.data,
    )
    return {"notified": notified}


@router.post(
    "/check-updates",
    response_model=UpdateCheckResponse,
    summary="Check for Updates",
    description="Query GitHub for the latest release and compare against the running version. Creates an announcement if a new version is found.",
)
async def check_updates():
    return await check_for_updates_now()


@router.post(
    "/update",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Trigger Application Update",
    description="Initiate a self-update via Watchtower. The server will pull the latest images and restart shortly.",
)
async def trigger_update():
    try:
        await trigger_app_update()
    except httpx.HTTPError as exc:
        logger.exception("Failed to trigger updater service")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Could not reach the updater service. "
                "Check that the updater container is running, reachable from the API container, "
                "and able to access Docker."
            ),
        ) from exc
    except Exception as exc:
        logger.exception("Failed to trigger updater service")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to trigger the application update.",
        ) from exc

    return {"message": "Update initiated"}
