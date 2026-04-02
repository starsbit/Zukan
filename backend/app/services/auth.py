from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.config import settings
from backend.app.errors.error import AppError
from backend.app.errors.auth import duplicate_email, duplicate_username, invalid_credentials, invalid_refresh_token
from backend.app.errors.upload import version_conflict
from backend.app.models.auth import APIKey, RefreshToken, User
from backend.app.repositories.auth import APIKeyRepository, RefreshTokenRepository, UserRepository
from backend.app.schemas import APIKeyCreateResponse, APIKeyStatusResponse, TokenResponse, UserRegister, UserUpdate
from backend.app.utils.passwords import hash_password, hash_token, verify_password
from backend.app.utils.tokens import create_access_token


def _refresh_token_expiry_days(remember_me: bool) -> int:
    if remember_me:
        return settings.remember_me_refresh_token_expire_days
    return settings.refresh_token_expire_days


class AuthService:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def get_user_by_id(self, user_id: uuid.UUID) -> User | None:
        return await UserRepository(self._db).get_by_id(user_id)

    async def get_user_by_username(self, username: str) -> User | None:
        return await UserRepository(self._db).get_by_username(username)

    async def get_user_by_email(self, email: str) -> User | None:
        return await UserRepository(self._db).get_by_email(email)

    async def register_user(self, body: UserRegister) -> User:
        users = UserRepository(self._db)
        if await users.get_by_username(body.username):
            raise AppError(status_code=409, code=duplicate_username, detail="Username already taken")
        if await users.get_by_email(body.email):
            raise AppError(status_code=409, code=duplicate_email, detail="Email already registered")
        user = User(
            username=body.username,
            email=body.email,
            hashed_password=hash_password(body.password),
            tag_confidence_threshold=settings.tagger_threshold_general,
        )
        self._db.add(user)
        await self._db.commit()
        await self._db.refresh(user)
        return user

    async def login_user(self, username: str, password: str, remember_me: bool = False) -> TokenResponse:
        user = await UserRepository(self._db).get_by_username(username)
        if user is None or not verify_password(password, user.hashed_password):
            raise AppError(status_code=401, code=invalid_credentials, detail="Invalid credentials")
        access = create_access_token(user.id)
        refresh = await self.create_refresh_token(user.id, remember_me=remember_me)
        return TokenResponse(access_token=access, refresh_token=refresh)

    async def refresh_access_token(self, raw_refresh_token: str) -> TokenResponse:
        result = await self.rotate_refresh_token(raw_refresh_token)
        if result is None:
            raise AppError(status_code=401, code=invalid_refresh_token, detail="Invalid or expired refresh token")
        new_raw, user_id = result
        access = create_access_token(user_id)
        return TokenResponse(access_token=access, refresh_token=new_raw)

    async def create_refresh_token(self, user_id: uuid.UUID, *, remember_me: bool = False) -> str:
        raw = secrets.token_hex(32)
        record = RefreshToken(
            user_id=user_id,
            token_hash=hash_token(raw),
            remember_me=remember_me,
            expires_at=datetime.now(UTC) + timedelta(days=_refresh_token_expiry_days(remember_me)),
        )
        self._db.add(record)
        await self._db.commit()
        return raw

    async def rotate_refresh_token(self, raw_token: str) -> tuple[str, uuid.UUID] | None:
        record = await RefreshTokenRepository(self._db).get_by_hash(hash_token(raw_token))
        if record is None or record.revoked or record.expires_at.replace(tzinfo=UTC) < datetime.now(UTC):
            return None
        record.revoked = True
        new_raw = secrets.token_hex(32)
        self._db.add(RefreshToken(
            user_id=record.user_id,
            token_hash=hash_token(new_raw),
            remember_me=record.remember_me,
            expires_at=datetime.now(UTC) + timedelta(days=_refresh_token_expiry_days(record.remember_me)),
        ))
        await self._db.commit()
        return new_raw, record.user_id

    async def revoke_refresh_token(self, raw_token: str) -> bool:
        record = await RefreshTokenRepository(self._db).get_by_hash(hash_token(raw_token))
        if record is None:
            return False
        record.revoked = True
        await self._db.commit()
        return True

    async def get_api_key_status(self, user_id: uuid.UUID) -> APIKeyStatusResponse:
        record = await APIKeyRepository(self._db).get_by_user_id(user_id)
        if record is None:
            return APIKeyStatusResponse(has_key=False, created_at=None, last_used_at=None)
        return APIKeyStatusResponse(has_key=True, created_at=record.created_at, last_used_at=record.last_used_at)

    async def create_api_key(self, user_id: uuid.UUID) -> APIKeyCreateResponse:
        repo = APIKeyRepository(self._db)
        existing = await repo.get_by_user_id(user_id)
        if existing is not None:
            await self._db.delete(existing)

        raw = f"zk_{secrets.token_hex(32)}"
        record = APIKey(user_id=user_id, key_hash=hash_token(raw))
        self._db.add(record)
        await self._db.commit()
        await self._db.refresh(record)
        return APIKeyCreateResponse(
            api_key=raw,
            has_key=True,
            created_at=record.created_at,
            last_used_at=record.last_used_at,
        )

    async def revoke_api_key(self, user_id: uuid.UUID) -> bool:
        record = await APIKeyRepository(self._db).get_by_user_id(user_id)
        if record is None:
            return False
        await self._db.delete(record)
        await self._db.commit()
        return True

    async def get_user_by_api_key(self, raw_key: str) -> User | None:
        record = await APIKeyRepository(self._db).get_by_hash(hash_token(raw_key))
        if record is None:
            return None
        user = await UserRepository(self._db).get_by_id(record.user_id)
        if user is None:
            return None
        record.last_used_at = datetime.now(UTC)
        await self._db.commit()
        return user

    async def authenticate_basic_user(self, username: str, password: str) -> User | None:
        user = await UserRepository(self._db).get_by_username(username)
        valid_password = user is not None and verify_password(password, user.hashed_password)
        if not valid_password:
            return None
        return user

    async def update_current_user(self, user: User, body: UserUpdate) -> User:
        if "version" in body.model_fields_set and body.version is not None and body.version != user.version:
            raise AppError(
                status_code=409,
                code=version_conflict,
                detail="Version conflict: resource was modified by another request",
                details={
                    "current_version": user.version,
                    "provided_version": body.version,
                },
            )
        if body.show_nsfw is not None:
            user.show_nsfw = body.show_nsfw
        if body.tag_confidence_threshold is not None:
            user.tag_confidence_threshold = body.tag_confidence_threshold
        if body.password is not None:
            user.hashed_password = hash_password(body.password)
        await self._db.commit()
        await self._db.refresh(user)
        return user
