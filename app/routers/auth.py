from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import current_user
from app.models import User
from app.schemas import (
    AccessTokenResponse,
    LogoutRequest,
    RefreshRequest,
    TokenResponse,
    UserLogin,
    UserRead,
    UserRegister,
    UserUpdate,
)
from app.services.auth import (
    create_access_token,
    create_refresh_token,
    get_user_by_email,
    get_user_by_id,
    get_user_by_username,
    hash_password,
    revoke_refresh_token,
    rotate_refresh_token,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def register(body: UserRegister, db: AsyncSession = Depends(get_db)):
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


@router.post("/login", response_model=TokenResponse)
async def login(body: UserLogin, db: AsyncSession = Depends(get_db)):
    user = await get_user_by_username(db, body.username)
    if user is None or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    access = create_access_token(user.id)
    refresh = await create_refresh_token(db, user.id)
    return TokenResponse(access_token=access, refresh_token=refresh)


@router.post("/refresh", response_model=AccessTokenResponse)
async def refresh(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    result = await rotate_refresh_token(db, body.refresh_token)
    if result is None:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")
    new_raw, user_id = result
    access = create_access_token(user_id)
    return AccessTokenResponse(access_token=access)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(body: LogoutRequest, db: AsyncSession = Depends(get_db)):
    await revoke_refresh_token(db, body.refresh_token)


@router.get("/me", response_model=UserRead)
async def me(user: User = Depends(current_user)):
    return user


@router.patch("/me", response_model=UserRead)
async def update_me(
    body: UserUpdate,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    if body.show_nsfw is not None:
        user.show_nsfw = body.show_nsfw
    if body.password is not None:
        user.hashed_password = hash_password(body.password)
    await db.commit()
    await db.refresh(user)
    return user
