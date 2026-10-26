from __future__ import annotations
import logging
import uuid
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from backend.app.errors.error import AppError
from backend.app.errors.albums import album_empty, album_not_found, media_not_in_album
from backend.app.errors.upload import version_conflict
from backend.app.models.albums import Album, AlbumMedia
from backend.app.models.media import Media, MediaTag
from backend.app.repositories.albums import AlbumRepository
from backend.app.repositories import media_filters
from backend.app.repositories.media import MediaRepository
from backend.app.repositories.media_interactions import UserFavoriteRepository
from backend.app.schemas import (
    AlbumListResponse,
    AlbumPreviewMedia,
    AlbumRead,
    AlbumUpdate,
    BulkResult,
    MediaCursorPage,
    TagFilterMode,
)
from backend.app.utils.media_classification import (
    effective_nsfw_expr,
    effective_sensitive_expr,
)
from backend.app.utils.media_projections import enrich_media
from backend.app.utils.pagination import (
    apply_cursor_where_expr,
    decode_cursor_typed,
    encode_cursor,
)

logger = logging.getLogger(__name__)


class AlbumService:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def get_album(self, album_id: uuid.UUID) -> Album:
        album = await AlbumRepository(self._db).get_by_id(album_id)
        if album is None:
            raise AppError(status_code=404, code=album_not_found, detail="Album not found")
        return album

    async def get_album_for_user(self, album_id, user, require_edit=False):
        return await self.get_album(album_id)

    async def get_album_for_edit(self, album_id, user):
        return await self.get_album(album_id)

    async def album_read(self, album: Album, user) -> AlbumRead:
        reads = await self._build_album_reads([album], user)
        return reads[0]

    async def create_album(self, user, name: str, description: str | None) -> AlbumRead:
        album = Album(name=name, description=description)
        self._db.add(album)
        await self._db.commit()
        await self._db.refresh(album)
        logger.info(
            "Created album album_id=%s owner_id=%s name=%s",
            album.id,
            user.id,
            album.name,
        )
        return await self.album_read(album, user)

    async def list_albums(
        self,
        user,
        after: str | None = None,
        page_size: int = 50,
        sort_by: str = "created_at",
        sort_order: str = "desc",
    ) -> AlbumListResponse:
        sort_col = Album.name if sort_by == "name" else Album.created_at
        albums_repo = AlbumRepository(self._db)
        stmt = select(Album)
        total = (
            await self._db.execute(select(func.count()).select_from(Album))
        ).scalar_one()
        if after:
            value_type = "str" if sort_by == "name" else "datetime"
            decoded = decode_cursor_typed(after, value_type)
            if decoded is not None:
                cursor_val, cursor_id = decoded
                stmt = apply_cursor_where_expr(
                    stmt,
                    sort_expr=sort_col,
                    id_expr=Album.id,
                    sort_order=sort_order,
                    cursor_val=cursor_val,
                    cursor_id=cursor_id,
                )
        if sort_order == "asc":
            order_exprs = [sort_col.asc(), Album.id.asc()]
        else:
            order_exprs = [sort_col.desc(), Album.id.desc()]
        album_list = (
            (await self._db.execute(stmt.order_by(*order_exprs).limit(page_size + 1)))
            .scalars()
            .all()
        )
        has_more = len(album_list) > page_size
        album_list = album_list[:page_size]
        items = await self._build_album_reads(album_list, user)
        next_cursor = None
        if has_more and album_list:
            last = album_list[-1]
            sort_val = last.name if sort_by == "name" else last.created_at
            next_cursor = encode_cursor(sort_val, last.id)
        return AlbumListResponse(
            total=total,
            next_cursor=next_cursor,
            has_more=has_more,
            page_size=page_size,
            items=items,
        )

    async def update_album(self, album_id: uuid.UUID, body: AlbumUpdate, user) -> AlbumRead:
        albums_repo = AlbumRepository(self._db)
        album = await self.get_album_for_user(album_id, user, require_edit=True)
        if "version" in body.model_fields_set and body.version is not None and body.version != album.version:
            raise AppError(
                status_code=409,
                code=version_conflict,
                detail="Version conflict: resource was modified by another request",
                details={
                    "current_version": album.version,
                    "provided_version": body.version,
                },
            )
        if "name" in body.model_fields_set:
            album.name = body.name
        if "description" in body.model_fields_set:
            album.description = body.description
        if "cover_media_id" in body.model_fields_set:
            if body.cover_media_id is not None:
                exists = await albums_repo.get_album_media_item(album_id, body.cover_media_id)
                if exists is None:
                    raise AppError(status_code=422, code=media_not_in_album, detail="Media not in album")
            album.cover_media_id = body.cover_media_id
        await self._db.commit()
        await self._db.refresh(album)
        logger.info("Updated album album_id=%s user_id=%s fields=%s", album.id, user.id, sorted(body.model_fields_set))
        return await self.album_read(album, user)

    async def delete_album(self, album_id: uuid.UUID, user) -> None:
        album = await self.get_album(album_id)
        await self._db.delete(album)
        await self._db.commit()
        logger.info("Deleted album album_id=%s user_id=%s", album_id, user.id)

    async def list_album_media(
        self,
        album_id: uuid.UUID,
        user,
        tags: list[str] | None,
        exclude_tags: list[str] | None,
        mode: TagFilterMode,
        after: str | None,
        page_size: int,
    ) -> MediaCursorPage:
        await self.get_album_for_user(album_id, user)
        media_repo = MediaRepository(self._db)
        stmt = (
            select(Media, AlbumMedia.position)
            .options(selectinload(Media.media_tags).selectinload(MediaTag.tag))
            .join(AlbumMedia, AlbumMedia.media_id == Media.id)
            .where(AlbumMedia.album_id == album_id, Media.deleted_at.is_(None))
        )
        if not user.show_nsfw:
            stmt = stmt.where(effective_nsfw_expr().is_(False))
        if not user.show_sensitive:
            stmt = stmt.where(effective_sensitive_expr().is_(False))
        stmt = media_filters.apply_tag_filters(stmt, tags, exclude_tags, mode)
        if after:
            decoded = decode_cursor_typed(after, "int")
            if decoded is not None:
                cursor_pos, cursor_id = decoded
                stmt = stmt.where(
                    (AlbumMedia.position > cursor_pos)
                    | (AlbumMedia.position == cursor_pos) & (Media.id > cursor_id)
                )
        total = (
            await self._db.execute(select(func.count()).select_from(stmt.subquery()))
        ).scalar_one()
        rows_with_pos = (
            await self._db.execute(
                stmt.order_by(AlbumMedia.position.asc(), Media.id.asc()).limit(
                    page_size + 1
                )
            )
        ).all()
        has_more = len(rows_with_pos) > page_size
        rows_with_pos = rows_with_pos[:page_size]
        rows = [row[0] for row in rows_with_pos]
        favorites = await UserFavoriteRepository(self._db).get_favorited_ids(
            [row.id for row in rows]
        )
        next_cursor = None
        if has_more and rows_with_pos:
            last_media, last_position = rows_with_pos[-1]
            next_cursor = encode_cursor(last_position, last_media.id)
        return MediaCursorPage(
            total=total,
            next_cursor=next_cursor,
            has_more=has_more,
            page_size=page_size,
            items=enrich_media(rows, favorites),
        )

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
        logger.info("Added media to album album_id=%s user_id=%s added=%s requested=%s", album_id, user.id, added, len(media_ids))
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
        logger.info("Removed media from album album_id=%s media_id=%s user_id=%s", album_id, media_id, user.id)

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
        logger.info("Bulk added media to album album_id=%s user_id=%s processed=%s skipped=%s", album_id, user.id, processed, len(media_ids) - processed)
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
        logger.info("Bulk removed media from album album_id=%s user_id=%s processed=%s skipped=%s", album_id, user.id, len(album_media_items), len(media_ids) - len(album_media_items))
        return BulkResult(processed=len(album_media_items), skipped=len(media_ids) - len(album_media_items))

    async def ensure_cover_media(self, album: Album) -> None:
        if album.cover_media_id is not None:
            return
        first_id = await AlbumRepository(self._db).get_first_media_id(album.id)
        if first_id:
            album.cover_media_id = first_id
            await self._db.commit()
            logger.info("Assigned album cover album_id=%s media_id=%s", album.id, first_id)

    async def _build_album_reads(self, albums, user):
        repo = AlbumRepository(self._db)
        ids = [album.id for album in albums]
        counts = await self._count_media_for_albums(ids)
        previews = await repo.get_album_preview_media_ids(ids)
        return [
            AlbumRead(
                id=a.id,
                name=a.name,
                description=a.description,
                cover_media_id=a.cover_media_id,
                preview_media=[AlbumPreviewMedia(id=m) for m in previews.get(a.id, [])],
                media_count=counts.get(a.id, 0),
                version=a.version,
                created_at=a.created_at,
                updated_at=a.updated_at,
            )
            for a in albums
        ]

    async def _count_media_for_albums(self, album_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
        if not album_ids:
            return {}

        rows = (
            await self._db.execute(
                select(AlbumMedia.album_id, func.count(AlbumMedia.media_id))
                .where(AlbumMedia.album_id.in_(album_ids))
                .group_by(AlbumMedia.album_id)
            )
        ).all()
        return {album_id: count for album_id, count in rows}
