import uuid

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Image, User
from app.schemas import AdminStatsResponse, AdminUserDetail, AdminUserUpdate, UserListResponse, UserRead
from app.services.images import get_tag_queue, purge_image_record


async def get_admin_stats(db: AsyncSession) -> AdminStatsResponse:
    total_users = (await db.execute(select(func.count(User.id)))).scalar_one()
    total_images = (await db.execute(select(func.count(Image.id)).where(Image.deleted_at.is_(None)))).scalar_one()
    storage_bytes = (
        await db.execute(select(func.coalesce(func.sum(Image.file_size), 0)).where(Image.deleted_at.is_(None)))
    ).scalar_one()
    pending = (
        await db.execute(select(func.count(Image.id)).where(Image.tagging_status == "pending", Image.deleted_at.is_(None)))
    ).scalar_one()
    failed = (
        await db.execute(select(func.count(Image.id)).where(Image.tagging_status == "failed", Image.deleted_at.is_(None)))
    ).scalar_one()
    trashed = (await db.execute(select(func.count(Image.id)).where(Image.deleted_at.is_not(None)))).scalar_one()

    return AdminStatsResponse(
        total_users=total_users,
        total_images=total_images,
        total_storage_bytes=storage_bytes,
        pending_tagging=pending,
        failed_tagging=failed,
        trashed_images=trashed,
    )


async def list_users(db: AsyncSession, page: int, page_size: int) -> UserListResponse:
    total = (await db.execute(select(func.count(User.id)))).scalar_one()
    users = (
        await db.execute(select(User).order_by(User.created_at.desc()).offset((page - 1) * page_size).limit(page_size))
    ).scalars().all()
    return UserListResponse(total=total, page=page, page_size=page_size, items=users)


async def get_user_detail(db: AsyncSession, user_id: uuid.UUID) -> AdminUserDetail:
    target = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")

    image_count = (await db.execute(select(func.count(Image.id)).where(Image.uploader_id == user_id))).scalar_one()
    storage_bytes = (
        await db.execute(select(func.coalesce(func.sum(Image.file_size), 0)).where(Image.uploader_id == user_id))
    ).scalar_one()

    return AdminUserDetail.model_validate(
        {
            **UserRead.model_validate(target).model_dump(),
            "image_count": image_count,
            "storage_used_bytes": storage_bytes,
        }
    )


async def update_user(db: AsyncSession, user_id: uuid.UUID, body: AdminUserUpdate):
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


async def delete_user(db: AsyncSession, user_id: uuid.UUID, delete_images: bool) -> None:
    target = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")

    if delete_images:
        images = (await db.execute(select(Image).where(Image.uploader_id == user_id))).scalars().all()
        for image in images:
            await purge_image_record(image, db)

    await db.delete(target)
    await db.commit()


async def retag_all_images(db: AsyncSession, user_id: uuid.UUID) -> int:
    images = (
        await db.execute(select(Image).where(Image.uploader_id == user_id, Image.deleted_at.is_(None)))
    ).scalars().all()

    for image in images:
        image.tagging_status = "pending"
    await db.commit()

    queue = get_tag_queue()
    if queue:
        for image in images:
            await queue.put(image.id)

    return len(images)
