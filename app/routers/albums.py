import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import current_user
from app.models import Album, AlbumImage, AlbumShare, Image, User
from app.routers.images import _enrich, _favorited_ids
from app.schemas import (
    AddImagesToAlbum,
    AlbumCreate,
    AlbumRead,
    AlbumShareCreate,
    AlbumShareRead,
    AlbumUpdate,
    ImageListResponse,
    TagFilterMode,
)
from app.services.storage import zip_images

router = APIRouter(prefix="/albums", tags=["albums"])


def album_access(
    owner_id: uuid.UUID,
    user_id: uuid.UUID,
    is_admin: bool,
    share_can_edit: bool | None,
) -> tuple[bool, bool]:
    if is_admin or user_id == owner_id:
        return True, True
    if share_can_edit is None:
        return False, False
    return True, share_can_edit


async def _get_album(
    db: AsyncSession,
    album_id: uuid.UUID,
    user: User,
    require_edit: bool = False,
) -> Album:
    album = (await db.execute(select(Album).where(Album.id == album_id))).scalar_one_or_none()
    if album is None:
        raise HTTPException(status_code=404, detail="Album not found")

    if album.owner_id == user.id or user.is_admin:
        return album

    share = (await db.execute(
        select(AlbumShare).where(AlbumShare.album_id == album_id, AlbumShare.user_id == user.id)
    )).scalar_one_or_none()

    if share is None:
        raise HTTPException(status_code=404, detail="Album not found")
    if require_edit and not share.can_edit:
        raise HTTPException(status_code=403, detail="Read-only access")
    return album


async def _album_read(db: AsyncSession, album: Album) -> AlbumRead:
    count = (await db.execute(
        select(func.count(AlbumImage.image_id)).where(AlbumImage.album_id == album.id)
    )).scalar_one()
    return AlbumRead.model_validate(album).model_copy(update={"image_count": count})


