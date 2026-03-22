import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.errors import AppError, album_not_found, album_read_only, album_share_forbidden, forbidden, media_not_in_album, share_not_found, share_self
from backend.app.models import Album, AlbumMedia, AlbumShare, Media, User
from backend.app.schemas import AlbumRead, AlbumShareCreate, AlbumUpdate, MediaListResponse, TagFilterMode
from backend.app.services.media import _apply_tag_filters, enrich_media, favorited_ids


async def get_album(db: AsyncSession, album_id: uuid.UUID) -> Album:
    album = (await db.execute(select(Album).where(Album.id == album_id))).scalar_one_or_none()
    if album is None:
        raise AppError(status_code=404, code=album_not_found, detail="Album not found")
    return album


def album_access(owner_id: uuid.UUID, user_id: uuid.UUID, is_admin: bool, share_can_edit: bool | None) -> tuple[bool, bool]:
    if is_admin or user_id == owner_id:
        return True, True
    if share_can_edit is None:
        return False, False
    return True, share_can_edit


async def get_album_for_user(db: AsyncSession, album_id: uuid.UUID, user: User, require_edit: bool = False) -> Album:
    album = await get_album(db, album_id)
    if album.owner_id == user.id or user.is_admin:
        return album
    share = (await db.execute(select(AlbumShare).where(AlbumShare.album_id == album_id, AlbumShare.user_id == user.id))).scalar_one_or_none()
    if share is None:
        raise AppError(status_code=404, code=album_not_found, detail="Album not found")
    if require_edit and not share.can_edit:
        raise AppError(status_code=403, code=album_read_only, detail="Read-only access")
    return album


async def get_album_for_edit(db: AsyncSession, album_id: uuid.UUID, user: User) -> Album:
    album = await get_album(db, album_id)
    if album.owner_id == user.id or user.is_admin:
        return album
    share = (await db.execute(select(AlbumShare).where(AlbumShare.album_id == album_id, AlbumShare.user_id == user.id))).scalar_one_or_none()
    if share is None or not share.can_edit:
        raise AppError(status_code=403, code=album_read_only, detail="No edit access to album")
    return album


async def album_read(db: AsyncSession, album: Album) -> AlbumRead:
    count = (await db.execute(select(func.count(AlbumMedia.media_id)).where(AlbumMedia.album_id == album.id))).scalar_one()
    return AlbumRead.model_validate(album).model_copy(update={"media_count": count})


async def create_album(db: AsyncSession, user: User, name: str, description: str | None) -> AlbumRead:
    album = Album(owner_id=user.id, name=name, description=description)
    db.add(album)
    await db.commit()
    await db.refresh(album)
    return await album_read(db, album)


async def list_albums(db: AsyncSession, user: User) -> list[AlbumRead]:
    owned = (await db.execute(select(Album).where(Album.owner_id == user.id).order_by(Album.created_at.desc()))).scalars().all()
    shared = (
        await db.execute(
            select(Album)
            .join(AlbumShare, AlbumShare.album_id == Album.id)
            .where(AlbumShare.user_id == user.id, Album.owner_id != user.id)
            .order_by(Album.created_at.desc())
        )
    ).scalars().all()
    return [await album_read(db, album) for album in [*owned, *shared]]


async def update_album(db: AsyncSession, album_id: uuid.UUID, body: AlbumUpdate, user: User) -> AlbumRead:
    album = await get_album_for_user(db, album_id, user, require_edit=True)
    if "name" in body.model_fields_set:
        album.name = body.name
    if "description" in body.model_fields_set:
        album.description = body.description
    if "cover_media_id" in body.model_fields_set:
        if body.cover_media_id is not None:
            exists = (
                await db.execute(
                    select(AlbumMedia).where(AlbumMedia.album_id == album_id, AlbumMedia.media_id == body.cover_media_id)
                )
            ).scalar_one_or_none()
            if exists is None:
                raise AppError(status_code=400, code=media_not_in_album, detail="Media not in album")
        album.cover_media_id = body.cover_media_id
    await db.commit()
    await db.refresh(album)
    return await album_read(db, album)


async def delete_album(db: AsyncSession, album_id: uuid.UUID, user: User) -> None:
    album = await get_album(db, album_id)
    if album.owner_id != user.id and not user.is_admin:
        raise AppError(status_code=403, code=forbidden, detail="Forbidden")
    await db.delete(album)
    await db.commit()


async def list_album_media(
    db: AsyncSession,
    album_id: uuid.UUID,
    user: User,
    tags: list[str] | None,
    exclude_tags: list[str] | None,
    mode: TagFilterMode,
    page: int,
    page_size: int,
) -> MediaListResponse:
    await get_album_for_user(db, album_id, user)
    stmt = (
        select(Media)
        .join(AlbumMedia, AlbumMedia.media_id == Media.id)
        .where(AlbumMedia.album_id == album_id, Media.deleted_at.is_(None))
    )
    if not user.show_nsfw:
        stmt = stmt.where(Media.is_nsfw == False)
    stmt = _apply_tag_filters(stmt, tags, exclude_tags, mode)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (
        await db.execute(stmt.order_by(AlbumMedia.position, AlbumMedia.added_at).offset((page - 1) * page_size).limit(page_size))
    ).scalars().all()
    favorites = await favorited_ids(db, user.id, [row.id for row in rows])
    return MediaListResponse(total=total, page=page, page_size=page_size, items=enrich_media(rows, favorites))


