from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.app.errors.error import AppError
from backend.app.errors.albums import album_not_found, album_read_only, media_not_in_album, album_share_forbidden, album_empty, share_self, share_not_found
from backend.app.errors.upload import version_conflict
from backend.app.errors.auth import forbidden
from backend.app.models.albums import Album, AlbumMedia, AlbumShare
from backend.app.models.media import Media, MediaTag
from backend.app.repositories.albums import AlbumRepository
from backend.app.repositories import media_filters
from backend.app.repositories.media import MediaRepository
from backend.app.repositories.media_interactions import UserFavoriteRepository
from backend.app.schemas import AlbumListResponse, AlbumRead, AlbumShareCreate, AlbumUpdate, BulkResult, MediaListResponse, TagFilterMode
from backend.app.utils.media_projections import enrich_media


class AlbumService:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def get_album(self, album_id: uuid.UUID) -> Album:
        album = await AlbumRepository(self._db).get_by_id(album_id)
        if album is None:
            raise AppError(status_code=404, code=album_not_found, detail="Album not found")
        return album

    async def get_album_for_user(self, album_id: uuid.UUID, user, require_edit: bool = False) -> Album:
        album = await self.get_album(album_id)
        if album.owner_id == user.id or user.is_admin:
            return album
        share = await AlbumRepository(self._db).get_share(album_id, user.id)
        if share is None:
            raise AppError(status_code=404, code=album_not_found, detail="Album not found")
        if require_edit and share.role not in ("editor", "owner"):
            raise AppError(status_code=403, code=album_read_only, detail="Read-only access")
        return album

    async def get_album_for_edit(self, album_id: uuid.UUID, user) -> Album:
        album = await self.get_album(album_id)
        if album.owner_id == user.id or user.is_admin:
            return album
        share = await AlbumRepository(self._db).get_share(album_id, user.id)
        if share is None or share.role not in ("editor", "owner"):
            raise AppError(status_code=403, code=album_read_only, detail="No edit access to album")
        return album

    async def album_read(self, album: Album) -> AlbumRead:
        count = await AlbumRepository(self._db).count_media(album.id)
        return AlbumRead.model_validate(album).model_copy(update={"media_count": count})

    async def create_album(self, user, name: str, description: str | None) -> AlbumRead:
        album = Album(owner_id=user.id, name=name, description=description)
        self._db.add(album)
        await self._db.commit()
        await self._db.refresh(album)
        return await self.album_read(album)

    async def list_albums(
        self,
        user,
        page: int = 1,
        page_size: int = 50,
        sort_by: str = "created_at",
        sort_order: str = "desc",
    ) -> AlbumListResponse:
        sort_col = Album.name if sort_by == "name" else Album.created_at
        order_expr = sort_col.asc() if sort_order == "asc" else sort_col.desc()
        albums_repo = AlbumRepository(self._db)
        total = await albums_repo.count_accessible(user.id)
        album_list = await albums_repo.list_accessible(user.id, offset=(page - 1) * page_size, limit=page_size, order_expr=order_expr)
        items = [await self.album_read(album) for album in album_list]
        return AlbumListResponse(total=total, page=page, page_size=page_size, items=items)

    async def update_album(self, album_id: uuid.UUID, body: AlbumUpdate, user) -> AlbumRead:
        albums_repo = AlbumRepository(self._db)
        album = await self.get_album_for_user(album_id, user, require_edit=True)
        if "version" in body.model_fields_set and body.version is not None and body.version != album.version:
            raise AppError(status_code=409, code=version_conflict, detail="Version conflict: resource was modified by another request")
        if "name" in body.model_fields_set:
            album.name = body.name
        if "description" in body.model_fields_set:
            album.description = body.description
        if "cover_media_id" in body.model_fields_set:
            if body.cover_media_id is not None:
                exists = await albums_repo.get_album_media_item(album_id, body.cover_media_id)
                if exists is None:
                    raise AppError(status_code=400, code=media_not_in_album, detail="Media not in album")
            album.cover_media_id = body.cover_media_id
        await self._db.commit()
        await self._db.refresh(album)
        return await self.album_read(album)

    async def delete_album(self, album_id: uuid.UUID, user) -> None:
        album = await self.get_album(album_id)
        if album.owner_id != user.id and not user.is_admin:
            raise AppError(status_code=403, code=forbidden, detail="Forbidden")
        await self._db.delete(album)
        await self._db.commit()

    async def list_album_media(
        self,
        album_id: uuid.UUID,
        user,
        tags: list[str] | None,
        exclude_tags: list[str] | None,
        mode: TagFilterMode,
        page: int,
        page_size: int,
    ) -> MediaListResponse:
        await self.get_album_for_user(album_id, user)
        stmt = (
            select(Media)
            .options(selectinload(Media.media_tags).selectinload(MediaTag.tag))
            .join(AlbumMedia, AlbumMedia.media_id == Media.id)
            .where(AlbumMedia.album_id == album_id, Media.deleted_at.is_(None))
        )
        if not user.show_nsfw:
            stmt = stmt.where(Media.is_nsfw == False)
        stmt = media_filters.apply_tag_filters(stmt, tags, exclude_tags, mode)
        total = (await self._db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
        rows = (
            await self._db.execute(stmt.order_by(AlbumMedia.position, AlbumMedia.added_at).offset((page - 1) * page_size).limit(page_size))
        ).scalars().all()
        favorites = await UserFavoriteRepository(self._db).get_favorited_ids(user.id, [row.id for row in rows])
        return MediaListResponse(total=total, page=page, page_size=page_size, items=enrich_media(rows, favorites))

    async def add_media_to_album(self, album_id: uuid.UUID, media_ids: list[uuid.UUID], user) -> int:
        albums_repo = AlbumRepository(self._db)
        media_repo = MediaRepository(self._db)
        album = await self.get_album_for_user(album_id, user, require_edit=True)
        max_pos = await albums_repo.get_max_position(album_id)
        existing_ids = await albums_repo.get_existing_media_ids(album_id)
        added = 0
        for media_id in media_ids:
            if media_id in existing_ids:
                continue
            media = await media_repo.get_by_id(media_id)
            if media is None or media.deleted_at is not None:
                continue
            max_pos += 1
            self._db.add(AlbumMedia(album_id=album_id, media_id=media_id, position=max_pos))
            existing_ids.add(media_id)
            added += 1
        await self._db.commit()
        await self.ensure_cover_media(album)
        return added

    async def remove_media_from_album(self, album_id: uuid.UUID, media_id: uuid.UUID, user) -> None:
        album = await self.get_album_for_user(album_id, user, require_edit=True)
        album_media = await AlbumRepository(self._db).get_album_media_item(album_id, media_id)
        if album_media is None:
            raise AppError(status_code=404, code=media_not_in_album, detail="Media not in album")
        await self._db.delete(album_media)
        if album.cover_media_id == media_id:
            album.cover_media_id = None
        await self._db.commit()

    async def share_album(self, album_id: uuid.UUID, body: AlbumShareCreate, user) -> AlbumShare:
        albums_repo = AlbumRepository(self._db)
        album = await self.get_album_for_user(album_id, user)
        if album.owner_id != user.id and not user.is_admin:
            raise AppError(status_code=403, code=album_share_forbidden, detail="Only the owner can manage shares")
        if body.user_id == user.id:
            raise AppError(status_code=400, code=share_self, detail="Cannot share with yourself")
        share = await albums_repo.get_share(album_id, body.user_id)
        if share:
            share.role = body.role
        else:
            share = AlbumShare(album_id=album_id, user_id=body.user_id, role=body.role, shared_by_user_id=user.id)
            self._db.add(share)
        await self._db.commit()
        await self._db.refresh(share)
        return share

    async def revoke_share(self, album_id: uuid.UUID, shared_user_id: uuid.UUID, user) -> None:
        albums_repo = AlbumRepository(self._db)
        album = await self.get_album_for_user(album_id, user)
        if album.owner_id != user.id and not user.is_admin:
            raise AppError(status_code=403, code=album_share_forbidden, detail="Only the owner can manage shares")
        share = await albums_repo.get_share(album_id, shared_user_id)
        if share is None:
            raise AppError(status_code=404, code=share_not_found, detail="Share not found")
        await self._db.delete(share)
        await self._db.commit()

    async def get_album_download_media(self, album_id: uuid.UUID, user) -> tuple[Album, list[Media]]:
        albums_repo = AlbumRepository(self._db)
        await self.get_album_for_user(album_id, user)
        rows = await albums_repo.get_media_for_download(album_id)
        if not rows:
            raise AppError(status_code=404, code=album_empty, detail="Album is empty")
        album = await self.get_album(album_id)
        return album, rows

    async def bulk_add_to_album(self, album_id: uuid.UUID, media_ids: list[uuid.UUID], user) -> BulkResult:
        albums_repo = AlbumRepository(self._db)
        album = await self.get_album_for_edit(album_id, user)
        max_pos = await albums_repo.get_max_position(album_id)
        existing_ids = await albums_repo.get_existing_media_ids(album_id)
        valid_ids = await MediaRepository(self._db).get_active_ids(media_ids)
        processed = 0
        for media_id in media_ids:
            if media_id not in valid_ids or media_id in existing_ids:
                continue
            max_pos += 1
            self._db.add(AlbumMedia(album_id=album_id, media_id=media_id, position=max_pos))
            existing_ids.add(media_id)
            processed += 1
        await self._db.commit()
        if processed:
            await self.ensure_cover_media(album)
        return BulkResult(processed=processed, skipped=len(media_ids) - processed)

    async def bulk_remove_from_album(self, album_id: uuid.UUID, media_ids: list[uuid.UUID], user) -> BulkResult:
        albums_repo = AlbumRepository(self._db)
        album = await self.get_album_for_edit(album_id, user)
        album_media_items = await albums_repo.get_album_media_items(album_id, media_ids)
        removed_ids = {item.media_id for item in album_media_items}
        cover_removed = album.cover_media_id in removed_ids
        for item in album_media_items:
            await self._db.delete(item)
        if cover_removed:
            album.cover_media_id = None
        await self._db.commit()
        if cover_removed:
            await self.ensure_cover_media(album)
        return BulkResult(processed=len(album_media_items), skipped=len(media_ids) - len(album_media_items))

    async def ensure_cover_media(self, album: Album) -> None:
        if album.cover_media_id is not None:
            return
        first_id = await AlbumRepository(self._db).get_first_media_id(album.id)
        if first_id:
            album.cover_media_id = first_id
            await self._db.commit()
