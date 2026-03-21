import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import admin_user
from app.models import Image, User
from app.routers.images import _purge_image, get_tag_queue
from app.schemas import (
    AdminStatsResponse,
    AdminUserDetail,
    AdminUserUpdate,
    UserListResponse,
    UserRead,
)

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/stats", response_model=AdminStatsResponse)
async def admin_stats(
    admin: User = Depends(admin_user),
    db: AsyncSession = Depends(get_db),
):
    total_users = (await db.execute(select(func.count(User.id)))).scalar_one()
    total_images = (await db.execute(select(func.count(Image.id)).where(Image.deleted_at.is_(None)))).scalar_one()
    storage_bytes = (await db.execute(
        select(func.coalesce(func.sum(Image.file_size), 0)).where(Image.deleted_at.is_(None))
    )).scalar_one()
    pending = (await db.execute(
        select(func.count(Image.id)).where(Image.tagging_status == "pending", Image.deleted_at.is_(None))
    )).scalar_one()
    failed = (await db.execute(
        select(func.count(Image.id)).where(Image.tagging_status == "failed", Image.deleted_at.is_(None))
    )).scalar_one()
    trashed = (await db.execute(select(func.count(Image.id)).where(Image.deleted_at.is_not(None)))).scalar_one()

    return AdminStatsResponse(
        total_users=total_users,
        total_images=total_images,
        total_storage_bytes=storage_bytes,
        pending_tagging=pending,
        failed_tagging=failed,
        trashed_images=trashed,
    )


@router.get("/users", response_model=UserListResponse)
async def list_users(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    admin: User = Depends(admin_user),
    db: AsyncSession = Depends(get_db),
):
    total = (await db.execute(select(func.count(User.id)))).scalar_one()
    users = (await db.execute(
        select(User).order_by(User.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()
    return UserListResponse(total=total, page=page, page_size=page_size, items=users)


@router.get("/users/{user_id}", response_model=AdminUserDetail)
async def get_user_detail(
    user_id: uuid.UUID,
    admin: User = Depends(admin_user),
    db: AsyncSession = Depends(get_db),
):
    target = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")

    image_count = (await db.execute(
        select(func.count(Image.id)).where(Image.uploader_id == user_id)
    )).scalar_one()
    storage_bytes = (await db.execute(
        select(func.coalesce(func.sum(Image.file_size), 0)).where(Image.uploader_id == user_id)
    )).scalar_one()

    return AdminUserDetail.model_validate({
        **UserRead.model_validate(target).model_dump(),
        "image_count": image_count,
        "storage_used_bytes": storage_bytes,
    })


@router.patch("/users/{user_id}", response_model=UserRead)
async def update_user(
    user_id: uuid.UUID,
    body: AdminUserUpdate,
    admin: User = Depends(admin_user),
    db: AsyncSession = Depends(get_db),
):
    target = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")

    if "is_admin" in body.model_fields_set:
        target.is_admin = body.is_admin
    if "show_nsfw" in body.model_fields_set:
        target.show_nsfw = body.show_nsfw

    await db.commit()
    await db.refresh(target)
    return target


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: uuid.UUID,
    delete_images: bool = Query(default=False),
    admin: User = Depends(admin_user),
    db: AsyncSession = Depends(get_db),
):
    target = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")

    if delete_images:
        images = (await db.execute(select(Image).where(Image.uploader_id == user_id))).scalars().all()
        for image in images:
            await _purge_image(image, db)

    await db.delete(target)
    await db.commit()


@router.post("/users/{user_id}/retag-all", status_code=status.HTTP_202_ACCEPTED)
async def retag_all(
    user_id: uuid.UUID,
    admin: User = Depends(admin_user),
    db: AsyncSession = Depends(get_db),
):
    images = (await db.execute(
        select(Image).where(Image.uploader_id == user_id, Image.deleted_at.is_(None))
    )).scalars().all()

    for image in images:
        image.tagging_status = "pending"
    await db.commit()

    queue = get_tag_queue()
    if queue:
        for image in images:
            await queue.put(image.id)

    return {"queued": len(images)}
