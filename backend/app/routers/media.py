import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.database import get_db
from backend.app.deps import current_user
from backend.app.models import User
from backend.app.schemas import (
    BatchUploadResponse,
    BulkResult,
    CharacterSuggestion,
    DownloadRequest,
    MediaBatchDelete,
    MediaBatchUpdate,
    MediaDetail,
    MediaListResponse,
    MediaListState,
    MediaMetadataFilter,
    MediaUpdate,
    NsfwFilter,
    TagFilterMode,
    TaggingJobQueuedResponse,
)
from backend.app.services import media as media_service
from backend.app.services.storage import zip_media

router = APIRouter(prefix="/media", tags=["media"])


def media_metadata_filter_query(
    captured_year: int | None = Query(default=None, description="Filter media by the captured year metadata."),
    captured_month: int | None = Query(default=None, ge=1, le=12, description="Filter media by captured month metadata."),
    captured_day: int | None = Query(default=None, ge=1, le=31, description="Filter media by captured day metadata."),
    captured_after: datetime | None = Query(default=None, description="Filter media captured on or after the given timestamp."),
    captured_before: datetime | None = Query(default=None, description="Filter media captured on or before the given timestamp."),
    captured_before_year: int | None = Query(default=None, description="Filter media captured before the given year."),
) -> MediaMetadataFilter:
    try:
        return MediaMetadataFilter(
            captured_year=captured_year,
            captured_month=captured_month,
            captured_day=captured_day,
            captured_after=captured_after,
            captured_before=captured_before,
            captured_before_year=captured_before_year,
        )
    except ValidationError as exc:
        raise RequestValidationError(exc.errors()) from exc


@router.post("", response_model=BatchUploadResponse, status_code=status.HTTP_202_ACCEPTED, summary="Upload Media")
async def upload(files: list[UploadFile], user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    return await media_service.build_upload_response(db, user, files)


@router.get("", response_model=MediaListResponse, summary="List Media")
async def list_media(
    metadata: Annotated[MediaMetadataFilter, Depends(media_metadata_filter_query)],
    state: MediaListState = Query(default=MediaListState.ACTIVE, description="Whether to list active or trashed media."),
    album_id: uuid.UUID | None = Query(default=None, description="Optional album filter for visible media in a specific album."),
    tags: Annotated[str | None, Query(description="Comma-separated tags to include in the search.")] = None,
    character_name: Annotated[str | None, Query(description="Case-insensitive partial match against derived character name.")] = None,
    exclude_tags: Annotated[str | None, Query(description="Comma-separated tags that must not be present.")] = None,
    mode: TagFilterMode = Query(default=TagFilterMode.AND, description="How to combine multiple included tags."),
    nsfw: NsfwFilter = Query(default=NsfwFilter.DEFAULT, description="Controls how NSFW media is included."),
    status_filter: Annotated[str | None, Query(alias="status", description="Optional tagging status filter such as pending, processing, done, failed, or any.")] = None,
    favorited: bool | None = Query(default=None, description="If true, return only media favorited by the current user."),
    media_type: str | None = Query(default=None, description="Optional comma-separated media type filter."),
    page: int = Query(default=1, ge=1, description="1-based page number."),
    page_size: int = Query(default=20, ge=1, le=200, description="Maximum number of items to return."),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await media_service.list_media(
        db,
        user,
        state,
        tags,
        character_name,
        exclude_tags,
        mode,
        nsfw,
        status_filter,
        metadata,
        favorited,
        media_type,
        album_id,
        page,
        page_size,
    )


@router.get("/character-suggestions", response_model=list[CharacterSuggestion], summary="List Character Suggestions")
async def list_character_suggestions(
    q: str = Query(min_length=1, description="Prefix query for persisted character names."),
    limit: int = Query(default=20, ge=1, le=100),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await media_service.list_character_suggestions(db, user, q=q, limit=limit)


@router.patch("", response_model=BulkResult, summary="Batch Update Media")
async def batch_update_media(body: MediaBatchUpdate, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    return await media_service.batch_update_media(db, body, user)


@router.delete("", response_model=BulkResult, summary="Batch Delete Media")
async def batch_delete_media(body: MediaBatchDelete, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    return await media_service.batch_delete_media(db, body, user)


@router.delete("/trash", status_code=status.HTTP_204_NO_CONTENT, summary="Empty Trash")
async def empty_trash(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await media_service.empty_trash(db, user)


@router.post("/download", summary="Download Media", response_description="ZIP archive of the requested media.")
async def download_media(body: DownloadRequest, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    rows = await media_service.get_downloadable_media(db, user, body.media_ids)
    buf = zip_media(rows)
    return StreamingResponse(
        content=iter([buf.read()]),
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=media.zip"},
    )


@router.get("/{media_id}", response_model=MediaDetail, summary="Get Media Detail")
async def get_media(media_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    return await media_service.get_media_detail(db, media_id, user)


@router.patch("/{media_id}", response_model=MediaDetail, summary="Update Media")
async def update_media(media_id: uuid.UUID, body: MediaUpdate, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    return await media_service.update_media_metadata(db, media_id, user, body)


@router.get("/{media_id}/file", summary="Download Original Media")
async def get_media_file(media_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    media = await media_service.get_visible_media(db, media_id, user)
    return FileResponse(media.filepath, media_type=media.mime_type)


@router.get("/{media_id}/thumbnail", summary="Download Media Thumbnail")
async def get_media_thumbnail(media_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    media = await media_service.get_visible_media(db, media_id, user)
    if not media.thumbnail_path:
        raise HTTPException(status_code=404, detail="Thumbnail not available")
    return FileResponse(media.thumbnail_path, media_type="image/webp")


@router.delete("/{media_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete Media")
async def delete_media(media_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await media_service.delete_media(db, media_id, user)


@router.post("/{media_id}/tagging-jobs", status_code=status.HTTP_202_ACCEPTED, response_model=TaggingJobQueuedResponse, summary="Queue Media Retagging")
async def queue_media_tagging_job(media_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    queued = await media_service.retag_media(db, media_id, user)
    return {"queued": queued}
