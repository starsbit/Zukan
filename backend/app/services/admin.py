from __future__ import annotations

import logging
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.errors.auth import duplicate_username, forbidden, user_not_found
from backend.app.errors.error import AppError
from backend.app.models.auth import User
from backend.app.repositories.auth import UserRepository
from backend.app.repositories.media import MediaRepository
from backend.app.runtime import health_monitor
from backend.app.schemas import (
    AdminHealthResponse,
    AdminHealthSample,
    AdminStatsResponse,
    AdminUserDetail,
    AdminUserListResponse,
    AdminUserSummary,
    AdminUserUpdate,
    UserRead,
)
from backend.app.services.media import get_tag_queue
from backend.app.services.media.lifecycle import MediaLifecycleService
from backend.app.services.media.query import MediaQueryService
from backend.app.utils.passwords import hash_password

logger = logging.getLogger("backend.app.admin")


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
            storage_by_user=await UserRepository(self._db).list_storage_summaries(),
        )

    async def list_users(
        self,
        page: int,
        page_size: int,
        sort_by: str = "created_at",
        sort_order: str = "desc",
    ) -> AdminUserListResponse:
        sort_col = User.username if sort_by == "username" else User.created_at
        order_expr = sort_col.asc() if sort_order == "asc" else sort_col.desc()
        logger.info(
            "Listing admin users page=%s page_size=%s sort_by=%s sort_order=%s",
            page,
            page_size,
            sort_by,
            sort_order,
        )
        users_repo = UserRepository(self._db)
        total = await users_repo.count()
        rows = await users_repo.list_with_media_stats(
            offset=(page - 1) * page_size,
            limit=page_size,
            order_expr=order_expr,
        )
        users = [
            AdminUserSummary.model_validate(
                {
                    **UserRead.model_validate(row["user"]).model_dump(),
                    "media_count": row["media_count"],
                    "storage_used_bytes": row["storage_used_bytes"],
                }
            )
            for row in rows
        ]
        logger.info("Admin users query returned %s rows out of %s total users", len(users), total)
        return AdminUserListResponse(total=total, page=page, page_size=page_size, items=users)

    async def get_user_detail(self, user_id: uuid.UUID) -> AdminUserDetail:
        target = await UserRepository(self._db).get_by_id(user_id)
        if target is None:
            raise AppError(status_code=404, code=user_not_found, detail="User not found")
        media = MediaRepository(self._db)
        media_count = await media.count_by_uploader(user_id)
        storage_bytes = await media.sum_file_size(uploader_id=user_id)
        return AdminUserDetail.model_validate({**UserRead.model_validate(target).model_dump(), "media_count": media_count, "storage_used_bytes": storage_bytes})

    async def update_user(self, actor: User, user_id: uuid.UUID, body: AdminUserUpdate):
        users = UserRepository(self._db)
        target = await users.get_by_id(user_id)
        if target is None:
            raise AppError(status_code=404, code=user_not_found, detail="User not found")
        if body.username is not None:
            existing = await users.get_by_username(body.username)
            if existing is not None and existing.id != target.id:
                raise AppError(status_code=409, code=duplicate_username, detail="Username already taken")
            target.username = body.username
        if "is_admin" in body.model_fields_set:
            target.is_admin = body.is_admin
        if "show_nsfw" in body.model_fields_set:
            target.show_nsfw = body.show_nsfw
        if "tag_confidence_threshold" in body.model_fields_set:
            target.tag_confidence_threshold = body.tag_confidence_threshold
        if body.password is not None:
            target.hashed_password = hash_password(body.password)
        await self._db.commit()
        await self._db.refresh(target)
        return target

    async def delete_user(self, actor: User, user_id: uuid.UUID, delete_media: bool = False) -> None:
        target = await UserRepository(self._db).get_by_id(user_id)
        if target is None:
            raise AppError(status_code=404, code=user_not_found, detail="User not found")
        self._assert_not_self(actor, target)
        if delete_media:
            await self.delete_user_media(actor, user_id)
        await self._db.delete(target)
        await self._db.commit()

    async def retag_all_media(self, user_id: uuid.UUID) -> int:
        target = await UserRepository(self._db).get_by_id(user_id)
        if target is None:
            raise AppError(status_code=404, code=user_not_found, detail="User not found")
        media_items = await MediaRepository(self._db).get_active_by_uploader(user_id)
        for media in media_items:
            media.tagging_status = "pending"
        await self._db.commit()
        queue = get_tag_queue()
        if queue:
            for media in media_items:
                await queue.put(media.id)
        return len(media_items)

    async def delete_user_media(self, actor: User, user_id: uuid.UUID) -> int:
        target = await UserRepository(self._db).get_by_id(user_id)
        if target is None:
            raise AppError(status_code=404, code=user_not_found, detail="User not found")
        self._assert_not_self(actor, target)

        query = MediaQueryService(self._db)
        lifecycle = MediaLifecycleService(self._db, query)
        media_items = await MediaRepository(self._db).get_by_uploader(user_id)
        for media in media_items:
            await lifecycle.purge_media_record(media)
        await self._db.commit()
        return len(media_items)

    async def get_health(self) -> AdminHealthResponse:
        latest = health_monitor.capture_sample()
        total_memory, used_memory = health_monitor.system_memory()
        queue = get_tag_queue()
        return AdminHealthResponse(
            generated_at=latest.captured_at,
            uptime_seconds=round(health_monitor.uptime_seconds(), 2),
            cpu_percent=latest.cpu_percent,
            memory_rss_bytes=latest.memory_rss_bytes,
            system_memory_total_bytes=total_memory,
            system_memory_used_bytes=used_memory,
            tagging_queue_depth=queue.qsize() if queue is not None else 0,
            samples=[
                AdminHealthSample(
                    captured_at=sample.captured_at,
                    cpu_percent=sample.cpu_percent,
                    memory_rss_bytes=sample.memory_rss_bytes,
                )
                for sample in health_monitor.samples()
            ],
        )

    def _assert_not_self(self, actor: User, target: User) -> None:
        if actor.id == target.id:
            raise AppError(status_code=403, code=forbidden, detail="You cannot perform this action on your own account")
