from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.database import get_db
from backend.app.deps import current_user
from backend.app.models.auth import User
from backend.app.schemas import ERROR_RESPONSES, UserRead, UserUpdate
from backend.app.services import auth as auth_service

router = APIRouter(prefix="/users", tags=["users"], responses=ERROR_RESPONSES)


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
