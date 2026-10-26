from __future__ import annotations
import logging
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from backend.app.config import settings
from backend.app.errors.error import AppError
from backend.app.errors.auth import invalid_credentials, invalid_refresh_token
from backend.app.errors.upload import version_conflict
from backend.app.models.auth import APIKey, RefreshToken, User, AuthSession
from backend.app.services.owner_auth import auth_fingerprint
from sqlalchemy import select
from backend.app.repositories.auth import (
    APIKeyRepository,
    RefreshTokenRepository,
    UserRepository,
)
from backend.app.schemas import (
    APIKeyCreateResponse,
    APIKeyStatusResponse,
    TokenResponse,
    UserUpdate,
)
from backend.app.utils.passwords import hash_password, hash_token, verify_password
from backend.app.utils.tokens import create_access_token

logger = logging.getLogger(__name__)


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

    async def login_user(self, username, password, remember_me=False):
        if settings.auth_mode != "local":
            raise AppError(
                status_code=403,
                code="password_disabled",
                detail="Local login is disabled",
            )
        user = await UserRepository(self._db).get_by_username(username)
        if user is None or not verify_password(password, user.hashed_password):
            raise AppError(
                status_code=401, code=invalid_credentials, detail="Invalid credentials"
            )
        return await self.issue_session(user, remember_me)

    async def issue_session(self, user, remember_me=False):
        expiry = datetime.now(UTC) + timedelta(
            days=_refresh_token_expiry_days(remember_me)
        )
        session = AuthSession(
            id=uuid.uuid4(),
            auth_config=auth_fingerprint(),
            revoked=False,
            expires_at=expiry,
        )
        self._db.add(session)
        await self._db.flush()
        raw = secrets.token_hex(32)
        self._db.add(
            RefreshToken(
                user_id=user.id,
                session_id=session.id,
                token_hash=hash_token(raw),
                remember_me=remember_me,
                expires_at=expiry,
            )
        )
        await self._db.commit()
        return TokenResponse(
            access_token=create_access_token(user.id, session.id), refresh_token=raw
        )

    async def refresh_access_token(self, raw_refresh_token):
        record = await self._db.scalar(
            select(RefreshToken)
            .where(RefreshToken.token_hash == hash_token(raw_refresh_token))
            .with_for_update()
        )
        if (
            record is None
            or record.revoked
            or record.expires_at.replace(tzinfo=UTC) <= datetime.now(UTC)
        ):
            raise AppError(
                status_code=401,
                code=invalid_refresh_token,
                detail="Invalid or expired refresh token",
            )
        session = await self._db.get(AuthSession, record.session_id)
        if (
            session is None
            or session.revoked
            or session.auth_config != auth_fingerprint()
            or (session.expires_at.replace(tzinfo=UTC) <= datetime.now(UTC))
        ):
            raise AppError(
                status_code=401, code=invalid_refresh_token, detail="Session expired"
            )
        record.revoked = True
        raw = secrets.token_hex(32)
        self._db.add(
            RefreshToken(
                user_id=record.user_id,
                session_id=session.id,
                token_hash=hash_token(raw),
                remember_me=record.remember_me,
                expires_at=session.expires_at,
            )
        )
        await self._db.commit()
        return TokenResponse(
            access_token=create_access_token(record.user_id, session.id),
            refresh_token=raw,
        )

    async def revoke_refresh_token(self, raw_token):
        record = await RefreshTokenRepository(self._db).get_by_hash(
            hash_token(raw_token)
        )
        if record is None:
            return False
        session = await self._db.get(AuthSession, record.session_id)
        if session is not None:
            session.revoked = True
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
        raw = f"zk_{secrets.token_hex(32)}"
        if existing is None:
            record = APIKey(user_id=user_id, key_hash=hash_token(raw))
            self._db.add(record)
        else:
            record = existing
            record.key_hash = hash_token(raw)
            record.created_at = datetime.now(UTC)
            record.last_used_at = None
        await self._db.commit()
        await self._db.refresh(record)
        logger.info("Created or rotated API key user_id=%s", user_id)
        return APIKeyCreateResponse(
            api_key=raw,
            has_key=True,
            created_at=record.created_at,
            last_used_at=record.last_used_at,
        )

    async def revoke_api_key(self, user_id: uuid.UUID) -> bool:
        record = await APIKeyRepository(self._db).get_by_user_id(user_id)
        if record is None:
            logger.info("API key revoke skipped because no key exists user_id=%s", user_id)
            return False
        await self._db.delete(record)
        await self._db.commit()
        logger.info("Revoked API key user_id=%s", user_id)
        return True

    async def get_user_by_api_key(self, raw_key: str) -> User | None:
        record = await APIKeyRepository(self._db).get_by_hash(hash_token(raw_key))
        if record is None:
            logger.warning("API key authentication failed because key was not found")
            return None
        user = await UserRepository(self._db).get_by_id(record.user_id)
        if user is None:
            logger.warning("API key authentication failed because user was not found user_id=%s", record.user_id)
            return None
        record.last_used_at = datetime.now(UTC)
        await self._db.commit()
        logger.info("API key authentication succeeded user_id=%s", user.id)
        return user

    async def update_current_user(self, user: User, body: UserUpdate) -> User:
        if (
            "version" in body.model_fields_set
            and body.version is not None
            and (body.version != user.version)
        ):
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
        if body.show_sensitive is not None:
            user.show_sensitive = body.show_sensitive
        if body.tag_confidence_threshold is not None:
            user.tag_confidence_threshold = body.tag_confidence_threshold
        if body.library_classification_enabled is not None:
            user.library_classification_enabled = body.library_classification_enabled
        if body.password is not None and settings.auth_mode != "local":
            raise AppError(
                status_code=403,
                code="password_disabled",
                detail="Password changes are disabled in OIDC mode",
            )
        if body.password is not None and settings.auth_mode != "local":
            raise AppError(
                status_code=403,
                code="password_disabled",
                detail="Password changes are disabled in OIDC mode",
            )
        if body.password is not None:
            user.hashed_password = hash_password(body.password)
        await self._db.commit()
        await self._db.refresh(user)
        logger.info(
            "Updated current user settings user_id=%s show_nsfw_changed=%s show_sensitive_changed=%s threshold_changed=%s library_classification_changed=%s password_changed=%s",
            user.id,
            body.show_nsfw is not None,
            body.show_sensitive is not None,
            body.tag_confidence_threshold is not None,
            body.library_classification_enabled is not None,
            body.password is not None,
        )
        return user
