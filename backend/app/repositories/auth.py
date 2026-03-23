import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models.auth import RefreshToken, User


class UserRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_by_id(self, user_id: uuid.UUID) -> User | None:
        return (await self.db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()

    async def get_by_username(self, username: str) -> User | None:
        return (await self.db.execute(select(User).where(User.username == username))).scalar_one_or_none()

    async def get_by_email(self, email: str) -> User | None:
        return (await self.db.execute(select(User).where(User.email == email))).scalar_one_or_none()

    async def list(self, *, offset: int, limit: int, order_expr) -> list[User]:
        return (await self.db.execute(select(User).order_by(order_expr).offset(offset).limit(limit))).scalars().all()

    async def count(self) -> int:
        return (await self.db.execute(select(func.count(User.id)))).scalar_one()


class RefreshTokenRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_by_hash(self, token_hash: str) -> RefreshToken | None:
        return (await self.db.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash))).scalar_one_or_none()
