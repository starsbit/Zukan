import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.database import get_db
from backend.app.deps import current_user
from backend.app.models.auth import User
from backend.app.repositories.notifications import NotificationRepository
from backend.app.schemas import ERROR_RESPONSES, NotificationListResponse, NotificationRead

router = APIRouter(prefix="/me/notifications", tags=["notifications"], responses=ERROR_RESPONSES)


@router.get("", response_model=NotificationListResponse)
async def list_notifications(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    is_read: bool | None = Query(default=None),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    repo = NotificationRepository(db)
    offset = (page - 1) * page_size
    total = await repo.count_for_user(user.id, is_read=is_read)
    items = await repo.list_for_user(user.id, is_read=is_read, offset=offset, limit=page_size)
    return NotificationListResponse(total=total, page=page, page_size=page_size, items=list(items))


@router.patch("/{notification_id}/read", response_model=NotificationRead)
async def mark_read(
    notification_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    repo = NotificationRepository(db)
    notification = await repo.get_by_id_for_user(notification_id, user.id)
    if notification is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    notification.is_read = True
    await db.commit()
    await db.refresh(notification)
    return notification


@router.post("/read-all", status_code=status.HTTP_204_NO_CONTENT)
async def mark_all_read(
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    for n in await NotificationRepository(db).get_unread_for_user(user.id):
        n.is_read = True
    await db.commit()


@router.delete("/{notification_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_notification(
    notification_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    repo = NotificationRepository(db)
    notification = await repo.get_by_id_for_user(notification_id, user.id)
    if notification is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    await db.delete(notification)
    await db.commit()
