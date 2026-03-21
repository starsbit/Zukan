import uuid

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Album, AlbumImage, AlbumShare, Image, User
from app.schemas import AlbumRead, AlbumShareCreate, AlbumUpdate, ImageListResponse, TagFilterMode
from app.services.images import enrich_images, favorited_ids


async def get_album(db: AsyncSession, album_id: uuid.UUID) -> Album:
    album = (await db.execute(select(Album).where(Album.id == album_id))).scalar_one_or_none()
    if album is None:
        raise HTTPException(status_code=404, detail="Album not found")
    return album


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


async def get_album_for_user(
    db: AsyncSession,
    album_id: uuid.UUID,
    user: User,
    require_edit: bool = False,
) -> Album:
    album = await get_album(db, album_id)
    if album.owner_id == user.id or user.is_admin:
        return album

    share = (
        await db.execute(select(AlbumShare).where(AlbumShare.album_id == album_id, AlbumShare.user_id == user.id))
    ).scalar_one_or_none()
    if share is None:
        raise HTTPException(status_code=404, detail="Album not found")
    if require_edit and not share.can_edit:
        raise HTTPException(status_code=403, detail="Read-only access")
    return album


async def get_album_for_edit(db: AsyncSession, album_id: uuid.UUID, user: User) -> Album:
    album = await get_album(db, album_id)
    if album.owner_id == user.id or user.is_admin:
        return album

    share = (
        await db.execute(select(AlbumShare).where(AlbumShare.album_id == album_id, AlbumShare.user_id == user.id))
    ).scalar_one_or_none()
    if share is None or not share.can_edit:
        raise HTTPException(status_code=403, detail="No edit access to album")
    return album


async def album_read(db: AsyncSession, album: Album) -> AlbumRead:
    count = (
        await db.execute(select(func.count(AlbumImage.image_id)).where(AlbumImage.album_id == album.id))
    ).scalar_one()
    return AlbumRead.model_validate(album).model_copy(update={"image_count": count})


async def create_album(db: AsyncSession, user: User, name: str, description: str | None) -> AlbumRead:
    album = Album(owner_id=user.id, name=name, description=description)
    db.add(album)
    await db.commit()
    await db.refresh(album)
    return await album_read(db, album)


async def list_albums(db: AsyncSession, user: User) -> list[AlbumRead]:
    owned = (
        await db.execute(select(Album).where(Album.owner_id == user.id).order_by(Album.created_at.desc()))
    ).scalars().all()
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
    if "cover_image_id" in body.model_fields_set:
        if body.cover_image_id is not None:
            exists = (
                await db.execute(
                    select(AlbumImage).where(
                        AlbumImage.album_id == album_id,
                        AlbumImage.image_id == body.cover_image_id,
                    )
                )
            ).scalar_one_or_none()
            if exists is None:
                raise HTTPException(status_code=400, detail="Image not in album")
        album.cover_image_id = body.cover_image_id

    await db.commit()
    await db.refresh(album)
    return await album_read(db, album)


async def delete_album(db: AsyncSession, album_id: uuid.UUID, user: User) -> None:
    album = await get_album(db, album_id)
    if album.owner_id != user.id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Forbidden")
    await db.delete(album)
    await db.commit()


async def list_album_images(
    db: AsyncSession,
    album_id: uuid.UUID,
    user: User,
    tags: str | None,
    exclude_tags: str | None,
    mode: TagFilterMode,
    page: int,
    page_size: int,
) -> ImageListResponse:
    await get_album_for_user(db, album_id, user)

    stmt = (
        select(Image)
        .join(AlbumImage, AlbumImage.image_id == Image.id)
        .where(AlbumImage.album_id == album_id, Image.deleted_at.is_(None))
    )
    if not user.show_nsfw:
        stmt = stmt.where(Image.is_nsfw == False)

    if tags:
        tag_list = [tag.strip() for tag in tags.split(",") if tag.strip()]
        if tag_list:
            stmt = stmt.where(Image.tags.contains(tag_list) if mode == TagFilterMode.AND else Image.tags.overlap(tag_list))
    if exclude_tags:
        excluded = [tag.strip() for tag in exclude_tags.split(",") if tag.strip()]
        if excluded:
            stmt = stmt.where(~Image.tags.contains(excluded))

    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (
        await db.execute(
            stmt.order_by(AlbumImage.position, AlbumImage.added_at).offset((page - 1) * page_size).limit(page_size)
        )
    ).scalars().all()

    favorites = await favorited_ids(db, user.id, [row.id for row in rows])
    return ImageListResponse(total=total, page=page, page_size=page_size, items=enrich_images(rows, favorites))


