import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.database import get_db
from backend.app.routers.deps import current_user
from backend.app.models.auth import User
from backend.app.schemas import AUTHENTICATED_ERROR_RESPONSES, NotificationListResponse, NotificationRead, error_responses
from backend.app.services.notifications import NotificationService

router = APIRouter(prefix="/me/notifications", tags=["notifications"], responses=AUTHENTICATED_ERROR_RESPONSES)


@router.get(
    "",
    response_model=NotificationListResponse,
    summary="List Current User Notifications",
    description="List inbox notifications targeted to the authenticated user.",
)
async def list_notifications(
    after: str | None = Query(default=None, description="Opaque cursor for keyset pagination."),
    page_size: int = Query(default=20, ge=1, le=100),
    is_read: bool | None = Query(default=None),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await NotificationService(db).list_notifications(user.id, after=after, page_size=page_size, is_read=is_read)


@router.patch(
    "/{notification_id}/read",
    response_model=NotificationRead,
    summary="Mark Notification As Read",
    description="Mark a notification in the authenticated user's inbox as read.",
    responses=error_responses(404),
)
async def mark_read(
    notification_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await NotificationService(db).mark_read(notification_id, user.id)


@router.post(
    "/read-all",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Mark All Notifications As Read",
    description="Mark all notifications in the authenticated user's inbox as read.",
)
async def mark_all_read(
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    await NotificationService(db).mark_all_read(user.id)


@router.delete(
    "/{notification_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete Notification",
    description="Delete a notification from the authenticated user's inbox.",
    responses=error_responses(404),
)
async def delete_notification(
    notification_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    await NotificationService(db).delete_notification(notification_id, user.id)


@router.post(
    "/{notification_id}/accept",
    response_model=NotificationRead,
    summary="Accept Share Invite",
    description="Accept a share invite notification and join the related album.",
    responses=error_responses(404, 409, 422),
)
async def accept_notification_invite(
    notification_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await NotificationService(db).accept_invite(notification_id, user.id)


@router.post(
    "/{notification_id}/reject",
    response_model=NotificationRead,
    summary="Reject Share Invite",
    description="Reject a share invite notification without joining the related album.",
    responses=error_responses(404, 409, 422),
)
async def reject_notification_invite(
    notification_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await NotificationService(db).reject_invite(notification_id, user.id)
