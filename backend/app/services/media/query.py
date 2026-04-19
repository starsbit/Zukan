from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Select, and_, desc, extract, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.app.errors.albums import album_not_found
from backend.app.errors.error import AppError
from backend.app.errors.media import media_not_found, nsfw_disabled, nsfw_hidden, sensitive_disabled
from backend.app.models.albums import Album, AlbumMedia, AlbumShare
from backend.app.models.auth import User
from backend.app.models.media import Media, MediaTag, MediaVisibility
from backend.app.models.tags import Tag
from backend.app.models.media_interactions import UserFavorite
from backend.app.models.processing import BatchType, ImportBatch, ImportBatchItem, ItemStatus
from backend.app.repositories import media_filters
from backend.app.repositories.media import MediaRepository
from backend.app.repositories.media_interactions import UserFavoriteRepository
from backend.app.repositories.relations import MediaEntityRepository, MediaExternalRefRepository
from backend.app.schemas import (
    CATEGORY_NAMES,
    EntityRead,
    ExternalRefRead,
    MediaCursorPage,
    MediaDetail,
    MediaListState,
    MediaMetadataFilter,
    MediaTimeline,
    MetadataListScope,
    NsfwFilter,
    SensitiveFilter,
    TagFilterMode,
    TagWithConfidence,
    TimelineBucket,
)
from backend.app.utils.media_common import parse_csv_values
from backend.app.utils.media_projections import build_media_read, enrich_media
from backend.app.utils.pagination import (
    apply_cursor_where,
    captured_timestamp_expr,
    decode_cursor,
    encode_cursor,
)


