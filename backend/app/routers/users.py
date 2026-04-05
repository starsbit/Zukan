from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.database import get_db
from backend.app.errors.error import AppError
from backend.app.routers.deps import current_user
from backend.app.models.auth import User
from backend.app.models.integrations import IntegrationService
from backend.app.repositories.integrations import UserIntegrationRepository
from backend.app.schemas import (
    AniListIntegrationRead,
    AniListIntegrationUpsert,
    APIKeyCreateResponse,
    APIKeyStatusResponse,
    AUTHENTICATED_ERROR_RESPONSES,
    UserRead,
    UserUpdate,
    error_responses,
)
from backend.app.services.auth import AuthService

router = APIRouter(prefix="/me", tags=["users"], responses=AUTHENTICATED_ERROR_RESPONSES)


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
    responses=error_responses(409, 422),
)
async def update_me(
    body: UserUpdate,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await AuthService(db).update_current_user(user, body)


@router.get(
    "/api-key",
    response_model=APIKeyStatusResponse,
    summary="Get Current User API Key Status",
    description="Return whether the authenticated user has an API key and its metadata.",
)
async def get_api_key(
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await AuthService(db).get_api_key_status(user.id)


@router.post(
    "/api-key",
    response_model=APIKeyCreateResponse,
    summary="Create Current User API Key",
    description="Create or regenerate the authenticated user's API key and return the raw key once.",
)
async def create_api_key(
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await AuthService(db).create_api_key(user.id)


@router.get(
    "/integrations/anilist",
    response_model=AniListIntegrationRead,
    summary="Get AniList Integration",
    description="Return the authenticated user's AniList integration status.",
    responses=error_responses(404),
)
async def get_anilist_integration(
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    record = await UserIntegrationRepository(db).get_by_user_and_service(user.id, IntegrationService.anilist)
    if record is None:
        raise AppError(status_code=404, code="integration_not_found", detail="AniList integration not configured")
    return record


@router.put(
    "/integrations/anilist",
    response_model=AniListIntegrationRead,
    summary="Set AniList Integration",
    description="Create or update the authenticated user's AniList token.",
)
async def upsert_anilist_integration(
    body: AniListIntegrationUpsert,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await UserIntegrationRepository(db).upsert(user.id, IntegrationService.anilist, body.token)


@router.delete(
    "/integrations/anilist",
    status_code=204,
    summary="Delete AniList Integration",
    description="Remove the authenticated user's AniList token.",
    responses=error_responses(404),
)
async def delete_anilist_integration(
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    deleted = await UserIntegrationRepository(db).delete(user.id, IntegrationService.anilist)
    if not deleted:
        raise AppError(status_code=404, code="integration_not_found", detail="AniList integration not configured")
    return Response(status_code=204)
