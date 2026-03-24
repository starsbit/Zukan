import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.database import get_db
from backend.app.routers.deps import current_user
from backend.app.models.auth import User
from backend.app.schemas import ERROR_RESPONSES, NotificationListResponse, NotificationRead
from backend.app.services.notifications import NotificationService

router = APIRouter(prefix="/me/notifications", tags=["notifications"], responses=ERROR_RESPONSES)


@router.get("", response_model=NotificationListResponse)
async def list_notifications(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    is_read: bool | None = Query(default=None),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await NotificationService(db).list_notifications(user.id, page=page, page_size=page_size, is_read=is_read)


@router.patch("/{notification_id}/read", response_model=NotificationRead)
async def mark_read(
    notification_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await NotificationService(db).mark_read(notification_id, user.id)


@router.post("/read-all", status_code=status.HTTP_204_NO_CONTENT)
async def mark_all_read(
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    await NotificationService(db).mark_all_read(user.id)


@router.delete("/{notification_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_notification(
    notification_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    await NotificationService(db).delete_notification(notification_id, user.id)
