import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, Query, Response, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.database import get_db
from backend.app.routers.deps import current_user
from backend.app.models.auth import User
from backend.app.schemas import (
    AUTHENTICATED_ERROR_RESPONSES,
    AlbumListResponse,
    AlbumCreate,
    AlbumOwnershipTransferRequest,
    AlbumRead,
    AlbumShareCreate,
    AlbumShareRead,
    AlbumUpdate,
    BulkResult,
    MediaIdsRequest,
    MediaCursorPage,
    TagFilterMode,
    error_responses,
)
from backend.app.services.albums import AlbumService
from backend.app.utils.idempotency import idempotency_body_hash, idempotency_scope, idempotency_store
from backend.app.utils.storage import zip_media

router = APIRouter(prefix="/albums", tags=["albums"], responses=AUTHENTICATED_ERROR_RESPONSES)

IDEMPOTENCY_BEHAVIOR_DOC = (
    "Idempotency behavior when `Idempotency-Key` is provided: same key + same payload replays the original "
    "status code and JSON response body; same key + different payload is rejected with `409 idempotency_key_conflict`; "
    "keys are retained for about 24 hours in process-local memory."
)

IDEMPOTENCY_HEADER_DOC = (
    "Optional idempotency key for safe retries. Within the same user+method+path scope for about 24 hours: "
    "same key + same payload replays original status/body; same key + different payload returns 409."
)


@router.post(
    "",
    response_model=AlbumRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create Album",
    description="Create a new album owned by the authenticated user.",
)
async def create_album(
    body: AlbumCreate,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await AlbumService(db).create_album(user, body.name, body.description)


@router.get(
    "",
    response_model=AlbumListResponse,
    summary="List Albums",
    description="List albums visible to the caller using cursor pagination.",
)
async def list_albums(
    after: str | None = Query(default=None, description="Opaque cursor for keyset pagination."),
    page_size: int = Query(default=50, ge=1, le=200),
    sort_by: Literal["name", "created_at"] = Query(default="created_at"),
    sort_order: Literal["asc", "desc"] = Query(default="desc"),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await AlbumService(db).list_albums(user, after=after, page_size=page_size, sort_by=sort_by, sort_order=sort_order)


@router.get(
    "/{album_id}",
    response_model=AlbumRead,
    summary="Get Album",
    description="Get album metadata and permissions for a single album.",
    responses=error_responses(404),
)
async def get_album(
    album_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = AlbumService(db)
    album = await svc.get_album_for_user(album_id, user)
    return await svc.album_read(album)


@router.patch(
    "/{album_id}",
    response_model=AlbumRead,
    summary="Update Album",
    description="Update album fields. Supports optimistic locking via the `version` field.",
    responses=error_responses(403, 404, 409, 422),
)
async def update_album(
    album_id: uuid.UUID,
    body: AlbumUpdate,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await AlbumService(db).update_album(album_id, body, user)


@router.delete(
    "/{album_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete Album",
    description="Delete an album and remove all album share relationships.",
    responses=error_responses(403, 404),
)
async def delete_album(
    album_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    await AlbumService(db).delete_album(album_id, user)


@router.get(
    "/{album_id}/media",
    response_model=MediaCursorPage,
    summary="List Album Media",
    description="List media in a specific album with tag filtering and cursor pagination.",
    responses=error_responses(404),
)
async def list_album_media(
    album_id: uuid.UUID,
    tag: Annotated[list[str] | None, Query(description="Tags that must be present. Repeat for multiple: ?tag=cat&tag=night")] = None,
    exclude_tag: Annotated[list[str] | None, Query(description="Tags that must not be present. Repeat for multiple.")] = None,
    mode: TagFilterMode = TagFilterMode.AND,
    after: str | None = Query(default=None, description="Opaque cursor for keyset pagination."),
    page_size: int = Query(default=20, ge=1, le=200),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await AlbumService(db).list_album_media(album_id, user, tag, exclude_tag, mode, after, page_size)


@router.put(
    "/{album_id}/media",
    response_model=BulkResult,
    summary="Add Media to Album",
    description="Bulk-add media items to an album.",
    responses=error_responses(403, 404),
)
async def add_media_to_album(
    album_id: uuid.UUID,
    body: MediaIdsRequest,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await AlbumService(db).bulk_add_to_album(album_id, body.media_ids, user)


@router.delete(
    "/{album_id}/media",
    response_model=BulkResult,
    summary="Remove Media from Album",
    description="Bulk-remove media items from an album.",
    responses=error_responses(403, 404),
)
async def remove_media_from_album(
    album_id: uuid.UUID,
    body: MediaIdsRequest,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await AlbumService(db).bulk_remove_from_album(album_id, body.media_ids, user)


@router.post(
    "/{album_id}/shares",
    response_model=AlbumShareRead,
    summary="Share Album",
    description=(
        "Create or upsert album sharing permissions for a target user.\n\n"
        f"{IDEMPOTENCY_BEHAVIOR_DOC}"
    ),
    responses={
        201: {"model": AlbumShareRead, "description": "Share created."},
        **error_responses(403, 404, 409, 422),
    },
)
async def share_album(
    album_id: uuid.UUID,
    body: AlbumShareCreate,
    response: Response,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key", description=IDEMPOTENCY_HEADER_DOC),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    scope = idempotency_scope(user_id=user.id, method="POST", path=f"/albums/{album_id}/shares")
    body_hash = idempotency_body_hash(body.model_dump(mode="json"))
    replay = await idempotency_store.get_replay(scope=scope, idempotency_key=idempotency_key, body_hash=body_hash)
    if replay is not None:
        status_code, payload = replay
        response.status_code = status_code
        return payload

    share, created = await AlbumService(db).share_album(album_id, body, user)
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    await idempotency_store.remember(
        scope=scope,
        idempotency_key=idempotency_key,
        body_hash=body_hash,
        status_code=response.status_code,
        payload=jsonable_encoder(share),
    )
    return share


@router.post(
    "/{album_id}/owner/transfer",
    response_model=AlbumRead,
    summary="Transfer Album Ownership",
    description="Transfer album ownership to an existing editor. This is distinct from sharing and requires owner privileges.",
    responses=error_responses(403, 404, 422),
)
async def transfer_album_ownership(
    album_id: uuid.UUID,
    body: AlbumOwnershipTransferRequest,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    return await AlbumService(db).transfer_album_ownership(album_id, body, user)


@router.get(
    "/{album_id}/download",
    summary="Download Album Media",
    description="Stream a ZIP archive containing all media visible in the album.",
    response_class=StreamingResponse,
    responses={
        200: {
            "content": {
                "application/zip": {
                    "schema": {"type": "string", "format": "binary"}
                }
            },
            "description": "ZIP archive of all album media.",
        },
        **error_responses(404),
    },
)
async def download_album(
    album_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    album, rows = await AlbumService(db).get_album_download_media(album_id, user)
    buf = zip_media(rows)
    safe_name = album.name.replace('"', "").replace("/", "-")
    return StreamingResponse(
        content=iter([buf.read()]),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.zip"'},
    )


@router.delete(
    "/{album_id}/shares/{shared_user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Revoke Album Share",
    description="Revoke album access for a previously shared user.",
    responses=error_responses(403, 404),
)
async def revoke_share(
    album_id: uuid.UUID,
    shared_user_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    await AlbumService(db).revoke_share(album_id, shared_user_id, user)
