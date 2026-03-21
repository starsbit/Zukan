from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import current_user
from app.models import User
from app.schemas import UserRead, UserUpdate
from app.services import auth as auth_service

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserRead)
async def me(user: User = Depends(current_user)):
    return user


@router.patch("/me", response_model=UserRead)
async def update_me(
    body: UserUpdate,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await auth_service.update_current_user(db, user, body)
