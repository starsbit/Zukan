import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.database import get_db
from backend.app.routers.deps import admin_user
from backend.app.models.notifications import AppAnnouncement
from backend.app.repositories.notifications import AppAnnouncementRepository
from backend.app.schemas import (
    ADMIN_ERROR_RESPONSES,
    AdminStatsResponse,
    AdminUserDetail,
    AdminUserUpdate,
    AppAnnouncementCreate,
    AppAnnouncementRead,
    TaggingJobQueuedResponse,
    UserListResponse,
    UserRead,
    error_responses,
)
from backend.app.services.admin import AdminService

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(admin_user)], responses=ADMIN_ERROR_RESPONSES)


@router.get("/stats", response_model=AdminStatsResponse)
async def admin_stats(
    db: AsyncSession = Depends(get_db),
):
    return await AdminService(db).get_admin_stats()


@router.get("/users", response_model=UserListResponse)
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
    db: AsyncSession = Depends(get_db),
):
    return await AdminService(db).update_user(user_id, body)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT, responses=error_responses(404))
async def delete_user(
    user_id: uuid.UUID,
    delete_media: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
):
    await AdminService(db).delete_user(user_id, delete_media)


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
    return announcement
