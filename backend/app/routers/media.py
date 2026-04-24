import uuid
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, Query, Request, Response, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.database import get_db
from backend.app.config import settings
from backend.app.routers.deps import current_user
from backend.app.errors.error import AppError
from backend.app.errors.media import poster_not_available, thumbnail_not_available
from backend.app.models.auth import User
from backend.app.models.media import MediaVisibility
from backend.app.schemas import (
    AUTHENTICATED_ERROR_RESPONSES,
    BatchUploadResponse,
    BulkResult,
    CharacterSuggestion,
    MediaAnnotatedUploadRequest,
    MediaEntityBatchUpdate,
    MediaIdsRequest,
    MediaBatchUpdate,
    MediaCursorPage,
    MediaDetail,
    MediaListState,
    MediaMetadataFilter,
    MediaTimeline,
    MetadataListScope,
    MediaUploadRequest,
    MediaUpdate,
    UrlIngestRequest,
    NsfwFilter,
    SensitiveFilter,
    SeriesSuggestion,
    TagFilterMode,
    TaggingJobQueuedResponse,
    error_responses,
)
from backend.app.services.media.interactions import MediaInteractionService
from backend.app.services.media.lifecycle import MediaLifecycleService
from backend.app.services.media.metadata import MediaMetadataService
from backend.app.services.media.processing import MediaProcessingService
from backend.app.services.media.query import MediaQueryService
from backend.app.services.media.upload import MediaUploadService
from backend.app.utils.idempotency import idempotency_body_hash, idempotency_scope, idempotency_store
from backend.app.utils.rate_limit import rate_limit
from backend.app.utils.storage import zip_media

router = APIRouter(prefix="/media", tags=["media"], responses=AUTHENTICATED_ERROR_RESPONSES)

IDEMPOTENCY_BEHAVIOR_DOC = (
    "Idempotency behavior when `Idempotency-Key` is provided: same key + same payload replays the original "
    "status code and JSON response body; same key + different payload is rejected with `409 idempotency_key_conflict`; "
    "keys are retained for about 24 hours in process-local memory."
)

IDEMPOTENCY_HEADER_DOC = (
    "Optional idempotency key for safe retries. Within the same user+method+path scope for about 24 hours: "
    "same key + same payload replays original status/body; same key + different payload returns 409."
)


def _media_services(db: AsyncSession) -> tuple[
    MediaQueryService,
    MediaLifecycleService,
    MediaInteractionService,
    MediaProcessingService,
    MediaUploadService,
    MediaMetadataService,
]:
    query = MediaQueryService(db)
    lifecycle = MediaLifecycleService(db, query)
    interactions = MediaInteractionService(db, query)
    processing = MediaProcessingService(db, query)
    upload = MediaUploadService(db, processing, query)
    metadata = MediaMetadataService(db, query, interactions)
    return query, lifecycle, interactions, processing, upload, metadata


def media_metadata_filter_query(
    captured_year: int | None = Query(default=None, description="Filter media by the captured year metadata."),
    captured_month: int | None = Query(default=None, ge=1, le=12, description="Filter media by captured month metadata."),
    captured_day: int | None = Query(default=None, ge=1, le=31, description="Filter media by captured day metadata."),
    captured_after: datetime | None = Query(default=None, description="Filter media captured on or after the given timestamp."),
    captured_before: datetime | None = Query(default=None, description="Filter media captured on or before the given timestamp."),
    captured_before_year: int | None = Query(default=None, description="Filter media captured before the given year."),
    uploaded_year: int | None = Query(default=None, description="Filter media by the upload year."),
    uploaded_month: int | None = Query(default=None, ge=1, le=12, description="Filter media by upload month."),
    uploaded_day: int | None = Query(default=None, ge=1, le=31, description="Filter media by upload day."),
    uploaded_after: datetime | None = Query(default=None, description="Filter media uploaded on or after the given timestamp."),
    uploaded_before: datetime | None = Query(default=None, description="Filter media uploaded on or before the given timestamp."),
    uploaded_before_year: int | None = Query(default=None, description="Filter media uploaded before the given year."),
) -> MediaMetadataFilter:
    try:
        return MediaMetadataFilter(
            captured_year=captured_year,
            captured_month=captured_month,
            captured_day=captured_day,
            captured_after=captured_after,
            captured_before=captured_before,
            captured_before_year=captured_before_year,
            uploaded_year=uploaded_year,
            uploaded_month=uploaded_month,
            uploaded_day=uploaded_day,
            uploaded_after=uploaded_after,
            uploaded_before=uploaded_before,
            uploaded_before_year=uploaded_before_year,
        )
    except ValidationError as exc:
        raise RequestValidationError(exc.errors()) from exc