class MediaQueryService:
    SORT_FIELDS: dict[str, Any] = {
        "captured_at": captured_timestamp_expr(),
        "uploaded_at": Media.uploaded_at,
        "filename": Media.filename,
        "file_size": Media.file_size,
    }

    def __init__(self, db: AsyncSession) -> None:
        self._db = db
        self._media_repo = MediaRepository(db)
        self._favorite_repo = UserFavoriteRepository(db)
        self._entity_repo = MediaEntityRepository(db)
        self._external_ref_repo = MediaExternalRefRepository(db)

    async def get_owned_or_admin_media(
        self,
        media_id: uuid.UUID,
        user: User,
        trashed: bool | None,
    ) -> Media:
        media = await self._media_repo.get_by_id(media_id)
        media = self._filter_by_trashed_state(media, trashed)

        if media is None:
            detail = "Not found in trash" if trashed is True else "Not found"
            raise AppError(status_code=404, code=media_not_found, detail=detail)

        if not self._can_manage_media(media, user):
            raise AppError(status_code=403, code=media_not_found, detail="Forbidden")

        return media

    async def get_active_media(self, media_id: uuid.UUID) -> Media:
        media = await self._media_repo.get_by_id(media_id)
        if media is None or media.deleted_at is not None:
            raise AppError(status_code=404, code=media_not_found, detail="Not found")
        return media

    async def get_favoritable_media(self, media_id: uuid.UUID, user: User) -> Media:
        media = await self.get_active_media(media_id)
        if not await self._media_repo.is_accessible(media.id, user):
            raise AppError(status_code=404, code=media_not_found, detail="Not found")
        return media

    async def get_media_by_id(self, media_id: uuid.UUID) -> Media | None:
        return await self._media_repo.get_by_id(media_id)

    async def get_media_by_sha256(self, sha256: str, uploader_id: uuid.UUID) -> Media | None:
        return await self._media_repo.get_by_sha256(sha256, uploader_id=uploader_id)

    async def get_media_by_ids(self, media_ids: list[uuid.UUID]) -> list[Media]:
        return await self._media_repo.get_by_ids(media_ids)

    async def get_media_with_relations(
        self,
        media_id: uuid.UUID,
        *,
        deleted: bool | None,
    ) -> Media | None:
        return await self._media_repo.get_by_id_with_relations(media_id, deleted=deleted)

    async def get_expired_trash(self, cutoff: datetime) -> list[Media]:
        return await self._media_repo.get_expired_trash(cutoff)

    async def list_trashed_media_for_user(self, user: User) -> list[Media]:
        stmt = select(Media).where(Media.deleted_at.is_not(None))
        if not user.is_admin:
            stmt = stmt.where(Media.uploader_id == user.id)
        return (await self._db.execute(stmt)).scalars().all()

    async def get_active_media_ids(self, media_ids: list[uuid.UUID]) -> set[uuid.UUID]:
        return await self._media_repo.get_active_ids(media_ids)

    async def get_favoritable_media_ids(self, media_ids: list[uuid.UUID], user: User) -> set[uuid.UUID]:
        return await self._media_repo.get_accessible_active_ids(user, media_ids)

    async def get_favorite(self, media_id: uuid.UUID, user_id: uuid.UUID) -> UserFavorite | None:
        return await self._favorite_repo.get(media_id, user_id)

    async def get_existing_favorites(
        self,
        user_id: uuid.UUID,
        media_ids: list[uuid.UUID],
    ) -> list[UserFavorite]:
        return await self._favorite_repo.get_by_user_and_media_ids(user_id, media_ids)

    async def get_media_entities(self, media_id: uuid.UUID):
        return await self._entity_repo.get_by_media(media_id)

    async def get_media_external_refs(self, media_id: uuid.UUID):
        return await self._external_ref_repo.get_by_media(media_id)

    async def get_upload_batch_item_for_media(self, media_id: uuid.UUID) -> ImportBatchItem | None:
        stmt = (
            select(ImportBatchItem)
            .join(ImportBatch, ImportBatch.id == ImportBatchItem.batch_id)
            .where(
                ImportBatch.type == BatchType.upload,
                ImportBatchItem.media_id == media_id,
                ImportBatchItem.status.in_([ItemStatus.pending, ItemStatus.processing]),
            )
            .order_by(ImportBatch.created_at.desc(), ImportBatchItem.updated_at.desc())
            .limit(1)
        )
        return (await self._db.execute(stmt)).scalar_one_or_none()

    async def get_import_batch(self, batch_id: uuid.UUID) -> ImportBatch | None:
        return await self._db.get(ImportBatch, batch_id)

    async def get_import_batch_statuses(self, batch_id: uuid.UUID) -> list[ItemStatus]:
        stmt = select(ImportBatchItem.status).where(ImportBatchItem.batch_id == batch_id)
        return (await self._db.execute(stmt)).scalars().all()

    async def get_visible_media(self, media_id: uuid.UUID, user: User) -> Media:
        media = await self._media_repo.get_by_id(media_id)
        if media is None:
            raise AppError(status_code=404, code=media_not_found, detail="Not found")

        await self._assert_media_visible_to_user(media, user)
        return media

    async def get_media_detail(self, media_id: uuid.UUID, user: User) -> MediaDetail:
        media = await self._media_repo.get_by_id_with_relations(media_id, deleted=False)
        if media is None:
            raise AppError(status_code=404, code=media_not_found, detail="Not found")

        await self._assert_media_visible_to_user(media, user)
        return await self.build_media_detail(media, user.id)

    async def build_media_detail(self, media: Media, user_id: uuid.UUID) -> MediaDetail:
        is_favorited = await self._favorite_repo.get(media.id, user_id) is not None
        counts = await self._favorite_repo.get_favorite_counts([media.id])
        favorite_count = counts.get(media.id, 0)

        tag_details = [
            TagWithConfidence(
                name=item.tag.name,
                category=item.tag.category,
                category_name=CATEGORY_NAMES.get(item.tag.category, "unknown"),
                category_key=CATEGORY_NAMES.get(item.tag.category, "unknown"),
                confidence=item.confidence,
            )
            for item in sorted(media.media_tags, key=lambda item: item.confidence, reverse=True)
        ]

        external_refs = [
            ExternalRefRead(
                id=ref.id,
                provider=ref.provider,
                external_id=ref.external_id,
                url=ref.url,
            )
            for ref in media.external_refs
        ]

        entities = [
            EntityRead(
                id=entity.id,
                entity_type=entity.entity_type,
                entity_id=entity.entity_id,
                name=entity.name,
                role=entity.role,
                source=entity.source,
                confidence=entity.confidence,
            )
            for entity in media.entities
        ]

        base = build_media_read(media, is_favorited, favorite_count)
        return MediaDetail(
            **base.model_dump(),
            tag_details=tag_details,
            external_refs=external_refs,
            entities=entities,
        )

    async def list_media(
        self,
        user: User,
        state: MediaListState,
        tags: list[str] | None,
        character_name: str | None,
        series_name: str | None,
        owner_username: str | None,
        uploader_username: str | None,
        exclude_tags: list[str] | None,
        mode: TagFilterMode,
        nsfw: NsfwFilter,
        sensitive: SensitiveFilter,
        status_filter: str | None,
        metadata: MediaMetadataFilter,
        favorited: bool | None,
        visibility: MediaVisibility | None = None,
        media_type: list[str] | None = None,
        album_id: uuid.UUID | None = None,
        after: str | None = None,
        page_size: int = 20,
        sort_by: str = "captured_at",
        sort_order: str = "desc",
        ocr_text: str | None = None,
        include_total: bool = True,
    ) -> MediaCursorPage:
        stmt = self._build_base_list_stmt()

        stmt = await self._apply_album_filter(stmt, user, album_id)
        stmt = self._apply_state_and_visibility_filters(stmt, user, state, nsfw, sensitive)
        stmt = self._apply_status_filter(stmt, status_filter)
        stmt = self._apply_favorited_filter(stmt, user, favorited)
        stmt = self._apply_visibility_scope(stmt, user, state, visibility, album_id is not None, favorited)

        stmt = media_filters.apply_tag_filters(stmt, tags, exclude_tags, mode)
        stmt = media_filters.apply_character_name_filter(stmt, character_name)
        stmt = media_filters.apply_series_name_filter(stmt, series_name)
        stmt = media_filters.apply_owner_username_filter(stmt, owner_username)
        stmt = media_filters.apply_uploader_username_filter(stmt, uploader_username)
        stmt = media_filters.apply_visibility_filter(stmt, visibility)
        stmt = media_filters.apply_media_type_filters(stmt, media_type)
        stmt = media_filters.apply_captured_at_filters(stmt, metadata)
        stmt = media_filters.apply_uploaded_at_filters(stmt, metadata)
        stmt = media_filters.apply_ocr_text_filter(stmt, ocr_text)

        total = await self._count_total(stmt, include_total)
        stmt = self._apply_cursor(stmt, after, sort_by, sort_order)

        rows = await self._fetch_page_rows(stmt, page_size, sort_by, sort_order)
        has_more = len(rows) > page_size
        rows = rows[:page_size]

        media_ids = [row.id for row in rows]
        favorite_ids = await self._favorite_repo.get_favorited_ids(user.id, media_ids)
        favorite_counts = await self._favorite_repo.get_favorite_counts(media_ids)
        tag_names_map = await self._fetch_tag_names(media_ids)
        next_cursor = self._build_next_cursor(rows, has_more, sort_by)

        return MediaCursorPage(
            total=total,
            next_cursor=next_cursor,
            has_more=has_more,
            page_size=page_size,
            items=enrich_media(rows, favorite_ids, favorite_counts, tag_names_map),
        )

    async def get_timeline(
        self,
        user: User,
        *,
        state: MediaListState = MediaListState.ACTIVE,
        tags: list[str] | None = None,
        character_name: str | None = None,
        series_name: str | None = None,
        owner_username: str | None = None,
        uploader_username: str | None = None,
        exclude_tags: list[str] | None = None,
        mode: TagFilterMode = TagFilterMode.AND,
        nsfw: NsfwFilter = NsfwFilter.DEFAULT,
        sensitive: SensitiveFilter = SensitiveFilter.DEFAULT,
        status_filter: str | None = None,
        favorited: bool | None = None,
        visibility: MediaVisibility | None = None,
        media_type: list[str] | None = None,
        album_id: uuid.UUID | None = None,
        ocr_text: str | None = None,
    ) -> MediaTimeline:
        captured_at = media_filters.captured_timestamp_expr()
        stmt = (
            select(
                extract("year", captured_at).label("year"),
                extract("month", captured_at).label("month"),
                func.count(Media.id).label("count"),
            )
        )

        stmt = await self._apply_album_filter_for_count(stmt, user, album_id)
        stmt = self._apply_state_and_visibility_filters_for_count(stmt, user, state, nsfw, sensitive)
        stmt = self._apply_status_filter(stmt, status_filter)
        stmt = self._apply_favorited_filter_for_count(stmt, user, favorited)
        stmt = self._apply_visibility_scope(stmt, user, state, visibility, album_id is not None, favorited)

        stmt = media_filters.apply_tag_filters(stmt, tags, exclude_tags, mode)
        stmt = media_filters.apply_character_name_filter(stmt, character_name)
        stmt = media_filters.apply_series_name_filter(stmt, series_name)
        stmt = media_filters.apply_owner_username_filter(stmt, owner_username)
        stmt = media_filters.apply_uploader_username_filter(stmt, uploader_username)
        stmt = media_filters.apply_visibility_filter(stmt, visibility)
        stmt = media_filters.apply_media_type_filters(stmt, media_type)
        stmt = media_filters.apply_ocr_text_filter(stmt, ocr_text)

        stmt = stmt.group_by("year", "month").order_by(desc("year"), desc("month"))
        rows = (await self._db.execute(stmt)).all()
        return MediaTimeline(
            buckets=[TimelineBucket(year=int(r.year), month=int(r.month), count=r.count) for r in rows]
        )

    async def _apply_album_filter_for_count(self, stmt, user: User, album_id: uuid.UUID | None):
        if album_id is None:
            return stmt
        await self._ensure_album_is_visible(user, album_id)
        return stmt.join(AlbumMedia, AlbumMedia.media_id == Media.id).where(
            AlbumMedia.album_id == album_id,
        )

    def _apply_state_and_visibility_filters_for_count(
        self,
        stmt,
        user: User,
        state: MediaListState,
        nsfw: NsfwFilter,
        sensitive: SensitiveFilter,
    ):
        if state == MediaListState.TRASHED:
            stmt = stmt.where(Media.deleted_at.is_not(None))
            if not user.is_admin:
                stmt = stmt.where(Media.uploader_id == user.id)
            return stmt
        stmt = stmt.where(Media.deleted_at.is_(None))
        stmt = media_filters.apply_nsfw_list_filter(stmt, user, nsfw)
        return media_filters.apply_sensitive_list_filter(stmt, user, sensitive)

    def _apply_favorited_filter_for_count(self, stmt, user: User, favorited: bool | None):
        if favorited is True:
            stmt = stmt.join(
                UserFavorite,
                and_(UserFavorite.media_id == Media.id, UserFavorite.user_id == user.id),
            )
        return stmt

    async def list_character_suggestions(
        self,
        user: User,
        *,
        q: str,
        limit: int,
        scope: MetadataListScope = MetadataListScope.ACCESSIBLE,
    ) -> list[dict[str, int | str]]:
        query = q.strip()
        if not query:
            return []

        return await self._entity_repo.list_character_suggestions(
            user=user,
            query=query,
            limit=limit,
            scope=scope,
        )

    async def list_series_suggestions(
        self,
        user: User,
        *,
        q: str,
        limit: int,
        scope: MetadataListScope = MetadataListScope.ACCESSIBLE,
    ) -> list[dict[str, int | str]]:
        query = q.strip()
        if not query:
            return []

        return await self._entity_repo.list_series_suggestions(
            user=user,
            query=query,
            limit=limit,
            scope=scope,
        )

    async def get_downloadable_media(self, user: User, media_ids: list[uuid.UUID]) -> list[Media]:
        rows = await self._media_repo.get_by_ids(media_ids)
        rows = [row for row in rows if row.deleted_at is None]

        if not user.is_admin:
            rows = [row for row in rows if self._can_manage_media(row, user)]

        if not rows:
            raise AppError(status_code=404, code=media_not_found, detail="No accessible media found")

        return rows

    async def _ensure_album_is_visible(self, user: User, album_id: uuid.UUID) -> None:
        album = (await self._db.execute(select(Album).where(Album.id == album_id))).scalar_one_or_none()
        if album is None:
            raise AppError(status_code=404, code=album_not_found, detail="Album not found")

        if album.owner_id == user.id or user.is_admin:
            return

        share = (
            await self._db.execute(
                select(AlbumShare).where(
                    AlbumShare.album_id == album_id,
                    AlbumShare.user_id == user.id,
                )
            )
        ).scalar_one_or_none()

        if share is None:
            raise AppError(status_code=404, code=album_not_found, detail="Album not found")

    def _build_base_list_stmt(self) -> Select[tuple[Media]]:
        return select(Media).options(
            selectinload(Media.uploader),
            selectinload(Media.owner),
        )

    async def _fetch_tag_names(self, media_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[str]]:
        if not media_ids:
            return {}
        stmt = (
            select(MediaTag.media_id, func.array_agg(Tag.name).label("tag_names"))
            .join(Tag, Tag.id == MediaTag.tag_id)
            .where(MediaTag.media_id.in_(media_ids))
            .group_by(MediaTag.media_id)
        )
        rows = (await self._db.execute(stmt)).all()
        return {row.media_id: sorted(row.tag_names) for row in rows}

    async def _apply_album_filter(
        self,
        stmt: Select[tuple[Media]],
        user: User,
        album_id: uuid.UUID | None,
    ) -> Select[tuple[Media]]:
        if album_id is None:
            return stmt

        await self._ensure_album_is_visible(user, album_id)
        return stmt.join(AlbumMedia, AlbumMedia.media_id == Media.id).where(
            AlbumMedia.album_id == album_id,
        )

    def _apply_state_and_visibility_filters(
        self,
        stmt: Select[tuple[Media]],
        user: User,
        state: MediaListState,
        nsfw: NsfwFilter,
        sensitive: SensitiveFilter,
    ) -> Select[tuple[Media]]:
        if state == MediaListState.TRASHED:
            stmt = stmt.where(Media.deleted_at.is_not(None))
            if not user.is_admin:
                stmt = stmt.where(Media.uploader_id == user.id)
            return stmt

        stmt = stmt.where(Media.deleted_at.is_(None))
        if nsfw == NsfwFilter.ONLY and not user.show_nsfw and not user.is_admin:
            raise AppError(
                status_code=403,
                code=nsfw_disabled,
                detail="Enable NSFW in your profile first",
            )
        if sensitive == SensitiveFilter.ONLY and not user.show_sensitive and not user.is_admin:
            raise AppError(
                status_code=403,
                code=sensitive_disabled,
                detail="Enable sensitive content in your profile first",
            )

        stmt = media_filters.apply_nsfw_list_filter(stmt, user, nsfw)
        return media_filters.apply_sensitive_list_filter(stmt, user, sensitive)

    def _apply_visibility_scope(
        self,
        stmt: Select[tuple[Media]],
        user: User,
        state: MediaListState,
        visibility: MediaVisibility | None,
        album_scoped: bool,
        favorited: bool | None = None,
    ) -> Select[tuple[Media]]:
        if state == MediaListState.TRASHED:
            return stmt
        if album_scoped:
            return stmt.where(
                or_(
                    Media.uploader_id == user.id,
                    Media.owner_id == user.id,
                    self._media_repo.external_visibility_ready_clause(),
                )
            )
        if visibility == MediaVisibility.public:
            return stmt.where(
                Media.visibility == MediaVisibility.public,
                or_(
                    Media.uploader_id == user.id,
                    Media.owner_id == user.id,
                    self._media_repo.external_visibility_ready_clause(),
                ),
            )
        if favorited is True:
            return stmt.where(self._media_repo.accessible_to_user_clause(user))
        return stmt.where(Media.uploader_id == user.id)

    def _apply_status_filter(
        self,
        stmt: Select[tuple[Media]],
        status_filter: str | None,
    ) -> Select[tuple[Media]]:
        status_values = [value for value in parse_csv_values(status_filter) if value != "any"]
        if status_values:
            stmt = stmt.where(Media.tagging_status.in_(status_values))
        return stmt

    def _apply_favorited_filter(
        self,
        stmt: Select[tuple[Media]],
        user: User,
        favorited: bool | None,
    ) -> Select[tuple[Media]]:
        if favorited is True:
            stmt = stmt.join(
                UserFavorite,
                and_(UserFavorite.media_id == Media.id, UserFavorite.user_id == user.id),
            )
        return stmt

    async def _count_total(self, stmt: Select[tuple[Media]], include_total: bool) -> int | None:
        if not include_total:
            return None
        count_stmt = select(func.count()).select_from(stmt.subquery())
        return (await self._db.execute(count_stmt)).scalar_one()

    def _apply_cursor(
        self,
        stmt: Select[tuple[Media]],
        after: str | None,
        sort_by: str,
        sort_order: str,
    ) -> Select[tuple[Media]]:
        if after is None:
            return stmt

        decoded = decode_cursor(after, sort_by)
        if decoded is None:
            return stmt

        cursor_value, cursor_id = decoded
        return apply_cursor_where(stmt, sort_by, sort_order, cursor_value, cursor_id)

    async def _fetch_page_rows(
        self,
        stmt: Select[tuple[Media]],
        page_size: int,
        sort_by: str,
        sort_order: str,
    ) -> list[Media]:
        sort_column = self._get_sort_column(sort_by)
        order_expressions = self._build_order_expressions(sort_column, sort_order)

        result = await self._db.execute(
            stmt.order_by(*order_expressions).limit(page_size + 1),
        )
        return result.scalars().all()

    def _build_next_cursor(
        self,
        rows: list[Media],
        has_more: bool,
        sort_by: str,
    ) -> str | None:
        if not has_more or not rows:
            return None

        last = rows[-1]
        sort_value = (
            last.captured_at or last.uploaded_at
            if sort_by == "captured_at"
            else getattr(last, sort_by)
        )
        return encode_cursor(sort_value, last.id)

    def _get_sort_column(self, sort_by: str) -> Any:
        try:
            return self.SORT_FIELDS[sort_by]
        except KeyError as exc:
            raise ValueError(f"Unsupported sort field: {sort_by}") from exc

    def _build_order_expressions(self, sort_column: Any, sort_order: str) -> list[Any]:
        if sort_order == "asc":
            return [sort_column.asc(), Media.id.asc()]
        return [sort_column.desc(), Media.id.desc()]

    def _filter_by_trashed_state(
        self,
        media: Media | None,
        trashed: bool | None,
    ) -> Media | None:
        if media is None or trashed is None:
            return media
        if trashed is True and media.deleted_at is None:
            return None
        if trashed is False and media.deleted_at is not None:
            return None
        return media

    def _can_manage_media(self, media: Media, user: User) -> bool:
        return media.uploader_id == user.id or media.owner_id == user.id or user.is_admin

    async def _assert_media_visible_to_user(self, media: Media, user: User) -> None:
        if media.deleted_at is not None and not self._can_manage_media(media, user):
            raise AppError(status_code=404, code=media_not_found, detail="Not found")
        if media.deleted_at is None and not await self._media_repo.is_accessible(media.id, user):
            raise AppError(status_code=404, code=media_not_found, detail="Not found")
        self._assert_nsfw_visible(media, user)

    def _assert_nsfw_visible(self, media: Media, user: User) -> None:
        if media.is_nsfw and not user.show_nsfw and not user.is_admin:
            raise AppError(status_code=403, code=nsfw_hidden, detail="NSFW content hidden")

    def _is_media_visible_to_user(self, media: Media, user: User) -> bool:
        return self._can_manage_media(media, user) or (
            media.visibility == MediaVisibility.public
            and media.tagging_status not in ("pending", "processing")
            and media.thumbnail_status not in ("pending", "processing")
            and media.poster_status not in ("pending", "processing")
        )
