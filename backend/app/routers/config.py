from fastapi import APIRouter

from backend.app.config import settings
from backend.app.schemas import UploadConfigResponse

router = APIRouter(prefix="/config", tags=["config"])


@router.get("/upload", response_model=UploadConfigResponse, summary="Get Upload Configuration")
async def get_upload_config() -> UploadConfigResponse:
    return UploadConfigResponse(
        max_batch_size=settings.max_batch_size,
        max_upload_size_mb=settings.max_upload_size_mb,
    )