@router.post(
    "",
    response_model=BatchUploadResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Upload Media",
    description=(
        "Upload one or more media files. Returns an explicit import batch job (`batch_id`) and polling links for async progress tracking.\n\n"
        f"{IDEMPOTENCY_BEHAVIOR_DOC}"
    ),
    responses={
        202: {
            "description": "Upload accepted and processing queued.",
            "content": {
                "application/json": {
                    "example": {
                        "batch_id": "9bf70018-9d3f-4f14-b5a9-d0c77f532f7a",
                        "batch_url": "/api/v1/me/import-batches/9bf70018-9d3f-4f14-b5a9-d0c77f532f7a",
                        "batch_items_url": "/api/v1/me/import-batches/9bf70018-9d3f-4f14-b5a9-d0c77f532f7a/items",
                        "poll_after_seconds": 2,
                        "webhooks_supported": False,
                        "accepted": 1,
                        "duplicates": 0,
                        "errors": 0,
                        "results": [
                            {
                                "id": "0f729258-8c26-4d04-aa95-d33f0bcfb6b8",
                                "batch_item_id": "4a7d8d3a-2f57-4ab0-81be-852eb95b6a23",
                                "original_filename": "sakura.webp",
                                "status": "accepted",
                                "message": None
                            }
                        ],
                    }
                }
            },
        },
        **error_responses(400, 403, 404, 409, 422, 429),
    },
    dependencies=[
        Depends(
            rate_limit(
                max_requests=settings.upload_rate_limit_requests,
                window_seconds=settings.upload_rate_limit_window_seconds,
                scope="media_upload",
            )
        )
    ],
)
async def upload(
    request: Request,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key", description=IDEMPOTENCY_HEADER_DOC),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    body = await MediaUploadRequest.from_request(request, max_files=settings.upload_multipart_max_files)
    scope = idempotency_scope(user_id=user.id, method="POST", path="/media")
    upload_signature = {
        "files": [{"filename": f.filename, "content_type": f.content_type} for f in body.files],
        "album_id": str(body.album_id) if body.album_id else None,
        "tags": body.tags or [],
        "captured_at": body.captured_at.isoformat() if body.captured_at else None,
        "captured_at_values": [captured.isoformat() for captured in (body.captured_at_values or [])],
        "external_refs_values": [
            [ref.model_dump(mode="json") for ref in refs]
            for refs in (body.external_refs_values or [])
        ],
        "visibility": body.visibility.value,
    }
    body_hash = idempotency_body_hash(upload_signature)
    replay = await idempotency_store.get_replay(scope=scope, idempotency_key=idempotency_key, body_hash=body_hash)
    if replay is not None:
        _, payload = replay
        return payload

    _, _, _, _, upload_service, _ = _media_services(db)
    payload = await upload_service.upload_files(
        user,
        body.files,
        album_id=body.album_id,
        tags=body.tags,
        captured_at_override=body.captured_at,
        captured_at_values=body.captured_at_values,
        external_refs_values=body.external_refs_values,
        visibility=body.visibility,
    )
    await idempotency_store.remember(
        scope=scope,
        idempotency_key=idempotency_key,
        body_hash=body_hash,
        status_code=status.HTTP_202_ACCEPTED,
        payload=jsonable_encoder(payload),
    )
    return payload


@router.post(
    "/annotated",
    response_model=BatchUploadResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Upload Media With Predefined Tags And Entities",
    description=(
        "Upload media for third-party clients with predefined manual annotations. "
        "Accepted tags, character names, and series names are stored as authoritative manual metadata, "
        "and automatic AI tagging is skipped for the uploaded files.\n\n"
        f"{IDEMPOTENCY_BEHAVIOR_DOC}"
    ),
    responses={
        202: {
            "description": "Upload accepted with manual annotations applied and AI tagging skipped.",
            "content": {
                "application/json": {
                    "example": {
                        "batch_id": "9bf70018-9d3f-4f14-b5a9-d0c77f532f7a",
                        "batch_url": "/api/v1/me/import-batches/9bf70018-9d3f-4f14-b5a9-d0c77f532f7a",
                        "batch_items_url": "/api/v1/me/import-batches/9bf70018-9d3f-4f14-b5a9-d0c77f532f7a/items",
                        "poll_after_seconds": 2,
                        "webhooks_supported": False,
                        "accepted": 1,
                        "duplicates": 0,
                        "errors": 0,
                        "results": [
                            {
                                "id": "0f729258-8c26-4d04-aa95-d33f0bcfb6b8",
                                "batch_item_id": "4a7d8d3a-2f57-4ab0-81be-852eb95b6a23",
                                "original_filename": "sakura.webp",
                                "status": "accepted",
                                "message": None
                            }
                        ],
                    }
                }
            },
        },
        **error_responses(400, 403, 404, 409, 422, 429),
    },
    dependencies=[
        Depends(
            rate_limit(
                max_requests=settings.upload_rate_limit_requests,
                window_seconds=settings.upload_rate_limit_window_seconds,
                scope="media_upload",
            )
        )
    ],
)
async def upload_with_annotations(
    request: Request,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key", description=IDEMPOTENCY_HEADER_DOC),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    body = await MediaAnnotatedUploadRequest.from_request(request, max_files=settings.upload_multipart_max_files)
    scope = idempotency_scope(user_id=user.id, method="POST", path="/media/annotated")
    upload_signature = {
        "files": [{"filename": f.filename, "content_type": f.content_type} for f in body.files],
        "album_id": str(body.album_id) if body.album_id else None,
        "tags": body.tags or [],
        "character_names": body.character_names or [],
        "series_names": body.series_names or [],
        "captured_at": body.captured_at.isoformat() if body.captured_at else None,
        "captured_at_values": [captured.isoformat() for captured in (body.captured_at_values or [])],
        "external_refs_values": [
            [ref.model_dump(mode="json") for ref in refs]
            for refs in (body.external_refs_values or [])
        ],
        "visibility": body.visibility.value,
    }
    body_hash = idempotency_body_hash(upload_signature)
    replay = await idempotency_store.get_replay(scope=scope, idempotency_key=idempotency_key, body_hash=body_hash)
    if replay is not None:
        _, payload = replay
        return payload

    _, _, _, _, upload_service, _ = _media_services(db)
    payload = await upload_service.upload_files_with_annotations(
        user,
        body.files,
        album_id=body.album_id,
        tags=body.tags,
        character_names=body.character_names,
        series_names=body.series_names,
        captured_at_override=body.captured_at,
        captured_at_values=body.captured_at_values,
        external_refs_values=body.external_refs_values,
        visibility=body.visibility,
    )
    await idempotency_store.remember(
        scope=scope,
        idempotency_key=idempotency_key,
        body_hash=body_hash,
        status_code=status.HTTP_202_ACCEPTED,
        payload=jsonable_encoder(payload),
    )
    return payload


@router.post(
    "/ingest-url",
    response_model=BatchUploadResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Ingest Media from URL",
    description=(
        "Download an image or video from a remote URL server-side and feed it through the "
        "standard upload pipeline (dedup, thumbnail, tagging). "
        "Accepts direct media URLs (JPEG, PNG, WebP, GIF, MP4, WebM, MOV)."
    ),
    responses={**error_responses(400, 422, 429, 502)},
    dependencies=[
        Depends(
            rate_limit(
                max_requests=settings.upload_rate_limit_requests,
                window_seconds=settings.upload_rate_limit_window_seconds,
                scope="media_upload",
            )
        )
    ],
)
async def ingest_url(
    body: UrlIngestRequest,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    _, _, _, _, upload_service, _ = _media_services(db)
    return await upload_service.ingest_url(
        user,
        str(body.url),
        album_id=body.album_id,
        tags=body.tags,
        captured_at_override=body.captured_at,
        external_refs=body.external_refs,
        visibility=body.visibility,
    )


@router.get(
    "",
    response_model=MediaCursorPage,
    summary="List Media",
    description=(
        "List media visible to the caller using cursor pagination.\n\n"
        "This is the lightweight browse endpoint and supports only scope + ordering parameters. "
        "For tag/name/metadata/text-driven filtering, use `GET /media/search`."
    ),
    responses=error_responses(403, 404, 422),
)
async def list_media(
    state: MediaListState = Query(default=MediaListState.ACTIVE, description="Whether to list active or trashed media."),
    album_id: uuid.UUID | None = Query(default=None, description="Optional album filter for visible media in a specific album."),
    visibility: MediaVisibility | None = Query(default=None, description="Optional visibility filter."),
    sort_by: Literal["captured_at", "uploaded_at", "filename", "file_size"] = Query(default="captured_at", description="Field to sort by."),
    sort_order: Literal["asc", "desc"] = Query(default="desc", description="Sort direction."),
    after: str | None = Query(default=None, description="Opaque cursor for keyset pagination. Returned as next_cursor in a previous response."),
    page_size: int = Query(default=20, ge=1, le=1000, description="Maximum number of items to return."),
    include_total: bool = Query(default=True, description="Whether to compute the total count. Set to false to skip the COUNT query for faster pagination."),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    query, _, _, _, _, _ = _media_services(db)
    return await query.list_media(
        user=user,
        state=state,
        tags=None,
        character_names=None,
        series_names=None,
        owner_username=None,
        uploader_username=None,
        exclude_tags=None,
        mode=TagFilterMode.AND,
        character_mode=TagFilterMode.AND,
        series_mode=TagFilterMode.AND,
        nsfw=NsfwFilter.DEFAULT,
        sensitive=SensitiveFilter.DEFAULT,
        status_filter=None,
        metadata=MediaMetadataFilter(),
        favorited=None,
        visibility=visibility,
        media_type=None,
        album_id=album_id,
        after=after,
        page_size=page_size,
        sort_by=sort_by,
        sort_order=sort_order,
        ocr_text=None,
        include_total=include_total,
    )


@router.get(
    "/search",
    response_model=MediaCursorPage,
    summary="Search Media",
    description=(
        "Search-focused media endpoint. Use this for tag/name/metadata/text filtering and discovery workflows. "
        "It uses the full filtering engine, while `GET /media` is a lightweight browse endpoint, "
        "and is intended for discovery-style queries that combine tags, OCR text, character names, "
        "and metadata constraints."
    ),
    responses=error_responses(403, 404, 422),
)
async def search_media(
    metadata: Annotated[MediaMetadataFilter, Depends(media_metadata_filter_query)],
    state: MediaListState = Query(default=MediaListState.ACTIVE, description="Whether to list active or trashed media."),
    album_id: uuid.UUID | None = Query(default=None, description="Optional album filter for visible media in a specific album."),
    tag: Annotated[list[str] | None, Query(description="Tags that must be present. Repeat for multiple: ?tag=cat&tag=night")] = None,
    character_name: Annotated[list[str] | None, Query(description="Case-insensitive partial match against derived character names. Repeat for multiple.")] = None,
    series_name: Annotated[list[str] | None, Query(description="Case-insensitive partial match against derived series names. Repeat for multiple.")] = None,
    owner_username: str | None = Query(default=None, description="Case-insensitive exact match against the current owner username."),
    uploader_username: str | None = Query(default=None, description="Case-insensitive exact match against the uploader username."),
    exclude_tag: Annotated[list[str] | None, Query(description="Tags that must not be present. Repeat for multiple.")] = None,
    mode: TagFilterMode = Query(default=TagFilterMode.AND, description="How to combine multiple included tags."),
    character_mode: TagFilterMode = Query(default=TagFilterMode.AND, description="How to combine multiple included character filters."),
    series_mode: TagFilterMode = Query(default=TagFilterMode.AND, description="How to combine multiple included series filters."),
    nsfw: NsfwFilter = Query(default=NsfwFilter.DEFAULT, description="Controls how NSFW media is included."),
    sensitive: SensitiveFilter = Query(default=SensitiveFilter.DEFAULT, description="Controls how sensitive media is included."),
    status_filter: Annotated[str | None, Query(alias="status", description="Optional tagging status filter such as pending, processing, done, failed, or any.")] = None,
    favorited: bool | None = Query(default=None, description="If true, return only media favorited by the current user."),
    visibility: MediaVisibility | None = Query(default=None, description="Optional visibility filter."),
    media_type: Annotated[list[str] | None, Query(description="Media type filter. Repeat for multiple: ?media_type=image&media_type=gif")] = None,
    sort_by: Literal["captured_at", "uploaded_at", "filename", "file_size"] = Query(default="captured_at", description="Field to sort by."),
    sort_order: Literal["asc", "desc"] = Query(default="desc", description="Sort direction."),
    after: str | None = Query(default=None, description="Opaque cursor for keyset pagination. Returned as next_cursor in a previous response."),
    page_size: int = Query(default=20, ge=1, le=1000, description="Maximum number of items to return."),
    ocr_text: str | None = Query(default=None, description="Case-insensitive OCR text search with fuzzy matching to tolerate noisy characters inside words."),
    include_total: bool = Query(default=True, description="Whether to compute the total count. Set to false to skip the COUNT query for faster pagination."),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    query, _, _, _, _, _ = _media_services(db)
    return await query.list_media(
        user=user,
        state=state,
        tags=tag,
        character_names=character_name,
        series_names=series_name,
        owner_username=owner_username,
        uploader_username=uploader_username,
        exclude_tags=exclude_tag,
        mode=mode,
        character_mode=character_mode,
        series_mode=series_mode,
        nsfw=nsfw,
        sensitive=sensitive,
        status_filter=status_filter,
        metadata=metadata,
        favorited=favorited,
        visibility=visibility,
        media_type=media_type,
        album_id=album_id,
        after=after,
        page_size=page_size,
        sort_by=sort_by,
        sort_order=sort_order,
        ocr_text=ocr_text,
        include_total=include_total,
    )


@router.get(
    "/timeline",
    response_model=MediaTimeline,
    summary="Media Timeline",
    description=(
        "Return year/month bucket counts for the current user's media matching the given filters. "
        "Use this to populate a timeline sidebar without loading media items. "
        "Date-range parameters (captured_year, captured_after, etc.) are intentionally excluded. "
        "The timeline always reflects the full date distribution for the active filter set."
    ),
    responses=error_responses(403, 404, 422),
)
async def get_media_timeline(
    state: MediaListState = Query(default=MediaListState.ACTIVE),
    album_id: uuid.UUID | None = Query(default=None),
    tag: Annotated[list[str] | None, Query(description="Tags that must be present.")] = None,
    character_name: Annotated[list[str] | None, Query(description="Case-insensitive partial match against derived character names. Repeat for multiple.")] = None,
    series_name: Annotated[list[str] | None, Query(description="Case-insensitive partial match against derived series names. Repeat for multiple.")] = None,
    owner_username: str | None = Query(default=None),
    uploader_username: str | None = Query(default=None),
    exclude_tag: Annotated[list[str] | None, Query()] = None,
    mode: TagFilterMode = Query(default=TagFilterMode.AND),
    character_mode: TagFilterMode = Query(default=TagFilterMode.AND),
    series_mode: TagFilterMode = Query(default=TagFilterMode.AND),
    nsfw: NsfwFilter = Query(default=NsfwFilter.DEFAULT),
    sensitive: SensitiveFilter = Query(default=SensitiveFilter.DEFAULT),
    status_filter: Annotated[str | None, Query(alias="status", description="Optional tagging status filter such as pending, processing, done, failed, or any.")] = None,
    favorited: bool | None = Query(default=None),
    visibility: MediaVisibility | None = Query(default=None),
    media_type: Annotated[list[str] | None, Query()] = None,
    ocr_text: str | None = Query(default=None),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> MediaTimeline:
    query, _, _, _, _, _ = _media_services(db)
    return await query.get_timeline(
        user,
        state=state,
        tags=tag,
        character_names=character_name,
        series_names=series_name,
        owner_username=owner_username,
        uploader_username=uploader_username,
        exclude_tags=exclude_tag,
        mode=mode,
        character_mode=character_mode,
        series_mode=series_mode,
        nsfw=nsfw,
        sensitive=sensitive,
        status_filter=status_filter,
        favorited=favorited,
        visibility=visibility,
        media_type=media_type,
        album_id=album_id,
        ocr_text=ocr_text,
    )


@router.get(
    "/character-suggestions",
    response_model=list[CharacterSuggestion],
    summary="List Character Suggestions",
    description="Return character name suggestions for autocomplete based on persisted annotations.",
)
async def list_character_suggestions(
    q: str = Query(min_length=1, description="Prefix query for persisted character names."),
    limit: int = Query(default=20, ge=1, le=100),
    scope: MetadataListScope = Query(default=MetadataListScope.ACCESSIBLE, description="Result visibility scope."),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    query, _, _, _, _, _ = _media_services(db)
    return await query.list_character_suggestions(user, q=q, limit=limit, scope=scope)


@router.get(
    "/series-suggestions",
    response_model=list[SeriesSuggestion],
    summary="List Series Suggestions",
    description="Return series name suggestions for autocomplete based on persisted annotations.",
)
async def list_series_suggestions(
    q: str = Query(min_length=1, description="Prefix query for persisted series names."),
    limit: int = Query(default=20, ge=1, le=100),
    scope: MetadataListScope = Query(default=MetadataListScope.ACCESSIBLE, description="Result visibility scope."),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    query, _, _, _, _, _ = _media_services(db)
    return await query.list_series_suggestions(user, q=q, limit=limit, scope=scope)


@router.patch(
    "",
    response_model=BulkResult,
    summary="Batch Update Media",
    description=(
        "Apply the same metadata/tag mutations to a set of media IDs.\n\n"
        f"{IDEMPOTENCY_BEHAVIOR_DOC}"
    ),
    responses=error_responses(409, 422),
)
async def batch_update_media(
    body: MediaBatchUpdate,
    response: Response,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key", description=IDEMPOTENCY_HEADER_DOC),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    scope = idempotency_scope(user_id=user.id, method="PATCH", path="/media")
    body_hash = idempotency_body_hash(body.model_dump(mode="json"))
    replay = await idempotency_store.get_replay(scope=scope, idempotency_key=idempotency_key, body_hash=body_hash)
    if replay is not None:
        status_code, payload = replay
        if response is not None:
            response.status_code = status_code
        return payload

    _, lifecycle, interactions, _, _, metadata = _media_services(db)
    if body.deleted is True:
        result = await lifecycle.bulk_delete_media(body.media_ids, user)
    elif body.deleted is False:
        result = await lifecycle.bulk_restore_media(body.media_ids, user)
    elif body.favorited is True:
        result = await interactions.bulk_favorite_media(body.media_ids, user)
    elif body.favorited is False:
        result = await interactions.bulk_unfavorite_media(body.media_ids, user)
    elif body.visibility is not None:
        result = await metadata.bulk_update_visibility(body.media_ids, user, body.visibility)
    elif body.metadata_review_dismissed is not None:
        result = await metadata.bulk_update_metadata_review_dismissed(
            body.media_ids,
            user,
            body.metadata_review_dismissed,
        )
    else:
        result = BulkResult(processed=0, skipped=0)
    await idempotency_store.remember(
        scope=scope,
        idempotency_key=idempotency_key,
        body_hash=body_hash,
        status_code=status.HTTP_200_OK,
        payload=jsonable_encoder(result),
    )
    return result


@router.patch(
    "/entities",
    response_model=BulkResult,
    summary="Batch Update Media Character And Series Entities",
    description="Apply manual character and/or series names to the selected media items.",
    responses=error_responses(422),
)
async def batch_update_media_entities(
    body: MediaEntityBatchUpdate,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    _, _, _, _, _, metadata = _media_services(db)
    return await metadata.bulk_update_entities(body, user)


@router.post(
    "/actions/delete",
    response_model=BulkResult,
    summary="Batch Delete Media",
    description=(
        "Move media to trash in bulk.\n\n"
        f"{IDEMPOTENCY_BEHAVIOR_DOC}"
    ),
    responses=error_responses(409, 422),
)
async def batch_delete_media_command(
    body: MediaIdsRequest,
    response: Response,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key", description=IDEMPOTENCY_HEADER_DOC),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    scope = idempotency_scope(user_id=user.id, method="POST", path="/media/actions/delete")
    body_hash = idempotency_body_hash(body.model_dump(mode="json"))
    replay = await idempotency_store.get_replay(scope=scope, idempotency_key=idempotency_key, body_hash=body_hash)
    if replay is not None:
        status_code, payload = replay
        if response is not None:
            response.status_code = status_code
        return payload

    _, lifecycle, _, _, _, _ = _media_services(db)
    result = await lifecycle.batch_delete_media(body, user)
    await idempotency_store.remember(
        scope=scope,
        idempotency_key=idempotency_key,
        body_hash=body_hash,
        status_code=status.HTTP_200_OK,
        payload=jsonable_encoder(result),
    )
    return result


@router.post(
    "/actions/purge",
    response_model=BulkResult,
    summary="Batch Purge Media",
    description=(
        "Permanently delete trashed media in bulk.\n\n"
        f"{IDEMPOTENCY_BEHAVIOR_DOC}"
    ),
    responses=error_responses(409, 422),
)
async def batch_purge_media(
    body: MediaIdsRequest,
    response: Response,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key", description=IDEMPOTENCY_HEADER_DOC),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    scope = idempotency_scope(user_id=user.id, method="POST", path="/media/actions/purge")
    body_hash = idempotency_body_hash(body.model_dump(mode="json"))
    replay = await idempotency_store.get_replay(scope=scope, idempotency_key=idempotency_key, body_hash=body_hash)
    if replay is not None:
        status_code, payload = replay
        if response is not None:
            response.status_code = status_code
        return payload

    _, lifecycle, _, _, _, _ = _media_services(db)
    result = await lifecycle.batch_purge_media(body, user)
    await idempotency_store.remember(
        scope=scope,
        idempotency_key=idempotency_key,
        body_hash=body_hash,
        status_code=status.HTTP_200_OK,
        payload=jsonable_encoder(result),
    )
    return result


@router.post(
    "/actions/empty-trash",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Empty Trash",
    description="Permanently purge all currently visible trashed media for the caller.",
)
async def empty_trash(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    _, lifecycle, _, _, _, _ = _media_services(db)
    await lifecycle.empty_trash(user)


@router.post(
    "/download",
    summary="Download Media",
    description="Create and stream a ZIP archive containing the requested media IDs.",
    response_class=StreamingResponse,
    response_description="ZIP archive of the requested media.",
    responses={
        200: {
            "content": {
                "application/zip": {
                    "schema": {"type": "string", "format": "binary"}
                }
            },
            "description": "ZIP archive of the requested media.",
        },
        **error_responses(404),
    },
)
async def download_media(body: MediaIdsRequest, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    query, _, _, _, _, _ = _media_services(db)
    rows = await query.get_downloadable_media(user, body.media_ids)
    buf = zip_media(rows)
    return StreamingResponse(
        content=iter([buf.read()]),
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=media.zip"},
    )


@router.post(
    "/tagging-jobs",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=TaggingJobQueuedResponse,
    summary="Queue Bulk Media Retagging",
    description="Queue new tagging jobs for the specified media items.",
    responses=error_responses(409, 422),
)
async def queue_bulk_media_tagging_jobs(
    body: MediaIdsRequest,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    _, _, _, processing, _, _ = _media_services(db)
    queued = await processing.bulk_retag_media(body.media_ids, user)
    return {"queued": queued}


@router.get(
    "/{media_id:uuid}",
    response_model=MediaDetail,
    summary="Get Media Detail",
    description="Return full media metadata, tagging details, and linked entities/references.",
    responses=error_responses(403, 404),
)
async def get_media(media_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    query, _, _, _, _, _ = _media_services(db)
    return await query.get_media_detail(media_id, user)


@router.patch(
    "/{media_id:uuid}",
    response_model=MediaDetail,
    summary="Update Media",
    description=(
        "Update a single media resource. Supports optimistic locking via `version`. "
        "For `tags`, `entities`, and `external_refs`: omitted means unchanged, empty array means clear all, populated array means replace all."
    ),
    openapi_extra={
        "requestBody": {
            "content": {
                "application/json": {
                    "examples": {
                        "replace_all": {
                            "summary": "Replace all tags/entities/external refs",
                            "value": {
                                "tags": ["Saber", "Sakura", "Rin"],
                                "entities": [
                                    {
                                        "entity_type": "character",
                                        "entity_id": None,
                                        "name": "Saber",
                                        "role": "primary",
                                        "confidence": 0.98,
                                    }
                                ],
                                "external_refs": [
                                    {
                                        "provider": "pixiv",
                                        "external_id": "75453892",
                                        "url": "https://www.pixiv.net/en/artworks/75453892",
                                    }
                                ],
                                "version": 5,
                            },
                        },
                        "clear_all": {
                            "summary": "Clear all tags/entities/external refs",
                            "value": {
                                "tags": [],
                                "entities": [],
                                "external_refs": [],
                                "version": 5,
                            },
                        },
                        "omit_unchanged": {
                            "summary": "Omit fields to leave them unchanged",
                            "value": {
                                "favorited": True,
                                "visibility": "public",
                                "version": 5,
                            },
                        },
                    }
                }
            }
        }
    },
    responses=error_responses(403, 404, 409, 422),
)
async def update_media(media_id: uuid.UUID, body: MediaUpdate, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    _, _, _, _, _, metadata = _media_services(db)
    return await metadata.update_media_metadata(media_id, user, body)


@router.get(
    "/{media_id:uuid}/file",
    summary="Download Original Media",
    description="Download the original uploaded media binary.",
    response_class=FileResponse,
    responses={
        200: {
            "content": {
                "application/octet-stream": {
                    "schema": {"type": "string", "format": "binary"}
                }
            },
            "description": "Original media file.",
        },
        **error_responses(403, 404),
    },
)
async def get_media_file(media_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    query, _, _, _, _, _ = _media_services(db)
    media = await query.get_visible_media(media_id, user)
    return FileResponse(media.filepath, media_type=media.mime_type)


@router.get(
    "/{media_id:uuid}/thumbnail",
    summary="Download Media Thumbnail",
    description="Download a generated thumbnail for supported media.",
    response_class=FileResponse,
    responses={
        200: {
            "content": {
                "image/webp": {
                    "schema": {"type": "string", "format": "binary"}
                }
            },
            "description": "WebP thumbnail image.",
        },
        **error_responses(403, 404),
    },
)
async def get_media_thumbnail(media_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    query, _, _, _, _, _ = _media_services(db)
    media = await query.get_visible_media(media_id, user)
    if not media.thumbnail_path:
        raise AppError(status_code=404, code=thumbnail_not_available, detail="Thumbnail not available")
    return FileResponse(media.thumbnail_path, media_type="image/webp")


@router.get(
    "/{media_id:uuid}/poster",
    summary="Download Media Poster",
    description="Download a generated poster image for animated media when available.",
    response_class=FileResponse,
    responses={
        200: {
            "content": {
                "image/png": {
                    "schema": {"type": "string", "format": "binary"}
                }
            },
            "description": "Poster image.",
        },
        **error_responses(403, 404),
    },
)
async def get_media_poster(media_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    query, _, _, _, _, _ = _media_services(db)
    media = await query.get_visible_media(media_id, user)
    if not media.poster_path:
        raise AppError(status_code=404, code=poster_not_available, detail="Poster not available")
    return FileResponse(media.poster_path, media_type="image/png")


@router.delete(
    "/{media_id:uuid}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete Media",
    description="Soft-delete a media item by moving it to trash.",
    responses=error_responses(403, 404),
)
async def delete_media(media_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    _, lifecycle, _, _, _, _ = _media_services(db)
    await lifecycle.soft_delete_media(media_id, user)


@router.post(
    "/{media_id:uuid}/restore",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Restore Media",
    description="Restore a previously trashed media item back to active state.",
    responses=error_responses(403, 404),
)
async def restore_media(media_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    _, lifecycle, _, _, _, _ = _media_services(db)
    await lifecycle.restore_media(media_id, user)


@router.delete(
    "/{media_id:uuid}/purge",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Purge Media",
    description="Permanently delete a media item and its associated files.",
    responses=error_responses(403, 404),
)
async def purge_media(media_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    _, lifecycle, _, _, _, _ = _media_services(db)
    await lifecycle.purge_media(media_id, user)


@router.post(
    "/{media_id:uuid}/tagging-jobs",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=TaggingJobQueuedResponse,
    summary="Queue Media Retagging",
    description="Queue a new tagging job for the specified media item.",
    responses=error_responses(403, 404, 409),
)
async def queue_media_tagging_job(media_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    _, _, _, processing, _, _ = _media_services(db)
    queued = await processing.retag_media(media_id, user)
    return {"queued": queued}