@router.post("", response_model=AlbumRead, status_code=status.HTTP_201_CREATED)
async def create_album(
    body: AlbumCreate,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    album = Album(owner_id=user.id, name=body.name, description=body.description)
    db.add(album)
    await db.commit()
    await db.refresh(album)
    return await _album_read(db, album)


@router.get("", response_model=list[AlbumRead])
async def list_albums(
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    owned = (await db.execute(
        select(Album).where(Album.owner_id == user.id).order_by(Album.created_at.desc())
    )).scalars().all()

    shared = (await db.execute(
        select(Album)
        .join(AlbumShare, AlbumShare.album_id == Album.id)
        .where(AlbumShare.user_id == user.id, Album.owner_id != user.id)
        .order_by(Album.created_at.desc())
    )).scalars().all()

    return [await _album_read(db, a) for a in list(owned) + list(shared)]


@router.get("/{album_id}", response_model=AlbumRead)
async def get_album(
    album_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    album = await _get_album(db, album_id, user)
    return await _album_read(db, album)


@router.patch("/{album_id}", response_model=AlbumRead)
async def update_album(
    album_id: uuid.UUID,
    body: AlbumUpdate,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    album = await _get_album(db, album_id, user, require_edit=True)

    if "name" in body.model_fields_set:
        album.name = body.name
    if "description" in body.model_fields_set:
        album.description = body.description
    if "cover_image_id" in body.model_fields_set:
        if body.cover_image_id is not None:
            exists = (await db.execute(
                select(AlbumImage).where(AlbumImage.album_id == album_id, AlbumImage.image_id == body.cover_image_id)
            )).scalar_one_or_none()
            if exists is None:
                raise HTTPException(status_code=400, detail="Image not in album")
        album.cover_image_id = body.cover_image_id

    await db.commit()
    await db.refresh(album)
    return await _album_read(db, album)


@router.delete("/{album_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_album(
    album_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    album = (await db.execute(select(Album).where(Album.id == album_id))).scalar_one_or_none()
    if album is None:
        raise HTTPException(status_code=404, detail="Album not found")
    if album.owner_id != user.id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Forbidden")
    await db.delete(album)
    await db.commit()


@router.get("/{album_id}/images", response_model=ImageListResponse)
async def list_album_images(
    album_id: uuid.UUID,
    tags: str | None = Query(default=None),
    exclude_tags: str | None = Query(default=None),
    mode: TagFilterMode = TagFilterMode.AND,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_album(db, album_id, user)

    stmt = (
        select(Image)
        .join(AlbumImage, AlbumImage.image_id == Image.id)
        .where(AlbumImage.album_id == album_id, Image.deleted_at.is_(None))
    )
    if not user.show_nsfw:
        stmt = stmt.where(Image.is_nsfw == False)

    if tags:
        tag_list = [t.strip() for t in tags.split(",") if t.strip()]
        if tag_list:
            stmt = stmt.where(Image.tags.contains(tag_list) if mode == TagFilterMode.AND else Image.tags.overlap(tag_list))
    if exclude_tags:
        excl = [t.strip() for t in exclude_tags.split(",") if t.strip()]
        if excl:
            stmt = stmt.where(~Image.tags.contains(excl))

    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (await db.execute(
        stmt.order_by(AlbumImage.position, AlbumImage.added_at).offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()

    favs = await _favorited_ids(db, user.id, [r.id for r in rows])
    return ImageListResponse(total=total, page=page, page_size=page_size, items=_enrich(rows, favs))


@router.post("/{album_id}/images", status_code=status.HTTP_204_NO_CONTENT)
async def add_images_to_album(
    album_id: uuid.UUID,
    body: AddImagesToAlbum,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    album = await _get_album(db, album_id, user, require_edit=True)

    max_pos = (await db.execute(
        select(func.coalesce(func.max(AlbumImage.position), 0)).where(AlbumImage.album_id == album_id)
    )).scalar_one()

    existing_ids = set((await db.execute(
        select(AlbumImage.image_id).where(AlbumImage.album_id == album_id)
    )).scalars().all())

    for image_id in body.image_ids:
        if image_id in existing_ids:
            continue
        if (await db.execute(
            select(Image.id).where(Image.id == image_id, Image.deleted_at.is_(None))
        )).scalar_one_or_none() is None:
            continue
        max_pos += 1
        db.add(AlbumImage(album_id=album_id, image_id=image_id, position=max_pos))
        existing_ids.add(image_id)

    await db.commit()

    if album.cover_image_id is None:
        first_id = (await db.execute(
            select(AlbumImage.image_id)
            .where(AlbumImage.album_id == album_id)
            .order_by(AlbumImage.position)
            .limit(1)
        )).scalar_one_or_none()
        if first_id:
            album.cover_image_id = first_id
            await db.commit()


@router.delete("/{album_id}/images/{image_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_image_from_album(
    album_id: uuid.UUID,
    image_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    album = await _get_album(db, album_id, user, require_edit=True)

    ai = (await db.execute(
        select(AlbumImage).where(AlbumImage.album_id == album_id, AlbumImage.image_id == image_id)
    )).scalar_one_or_none()
    if ai is None:
        raise HTTPException(status_code=404, detail="Image not in album")

    await db.delete(ai)
    if album.cover_image_id == image_id:
        album.cover_image_id = None
    await db.commit()


@router.post("/{album_id}/share", response_model=AlbumShareRead)
async def share_album(
    album_id: uuid.UUID,
    body: AlbumShareCreate,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    album = await _get_album(db, album_id, user)
    if album.owner_id != user.id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Only the owner can manage shares")
    if body.user_id == user.id:
        raise HTTPException(status_code=400, detail="Cannot share with yourself")

    share = (await db.execute(
        select(AlbumShare).where(AlbumShare.album_id == album_id, AlbumShare.user_id == body.user_id)
    )).scalar_one_or_none()

    if share:
        share.can_edit = body.can_edit
    else:
        share = AlbumShare(album_id=album_id, user_id=body.user_id, can_edit=body.can_edit)
        db.add(share)

    await db.commit()
    await db.refresh(share)
    return share


@router.get("/{album_id}/download")
async def download_album(
    album_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_album(db, album_id, user)

    rows = (await db.execute(
        select(Image)
        .join(AlbumImage, AlbumImage.image_id == Image.id)
        .where(AlbumImage.album_id == album_id, Image.deleted_at.is_(None))
        .order_by(AlbumImage.position, AlbumImage.added_at)
    )).scalars().all()

    if not rows:
        raise HTTPException(status_code=404, detail="Album is empty")

    album = (await db.execute(select(Album).where(Album.id == album_id))).scalar_one()
    buf = zip_images(rows)
    safe_name = album.name.replace('"', "").replace("/", "-")
    return StreamingResponse(
        content=iter([buf.read()]),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.zip"'},
    )


@router.delete("/{album_id}/share/{shared_user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_share(
    album_id: uuid.UUID,
    shared_user_id: uuid.UUID,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    album = await _get_album(db, album_id, user)
    if album.owner_id != user.id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Only the owner can manage shares")

    share = (await db.execute(
        select(AlbumShare).where(AlbumShare.album_id == album_id, AlbumShare.user_id == shared_user_id)
    )).scalar_one_or_none()
    if share is None:
        raise HTTPException(status_code=404, detail="Share not found")

    await db.delete(share)
    await db.commit()