async def add_images_to_album(db: AsyncSession, album_id: uuid.UUID, image_ids: list[uuid.UUID], user: User) -> int:
    album = await get_album_for_user(db, album_id, user, require_edit=True)
    max_pos = (
        await db.execute(select(func.coalesce(func.max(AlbumImage.position), 0)).where(AlbumImage.album_id == album_id))
    ).scalar_one()
    existing_ids = set((await db.execute(select(AlbumImage.image_id).where(AlbumImage.album_id == album_id))).scalars().all())

    added = 0
    for image_id in image_ids:
        if image_id in existing_ids:
            continue
        exists = (
            await db.execute(select(Image.id).where(Image.id == image_id, Image.deleted_at.is_(None)))
        ).scalar_one_or_none()
        if exists is None:
            continue
        max_pos += 1
        db.add(AlbumImage(album_id=album_id, image_id=image_id, position=max_pos))
        existing_ids.add(image_id)
        added += 1

    await db.commit()
    await ensure_cover_image(db, album)
    return added


async def remove_image_from_album(db: AsyncSession, album_id: uuid.UUID, image_id: uuid.UUID, user: User) -> None:
    album = await get_album_for_user(db, album_id, user, require_edit=True)
    album_image = (
        await db.execute(select(AlbumImage).where(AlbumImage.album_id == album_id, AlbumImage.image_id == image_id))
    ).scalar_one_or_none()
    if album_image is None:
        raise HTTPException(status_code=404, detail="Image not in album")

    await db.delete(album_image)
    if album.cover_image_id == image_id:
        album.cover_image_id = None
    await db.commit()


async def share_album(db: AsyncSession, album_id: uuid.UUID, body: AlbumShareCreate, user: User) -> AlbumShare:
    album = await get_album_for_user(db, album_id, user)
    if album.owner_id != user.id and not user.is_admin:
        raise HTTPException(status_code=403, detail="Only the owner can manage shares")
    if body.user_id == user.id:
        raise HTTPException(status_code=400, detail="Cannot share with yourself")

    share = (
        await db.execute(select(AlbumShare).where(AlbumShare.album_id == album_id, AlbumShare.user_id == body.user_id))
    ).scalar_one_or_none()
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
        raise HTTPException(status_code=403, detail="Only the owner can manage shares")

    share = (
        await db.execute(select(AlbumShare).where(AlbumShare.album_id == album_id, AlbumShare.user_id == shared_user_id))
    ).scalar_one_or_none()
    if share is None:
        raise HTTPException(status_code=404, detail="Share not found")

    await db.delete(share)
    await db.commit()


async def get_album_download_images(db: AsyncSession, album_id: uuid.UUID, user: User) -> tuple[Album, list[Image]]:
    await get_album_for_user(db, album_id, user)
    rows = (
        await db.execute(
            select(Image)
            .join(AlbumImage, AlbumImage.image_id == Image.id)
            .where(AlbumImage.album_id == album_id, Image.deleted_at.is_(None))
            .order_by(AlbumImage.position, AlbumImage.added_at)
        )
    ).scalars().all()
    if not rows:
        raise HTTPException(status_code=404, detail="Album is empty")
    album = await get_album(db, album_id)
    return album, rows


async def bulk_add_to_album(db: AsyncSession, album_id: uuid.UUID, image_ids: list[uuid.UUID], user: User) -> tuple[int, int]:
    album = await get_album_for_edit(db, album_id, user)
    max_pos = (
        await db.execute(select(func.coalesce(func.max(AlbumImage.position), 0)).where(AlbumImage.album_id == album_id))
    ).scalar_one()
    existing_ids = set((await db.execute(select(AlbumImage.image_id).where(AlbumImage.album_id == album_id))).scalars().all())
    valid_ids = set(
        (await db.execute(select(Image.id).where(Image.id.in_(image_ids), Image.deleted_at.is_(None)))).scalars().all()
    )

    processed = 0
    for image_id in image_ids:
        if image_id not in valid_ids or image_id in existing_ids:
            continue
        max_pos += 1
        db.add(AlbumImage(album_id=album_id, image_id=image_id, position=max_pos))
        existing_ids.add(image_id)
        processed += 1

    await db.commit()
    if processed:
        await ensure_cover_image(db, album)
    return processed, len(image_ids) - processed


async def bulk_remove_from_album(
    db: AsyncSession,
    album_id: uuid.UUID,
    image_ids: list[uuid.UUID],
    user: User,
) -> tuple[int, int]:
    album = await get_album_for_edit(db, album_id, user)
    album_images = (
        await db.execute(select(AlbumImage).where(AlbumImage.album_id == album_id, AlbumImage.image_id.in_(image_ids)))
    ).scalars().all()

    removed_ids = {album_image.image_id for album_image in album_images}
    cover_removed = album.cover_image_id in removed_ids
    for album_image in album_images:
        await db.delete(album_image)

    if cover_removed:
        album.cover_image_id = None

    await db.commit()
    if cover_removed:
        await ensure_cover_image(db, album)

    return len(album_images), len(image_ids) - len(album_images)


async def ensure_cover_image(db: AsyncSession, album: Album) -> None:
    if album.cover_image_id is not None:
        return

    first_id = (
        await db.execute(
            select(AlbumImage.image_id).where(AlbumImage.album_id == album.id).order_by(AlbumImage.position).limit(1)
        )
    ).scalar_one_or_none()
    if first_id:
        album.cover_image_id = first_id
        await db.commit()
