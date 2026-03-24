import uuid
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Form, Query, UploadFile, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.database import get_db
from backend.app.routers.deps import current_user
from backend.app.errors.error import AppError
from backend.app.errors.media import poster_not_available, thumbnail_not_available
from backend.app.models.auth import User
from backend.app.schemas import (
    BatchUploadResponse,
    BulkResult,
    CharacterSuggestion,
    DownloadRequest,
    ERROR_RESPONSES,
    MediaBatchDelete,
    MediaBatchUpdate,
    MediaCursorPage,
    MediaDetail,
    MediaListResponse,
    MediaListState,
    MediaMetadataFilter,
    MediaUpdate,
    NsfwFilter,
    TagFilterMode,
    TaggingJobQueuedResponse,
)
from backend.app.services.media import MediaService
from backend.app.utils.storage import zip_media

router = APIRouter(prefix="/media", tags=["media"], responses=ERROR_RESPONSES)


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
async def upload(
    files: list[UploadFile],
    album_id: uuid.UUID | None = Form(default=None),
    tags: list[str] | None = Form(default=None),
    captured_at: datetime | None = Form(default=None),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await MediaService(db).build_upload_response(
        user,
        files,
        album_id=album_id,
        tags=tags,
        captured_at_override=captured_at,
    )


@router.get("", response_model=MediaCursorPage, summary="List Media")
async def list_media(
    metadata: Annotated[MediaMetadataFilter, Depends(media_metadata_filter_query)],
    state: MediaListState = Query(default=MediaListState.ACTIVE, description="Whether to list active or trashed media."),
    album_id: uuid.UUID | None = Query(default=None, description="Optional album filter for visible media in a specific album."),
    tag: Annotated[list[str] | None, Query(description="Tags that must be present. Repeat for multiple: ?tag=cat&tag=night")] = None,
    character_name: Annotated[str | None, Query(description="Case-insensitive partial match against derived character name.")] = None,
    exclude_tag: Annotated[list[str] | None, Query(description="Tags that must not be present. Repeat for multiple.")] = None,
    mode: TagFilterMode = Query(default=TagFilterMode.AND, description="How to combine multiple included tags."),
    nsfw: NsfwFilter = Query(default=NsfwFilter.DEFAULT, description="Controls how NSFW media is included."),
    status_filter: Annotated[str | None, Query(alias="status", description="Optional tagging status filter such as pending, processing, done, failed, or any.")] = None,
    favorited: bool | None = Query(default=None, description="If true, return only media favorited by the current user."),
    media_type: Annotated[list[str] | None, Query(description="Media type filter. Repeat for multiple: ?media_type=image&media_type=gif")] = None,
    sort_by: Literal["captured_at", "created_at", "filename", "file_size"] = Query(default="captured_at", description="Field to sort by."),
    sort_order: Literal["asc", "desc"] = Query(default="desc", description="Sort direction."),
    after: str | None = Query(default=None, description="Opaque cursor for keyset pagination. Returned as next_cursor in a previous response."),
    page_size: int = Query(default=20, ge=1, le=200, description="Maximum number of items to return."),
    ocr_text: str | None = Query(default=None, description="Case-insensitive substring search in OCR-extracted text."),
    include_total: bool = Query(default=True, description="Whether to compute the total count. Set to false to skip the COUNT query for faster pagination."),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await MediaService(db).list_media(
        user,
        state,
        tag,
        character_name,
        exclude_tag,
        mode,
        nsfw,
        status_filter,
        metadata,
        favorited,
        media_type,
        album_id,
        after,
        page_size,
        sort_by,
        sort_order,
        ocr_text,
        include_total,
    )


@router.get("/character-suggestions", response_model=list[CharacterSuggestion], summary="List Character Suggestions")
async def list_character_suggestions(
    q: str = Query(min_length=1, description="Prefix query for persisted character names."),
    limit: int = Query(default=20, ge=1, le=100),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await MediaService(db).list_character_suggestions(user, q=q, limit=limit)


@router.get("/trash", response_model=MediaCursorPage, summary="List Trash")
async def list_trash(
    after: str | None = Query(default=None, description="Opaque cursor for keyset pagination."),
    page_size: int = Query(default=20, ge=1, le=200),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await MediaService(db).list_trash(user, after, page_size)


@router.get("/favorites", response_model=MediaListResponse, summary="List Favorited Media")
async def list_favorites(
    tag: Annotated[list[str] | None, Query(description="Tags that must be present. Repeat for multiple.")] = None,
    exclude_tag: Annotated[list[str] | None, Query(description="Tags that must not be present. Repeat for multiple.")] = None,
    mode: TagFilterMode = Query(default=TagFilterMode.AND),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await MediaService(db).list_favorites(user, tag, exclude_tag, mode, page, page_size)


@router.patch("", response_model=BulkResult, summary="Batch Update Media")
async def batch_update_media(body: MediaBatchUpdate, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    return await MediaService(db).batch_update_media(body, user)


@router.delete("", response_model=BulkResult, summary="Batch Delete Media")
async def batch_delete_media(body: MediaBatchDelete, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    return await MediaService(db).batch_delete_media(body, user)


@router.post("/actions/purge", response_model=BulkResult, summary="Batch Purge Media")
async def batch_purge_media(body: MediaBatchDelete, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    return await MediaService(db).batch_purge_media(body, user)


@router.post("/actions/empty-trash", status_code=status.HTTP_204_NO_CONTENT, summary="Empty Trash")
async def empty_trash(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await MediaService(db).empty_trash(user)


@router.post(
    "/download",
    summary="Download Media",
    response_description="ZIP archive of the requested media.",
    responses={200: {"content": {"application/zip": {}}, "description": "ZIP archive of the requested media."}},
)
async def download_media(body: DownloadRequest, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    rows = await MediaService(db).get_downloadable_media(user, body.media_ids)
    buf = zip_media(rows)
    return StreamingResponse(
        content=iter([buf.read()]),
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=media.zip"},
    )


@router.get("/{media_id}", response_model=MediaDetail, summary="Get Media Detail")
async def get_media(media_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    return await MediaService(db).get_media_detail(media_id, user)


@router.patch("/{media_id}", response_model=MediaDetail, summary="Update Media")
async def update_media(media_id: uuid.UUID, body: MediaUpdate, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    return await MediaService(db).update_media_metadata(media_id, user, body)


@router.get(
    "/{media_id}/file",
    summary="Download Original Media",
    responses={200: {"content": {"application/octet-stream": {}}, "description": "Original media file."}},
)
async def get_media_file(media_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    media = await MediaService(db).get_visible_media(media_id, user)
    return FileResponse(media.filepath, media_type=media.mime_type)


@router.get(
    "/{media_id}/thumbnail",
    summary="Download Media Thumbnail",
    responses={200: {"content": {"image/webp": {}}, "description": "WebP thumbnail image."}},
)
async def get_media_thumbnail(media_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    media = await MediaService(db).get_visible_media(media_id, user)
    if not media.thumbnail_path:
        raise AppError(status_code=404, code=thumbnail_not_available, detail="Thumbnail not available")
    return FileResponse(media.thumbnail_path, media_type="image/webp")


@router.get(
    "/{media_id}/poster",
    summary="Download Media Poster",
    responses={200: {"content": {"image/png": {}}, "description": "Poster image."}},
)
async def get_media_poster(media_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    media = await MediaService(db).get_visible_media(media_id, user)
    if not media.poster_path:
        raise AppError(status_code=404, code=poster_not_available, detail="Poster not available")
    return FileResponse(media.poster_path, media_type="image/png")


@router.delete("/{media_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete Media")
async def delete_media(media_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await MediaService(db).soft_delete_media(media_id, user)


@router.post("/{media_id}/restore", status_code=status.HTTP_204_NO_CONTENT, summary="Restore Media")
async def restore_media(media_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await MediaService(db).restore_media(media_id, user)


@router.delete("/{media_id}/purge", status_code=status.HTTP_204_NO_CONTENT, summary="Purge Media")
async def purge_media(media_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await MediaService(db).purge_media(media_id, user)


@router.post("/{media_id}/tagging-jobs", status_code=status.HTTP_202_ACCEPTED, response_model=TaggingJobQueuedResponse, summary="Queue Media Retagging")
async def queue_media_tagging_job(media_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    queued = await MediaService(db).retag_media(media_id, user)
    return {"queued": queued}
