import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta

import bcrypt
from fastapi import HTTPException
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.models import RefreshToken, User
from backend.schemas import AccessTokenResponse, TokenResponse, UserLogin, UserRegister, UserUpdate

ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(user_id: uuid.UUID) -> str:
    expire = datetime.now(UTC) + timedelta(minutes=settings.access_token_expire_minutes)
    return jwt.encode({"sub": str(user_id), "exp": expire}, settings.secret_key, algorithm=ALGORITHM)


def decode_access_token(token: str) -> uuid.UUID | None:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
        return uuid.UUID(payload["sub"])
    except (JWTError, KeyError, ValueError):
        return None


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _refresh_token_expiry_days(remember_me: bool) -> int:
    if remember_me:
        return settings.remember_me_refresh_token_expire_days
    return settings.refresh_token_expire_days


async def create_refresh_token(db: AsyncSession, user_id: uuid.UUID, *, remember_me: bool = False) -> str:
    raw = secrets.token_hex(32)
    record = RefreshToken(
        user_id=user_id,
        token_hash=_hash_token(raw),
        remember_me=remember_me,
        expires_at=datetime.now(UTC) + timedelta(days=_refresh_token_expiry_days(remember_me)),
    )
    db.add(record)
    await db.commit()
    return raw


async def rotate_refresh_token(db: AsyncSession, raw_token: str) -> tuple[str, uuid.UUID] | None:
    token_hash = _hash_token(raw_token)
    result = await db.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    record = result.scalar_one_or_none()

    if record is None or record.revoked or record.expires_at.replace(tzinfo=UTC) < datetime.now(UTC):
        return None

    record.revoked = True
    new_raw = secrets.token_hex(32)
    new_record = RefreshToken(
        user_id=record.user_id,
        token_hash=_hash_token(new_raw),
        remember_me=record.remember_me,
        expires_at=datetime.now(UTC) + timedelta(days=_refresh_token_expiry_days(record.remember_me)),
    )
    db.add(new_record)
    await db.commit()
    return new_raw, record.user_id


async def revoke_refresh_token(db: AsyncSession, raw_token: str) -> bool:
    token_hash = _hash_token(raw_token)
    result = await db.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    record = result.scalar_one_or_none()
    if record is None:
        return False
    record.revoked = True
    await db.commit()
    return True


async def get_user_by_id(db: AsyncSession, user_id: uuid.UUID) -> User | None:
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def get_user_by_username(db: AsyncSession, username: str) -> User | None:
    result = await db.execute(select(User).where(User.username == username))
    return result.scalar_one_or_none()


async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()


async def authenticate_basic_user(db: AsyncSession, username: str, password: str) -> User | None:
    user = await get_user_by_username(db, username)
    valid_user = user is not None and secrets.compare_digest(user.username, username)
    valid_password = user is not None and verify_password(password, user.hashed_password)
    if not valid_user or not valid_password:
        return None
    return user


async def register_user(db: AsyncSession, body: UserRegister) -> User:
    if await get_user_by_username(db, body.username):
        raise HTTPException(status_code=400, detail="Username already taken")
    if await get_user_by_email(db, body.email):
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        username=body.username,
        email=body.email,
        hashed_password=hash_password(body.password),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def login_user(db: AsyncSession, body: UserLogin) -> TokenResponse:
    user = await get_user_by_username(db, body.username)
    if user is None or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    access = create_access_token(user.id)
    refresh = await create_refresh_token(db, user.id, remember_me=body.remember_me)
    return TokenResponse(access_token=access, refresh_token=refresh)


async def refresh_access_token(db: AsyncSession, raw_refresh_token: str) -> AccessTokenResponse:
    result = await rotate_refresh_token(db, raw_refresh_token)
    if result is None:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    new_raw, user_id = result
    access = create_access_token(user_id)
    return AccessTokenResponse(access_token=access, refresh_token=new_raw)


async def update_current_user(db: AsyncSession, user: User, body: UserUpdate) -> User:
    if body.show_nsfw is not None:
        user.show_nsfw = body.show_nsfw
    if body.password is not None:
        user.hashed_password = hash_password(body.password)

    await db.commit()
    await db.refresh(user)
    return user
