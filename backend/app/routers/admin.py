import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.config import get_runtime_config, update_runtime_config
from backend.app.database import get_db
from backend.app.routers.deps import admin_user
from backend.app.models.auth import User
from backend.app.models.notifications import AppAnnouncement
from backend.app.repositories.notifications import AppAnnouncementRepository
from backend.app.schemas import (
    ADMIN_ERROR_RESPONSES,
    AdminAppConfigRead,
    AdminAppConfigUpdate,
    AdminHealthResponse,
    AdminServiceNotificationCreate,
    AdminServiceNotificationResult,
    AdminStatsResponse,
    AdminUserDetail,
    AdminUserListResponse,
    AdminUserUpdate,
    AppAnnouncementCreate,
    AppAnnouncementRead,
    TaggingJobQueuedResponse,
    UserRead,
    error_responses,
)
from backend.app.services.admin import AdminService
from backend.app.services.notifications import NotificationService
from backend.app.utils.rate_limit import rate_limit_store

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(admin_user)], responses=ADMIN_ERROR_RESPONSES)


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


@router.get("/users", response_model=AdminUserListResponse)
async def list_users(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    sort_by: Literal["username", "created_at"] = Query(default="created_at", description="Field to sort by."),
    sort_order: Literal["asc", "desc"] = Query(default="desc", description="Sort direction."),
    db: AsyncSession = Depends(get_db),
):
    return await AdminService(db).list_users(page, page_size, sort_by, sort_order)


@router.get("/users/{user_id}", response_model=AdminUserDetail, responses=error_responses(404))
async def get_user_detail(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    return await AdminService(db).get_user_detail(user_id)


@router.patch("/users/{user_id}", response_model=UserRead, responses=error_responses(404))
async def update_user(
    user_id: uuid.UUID,
    body: AdminUserUpdate,
    actor: User = Depends(admin_user),
    db: AsyncSession = Depends(get_db),
):
    return await AdminService(db).update_user(actor, user_id, body)


@router.delete("/users/{user_id}/media", response_model=dict[str, int], responses=error_responses(403, 404))
async def delete_user_media(
    user_id: uuid.UUID,
    actor: User = Depends(admin_user),
    db: AsyncSession = Depends(get_db),
):
    deleted = await AdminService(db).delete_user_media(actor, user_id)
    return {"deleted": deleted}


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT, responses=error_responses(403, 404))
async def delete_user(
    user_id: uuid.UUID,
    delete_media: bool = Query(default=False),
    actor: User = Depends(admin_user),
    db: AsyncSession = Depends(get_db),
):
    await AdminService(db).delete_user(actor, user_id, delete_media)


@router.post("/users/{user_id}/tagging-jobs", status_code=status.HTTP_202_ACCEPTED, response_model=TaggingJobQueuedResponse, responses=error_responses(404))
async def retag_all(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    queued = await AdminService(db).retag_all_media(user_id)
    return {"queued": queued}


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
    description="Publish an operational notification to all admin users. Intended for trusted automation tools like Shiori.",
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
