import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import admin_user
from app.models import User
from app.schemas import (
    AdminStatsResponse,
    AdminUserDetail,
    AdminUserUpdate,
    UserListResponse,
    UserRead,
)
from app.services import admin as admin_service

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/stats", response_model=AdminStatsResponse)
async def admin_stats(
    admin: User = Depends(admin_user),
    db: AsyncSession = Depends(get_db),
):
    return await admin_service.get_admin_stats(db)


@router.get("/users", response_model=UserListResponse)
async def list_users(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    admin: User = Depends(admin_user),
    db: AsyncSession = Depends(get_db),
):
    return await admin_service.list_users(db, page, page_size)


@router.get("/users/{user_id}", response_model=AdminUserDetail)
async def get_user_detail(
    user_id: uuid.UUID,
    admin: User = Depends(admin_user),
    db: AsyncSession = Depends(get_db),
):
    return await admin_service.get_user_detail(db, user_id)


@router.patch("/users/{user_id}", response_model=UserRead)
async def update_user(
    user_id: uuid.UUID,
    body: AdminUserUpdate,
    admin: User = Depends(admin_user),
    db: AsyncSession = Depends(get_db),
):
    return await admin_service.update_user(db, user_id, body)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: uuid.UUID,
    delete_images: bool = Query(default=False),
    admin: User = Depends(admin_user),
    db: AsyncSession = Depends(get_db),
):
    await admin_service.delete_user(db, user_id, delete_images)


@router.post("/users/{user_id}/retag-all", status_code=status.HTTP_202_ACCEPTED)
async def retag_all(
    user_id: uuid.UUID,
    admin: User = Depends(admin_user),
    db: AsyncSession = Depends(get_db),
):
    queued = await admin_service.retag_all_images(db, user_id)
    return {"queued": queued}
