from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from backend.app.config import settings
from backend.app.database import get_db
from backend.app.models.auth import User
from backend.app.schemas import SetupRequiredResponse, UploadConfigResponse

router = APIRouter(prefix="/config", tags=["config"])


@router.get("/upload", response_model=UploadConfigResponse, summary="Get upload client config")
async def get_upload_config() -> UploadConfigResponse:
    max_batch_size = min(settings.upload_max_batch_size, settings.upload_multipart_max_files)
    return UploadConfigResponse(max_batch_size=max_batch_size)


@router.get("/setup-required", response_model=SetupRequiredResponse)
async def get_setup_required(db: AsyncSession = Depends(get_db)):
    return SetupRequiredResponse(
        setup_required=settings.auth_mode == "local"
        and await db.scalar(select(User.id)) is None
    )
