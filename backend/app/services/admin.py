from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.errors.auth import user_not_found
from backend.app.errors.error import AppError
from backend.app.models.auth import User
from backend.app.repositories.auth import UserRepository
from backend.app.repositories.media import MediaRepository
from backend.app.schemas import AdminStatsResponse, AdminUserDetail, AdminUserUpdate, UserListResponse, UserRead
from backend.app.services.media import get_tag_queue
from backend.app.services.media.lifecycle import MediaLifecycleService
from backend.app.services.media.query import MediaQueryService


class AdminService:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def get_admin_stats(self) -> AdminStatsResponse:
        media = MediaRepository(self._db)
        return AdminStatsResponse(
            total_users=await UserRepository(self._db).count(),
            total_media=await media.count_active(),
            total_storage_bytes=await media.sum_file_size(),
            pending_tagging=await media.count_by_tagging_status("pending"),
            failed_tagging=await media.count_by_tagging_status("failed"),
            trashed_media=await media.count_trashed(),
        )

    async def list_users(
        self,
        page: int,
        page_size: int,
        sort_by: str = "created_at",
        sort_order: str = "desc",
    ) -> UserListResponse:
        sort_col = User.username if sort_by == "username" else User.created_at
        order_expr = sort_col.asc() if sort_order == "asc" else sort_col.desc()
        users_repo = UserRepository(self._db)
        total = await users_repo.count()
        users = await users_repo.list(offset=(page - 1) * page_size, limit=page_size, order_expr=order_expr)
        return UserListResponse(total=total, page=page, page_size=page_size, items=users)

    async def get_user_detail(self, user_id: uuid.UUID) -> AdminUserDetail:
        target = await UserRepository(self._db).get_by_id(user_id)
        if target is None:
            raise AppError(status_code=404, code=user_not_found, detail="User not found")
        media = MediaRepository(self._db)
        media_count = await media.count_by_uploader(user_id)
        storage_bytes = await media.sum_file_size(uploader_id=user_id)
        return AdminUserDetail.model_validate({**UserRead.model_validate(target).model_dump(), "media_count": media_count, "storage_used_bytes": storage_bytes})

    async def update_user(self, user_id: uuid.UUID, body: AdminUserUpdate):
        target = await UserRepository(self._db).get_by_id(user_id)
        if target is None:
            raise AppError(status_code=404, code=user_not_found, detail="User not found")
        if "is_admin" in body.model_fields_set:
            target.is_admin = body.is_admin
        if "show_nsfw" in body.model_fields_set:
            target.show_nsfw = body.show_nsfw
        if "tag_confidence_threshold" in body.model_fields_set:
            target.tag_confidence_threshold = body.tag_confidence_threshold
        await self._db.commit()
        await self._db.refresh(target)
        return target

    async def delete_user(self, user_id: uuid.UUID, delete_media: bool = False) -> None:
        target = await UserRepository(self._db).get_by_id(user_id)
        if target is None:
            raise AppError(status_code=404, code=user_not_found, detail="User not found")
        if delete_media:
            query = MediaQueryService(self._db)
            lifecycle = MediaLifecycleService(self._db, query)
            for media in await MediaRepository(self._db).get_by_uploader(user_id):
                await lifecycle.purge_media_record(media)
        await self._db.delete(target)
        await self._db.commit()

    async def retag_all_media(self, user_id: uuid.UUID) -> int:
        media_items = await MediaRepository(self._db).get_active_by_uploader(user_id)
        for media in media_items:
            media.tagging_status = "pending"
        await self._db.commit()
        queue = get_tag_queue()
        if queue:
            for media in media_items:
                await queue.put(media.id)
        return len(media_items)
