import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.database import get_db
from backend.app.deps import admin_user
from backend.app.models.notifications import AppAnnouncement
from backend.app.repositories.notifications import AppAnnouncementRepository
from backend.app.schemas import (
    AdminStatsResponse,
    AdminUserDetail,
    AdminUserUpdate,
    AppAnnouncementCreate,
    AppAnnouncementRead,
    ERROR_RESPONSES,
    TaggingJobQueuedResponse,
    UserListResponse,
    UserRead,
)
from backend.app.services import admin as admin_service

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(admin_user)], responses=ERROR_RESPONSES)


@router.get("/stats", response_model=AdminStatsResponse)
async def admin_stats(
    db: AsyncSession = Depends(get_db),
):
    return await admin_service.get_admin_stats(db)


@router.get("/users", response_model=UserListResponse)
async def list_users(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    sort_by: Literal["username", "created_at"] = Query(default="created_at", description="Field to sort by."),
    sort_order: Literal["asc", "desc"] = Query(default="desc", description="Sort direction."),
    db: AsyncSession = Depends(get_db),
):
    return await admin_service.list_users(db, page, page_size, sort_by, sort_order)


@router.get("/users/{user_id}", response_model=AdminUserDetail)
async def get_user_detail(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    return await admin_service.get_user_detail(db, user_id)


@router.patch("/users/{user_id}", response_model=UserRead)
async def update_user(
    user_id: uuid.UUID,
    body: AdminUserUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await admin_service.update_user(db, user_id, body)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: uuid.UUID,
    delete_media: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
):
    await admin_service.delete_user(db, user_id, delete_media)


@router.post("/users/{user_id}/tagging-jobs", status_code=status.HTTP_202_ACCEPTED, response_model=TaggingJobQueuedResponse)
async def retag_all(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    queued = await admin_service.retag_all_media(db, user_id)
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