async def add_media_to_album(db: AsyncSession, album_id: uuid.UUID, media_ids: list[uuid.UUID], user: User) -> int:
    album = await get_album_for_user(db, album_id, user, require_edit=True)
    max_pos = (await db.execute(select(func.coalesce(func.max(AlbumMedia.position), 0)).where(AlbumMedia.album_id == album_id))).scalar_one()
    existing_ids = set((await db.execute(select(AlbumMedia.media_id).where(AlbumMedia.album_id == album_id))).scalars().all())
    added = 0
    for media_id in media_ids:
        if media_id in existing_ids:
            continue
        exists = (await db.execute(select(Media.id).where(Media.id == media_id, Media.deleted_at.is_(None)))).scalar_one_or_none()
        if exists is None:
            continue
        max_pos += 1
        db.add(AlbumMedia(album_id=album_id, media_id=media_id, position=max_pos))
        existing_ids.add(media_id)
        added += 1
    await db.commit()
    await ensure_cover_media(db, album)
    return added


async def remove_media_from_album(db: AsyncSession, album_id: uuid.UUID, media_id: uuid.UUID, user: User) -> None:
    album = await get_album_for_user(db, album_id, user, require_edit=True)
    album_media = (
        await db.execute(select(AlbumMedia).where(AlbumMedia.album_id == album_id, AlbumMedia.media_id == media_id))
    ).scalar_one_or_none()
    if album_media is None:
        raise AppError(status_code=404, code=media_not_in_album, detail="Media not in album")
    await db.delete(album_media)
    if album.cover_media_id == media_id:
        album.cover_media_id = None
    await db.commit()


async def share_album(db: AsyncSession, album_id: uuid.UUID, body: AlbumShareCreate, user: User) -> AlbumShare:
    album = await get_album_for_user(db, album_id, user)
    if album.owner_id != user.id and not user.is_admin:
        raise AppError(status_code=403, code=album_share_forbidden, detail="Only the owner can manage shares")
    if body.user_id == user.id:
        raise AppError(status_code=400, code=share_self, detail="Cannot share with yourself")
    share = (await db.execute(select(AlbumShare).where(AlbumShare.album_id == album_id, AlbumShare.user_id == body.user_id))).scalar_one_or_none()
    if share:
        share.can_edit = body.can_edit
    else:
        share = AlbumShare(album_id=album_id, user_id=body.user_id, can_edit=body.can_edit)
        db.add(share)
    await db.commit()
    await db.refresh(share)
    return share


async def revoke_share(db: AsyncSession, album_id: uuid.UUID, shared_user_id: uuid.UUID, user: User) -> None:
    album = await get_album_for_user(db, album_id, user)
    if album.owner_id != user.id and not user.is_admin:
        raise AppError(status_code=403, code=album_share_forbidden, detail="Only the owner can manage shares")
    share = (
        await db.execute(select(AlbumShare).where(AlbumShare.album_id == album_id, AlbumShare.user_id == shared_user_id))
    ).scalar_one_or_none()
    if share is None:
        raise AppError(status_code=404, code=share_not_found, detail="Share not found")
    await db.delete(share)
    await db.commit()


async def get_album_download_media(db: AsyncSession, album_id: uuid.UUID, user: User) -> tuple[Album, list[Media]]:
    await get_album_for_user(db, album_id, user)
    rows = (
        await db.execute(
            select(Media)
            .join(AlbumMedia, AlbumMedia.media_id == Media.id)
            .where(AlbumMedia.album_id == album_id, Media.deleted_at.is_(None))
            .order_by(AlbumMedia.position, AlbumMedia.added_at)
        )
    ).scalars().all()
    if not rows:
        raise AppError(status_code=404, code=album_empty, detail="Album is empty")
    album = await get_album(db, album_id)
    return album, rows


async def bulk_add_to_album(db: AsyncSession, album_id: uuid.UUID, media_ids: list[uuid.UUID], user: User) -> tuple[int, int]:
    album = await get_album_for_edit(db, album_id, user)
    max_pos = (await db.execute(select(func.coalesce(func.max(AlbumMedia.position), 0)).where(AlbumMedia.album_id == album_id))).scalar_one()
    existing_ids = set((await db.execute(select(AlbumMedia.media_id).where(AlbumMedia.album_id == album_id))).scalars().all())
    valid_ids = set((await db.execute(select(Media.id).where(Media.id.in_(media_ids), Media.deleted_at.is_(None)))).scalars().all())
    processed = 0
    for media_id in media_ids:
        if media_id not in valid_ids or media_id in existing_ids:
            continue
        max_pos += 1
        db.add(AlbumMedia(album_id=album_id, media_id=media_id, position=max_pos))
        existing_ids.add(media_id)
        processed += 1
    await db.commit()
    if processed:
        await ensure_cover_media(db, album)
    return processed, len(media_ids) - processed


async def bulk_remove_from_album(db: AsyncSession, album_id: uuid.UUID, media_ids: list[uuid.UUID], user: User) -> tuple[int, int]:
    album = await get_album_for_edit(db, album_id, user)
    album_media = (await db.execute(select(AlbumMedia).where(AlbumMedia.album_id == album_id, AlbumMedia.media_id.in_(media_ids)))).scalars().all()
    removed_ids = {item.media_id for item in album_media}
    cover_removed = album.cover_media_id in removed_ids
    for item in album_media:
        await db.delete(item)
    if cover_removed:
        album.cover_media_id = None
    await db.commit()
    if cover_removed:
        await ensure_cover_media(db, album)
    return len(album_media), len(media_ids) - len(album_media)


async def ensure_cover_media(db: AsyncSession, album: Album) -> None:
    if album.cover_media_id is not None:
        return
    first_id = (
        await db.execute(select(AlbumMedia.media_id).where(AlbumMedia.album_id == album.id).order_by(AlbumMedia.position).limit(1))
    ).scalar_one_or_none()
    if first_id:
        album.cover_media_id = first_id
        await db.commit()
