from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.database import get_db
from backend.app.routers.deps import current_user
from backend.app.models.auth import User
from backend.app.schemas import ERROR_RESPONSES, UserRead, UserUpdate
from backend.app.services.auth import AuthService

router = APIRouter(prefix="/me", tags=["users"], responses=ERROR_RESPONSES)


@router.get(
    "",
    response_model=UserRead,
    summary="Get Current User",
    description="Return the authenticated user's profile and preferences.",
)
async def me(user: User = Depends(current_user)):
    return user


@router.patch(
    "",
    response_model=UserRead,
    summary="Update Current User",
    description="Update profile preferences and optional password for the authenticated user.",
)
async def update_me(
    body: UserUpdate,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await AuthService(db).update_current_user(user, body)
