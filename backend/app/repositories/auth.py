from __future__ import annotations

import uuid

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models.auth import APIKey, RefreshToken, User
from backend.app.models.media import Media


class UserRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_by_id(self, user_id: uuid.UUID) -> User | None:
        return (await self.db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()

    async def get_by_username(self, username: str) -> User | None:
        return (
            await self.db.execute(select(User).where(func.lower(User.username) == username.lower()))
        ).scalar_one_or_none()

    async def get_by_email(self, email: str) -> User | None:
        return (await self.db.execute(select(User).where(User.email == email))).scalar_one_or_none()

    async def list(self, *, offset: int, limit: int, order_expr) -> list[User]:
        return (await self.db.execute(select(User).order_by(order_expr).offset(offset).limit(limit))).scalars().all()

    async def list_with_media_stats(self, *, offset: int, limit: int, order_expr) -> list[dict]:
        stmt = (
            select(
                User,
                func.count(Media.id).label("media_count"),
                func.coalesce(func.sum(Media.file_size), 0).label("storage_used_bytes"),
            )
            .outerjoin(
                Media,
                and_(Media.uploader_id == User.id, Media.deleted_at.is_(None)),
            )
            .group_by(User.id)
            .order_by(order_expr)
            .offset(offset)
            .limit(limit)
        )
        rows = (await self.db.execute(stmt)).all()
        return [
            {
                "user": row[0],
                "media_count": int(row.media_count or 0),
                "storage_used_bytes": int(row.storage_used_bytes or 0),
            }
            for row in rows
        ]

    async def list_storage_summaries(self) -> list[dict]:
        stmt = (
            select(
                User.id.label("user_id"),
                User.username,
                func.count(Media.id).label("media_count"),
                func.coalesce(func.sum(Media.file_size), 0).label("storage_used_bytes"),
            )
            .outerjoin(
                Media,
                and_(Media.uploader_id == User.id, Media.deleted_at.is_(None)),
            )
            .group_by(User.id)
            .order_by(func.coalesce(func.sum(Media.file_size), 0).desc(), User.username.asc())
        )
        rows = (await self.db.execute(stmt)).all()
        return [
            {
                "user_id": str(row.user_id),
                "username": row.username,
                "media_count": int(row.media_count or 0),
                "storage_used_bytes": int(row.storage_used_bytes or 0),
            }
            for row in rows
        ]

    async def count(self) -> int:
        return (await self.db.execute(select(func.count(User.id)))).scalar_one()


class RefreshTokenRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_by_hash(self, token_hash: str) -> RefreshToken | None:
        return (await self.db.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash))).scalar_one_or_none()


class APIKeyRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_by_hash(self, key_hash: str) -> APIKey | None:
        return (await self.db.execute(select(APIKey).where(APIKey.key_hash == key_hash))).scalar_one_or_none()

    async def get_by_user_id(self, user_id: uuid.UUID) -> APIKey | None:
        return (await self.db.execute(select(APIKey).where(APIKey.user_id == user_id))).scalar_one_or_none()
