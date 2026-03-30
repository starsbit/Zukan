from fastapi import APIRouter, Depends
from sqlalchemy import exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.config import settings
from backend.app.database import get_db
from backend.app.models.auth import User
from backend.app.schemas import SetupRequiredResponse, UploadConfigResponse

router = APIRouter(prefix="/config", tags=["config"])


@router.get("/upload", response_model=UploadConfigResponse, summary="Get Upload Configuration")
async def get_upload_config() -> UploadConfigResponse:
    return UploadConfigResponse(
        max_batch_size=settings.max_batch_size,
        max_upload_size_mb=settings.max_upload_size_mb,
    )


@router.get("/setup-required", response_model=SetupRequiredResponse, summary="Check if initial setup is required")
async def get_setup_required(db: AsyncSession = Depends(get_db)) -> SetupRequiredResponse:
    default_admin_result = await db.execute(select(exists().where(func.lower(User.username) == "admin")))
    has_admin_result = await db.execute(select(exists().where(User.is_admin.is_(True))))
    default_admin_exists = bool(default_admin_result.scalar())
    has_admin = bool(has_admin_result.scalar())
    return SetupRequiredResponse(setup_required=default_admin_exists or not has_admin)
