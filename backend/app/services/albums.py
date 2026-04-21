from __future__ import annotations

import logging
import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.app.errors.error import AppError
from backend.app.errors.albums import (
    album_empty,
    album_not_found,
    album_read_only,
    album_share_forbidden,
    media_not_in_album,
    ownership_transfer_forbidden,
    ownership_transfer_invalid_target,
    share_not_found,
    share_self,
)
from backend.app.errors.upload import version_conflict
from backend.app.errors.auth import forbidden
from backend.app.models.albums import Album, AlbumMedia, AlbumShare, AlbumShareInvite, AlbumShareInviteStatus, AlbumShareRole
from backend.app.models.media import Media, MediaTag
from backend.app.models.notifications import Notification, NotificationType
from backend.app.repositories.albums import AlbumRepository
from backend.app.repositories.auth import UserRepository
from backend.app.repositories import media_filters
from backend.app.repositories.media import MediaRepository
from backend.app.repositories.media_interactions import UserFavoriteRepository
from backend.app.schemas import (
    AlbumAccessListResponse,
    AlbumAccessRole,
    AlbumListResponse,
    AlbumOwnershipTransferRequest,
    AlbumOwnerSummary,
    AlbumPreviewMedia,
    AlbumRead,
    AlbumShareCreate,
    AlbumUpdate,
    BulkResult,
    MediaCursorPage,
    TagFilterMode,
)
from backend.app.utils.media_classification import effective_nsfw_expr, effective_sensitive_expr
from backend.app.utils.media_projections import enrich_media
from backend.app.utils.pagination import apply_cursor_where_expr, decode_cursor_typed, encode_cursor

logger = logging.getLogger(__name__)


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

    async def album_read(self, album: Album, user) -> AlbumRead:
        reads = await self._build_album_reads([album], user)
        return reads[0]

    async def create_album(self, user, name: str, description: str | None) -> AlbumRead:
        album = Album(owner_id=user.id, name=name, description=description)
        self._db.add(album)
        await self._db.commit()
        await self._db.refresh(album)
        logger.info("Created album album_id=%s owner_id=%s name=%s", album.id, user.id, album.name)
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
        if user.is_admin:
            stmt = select(Album)
            total = (await self._db.execute(select(func.count()).select_from(Album))).scalar_one()
        else:
            stmt = albums_repo.accessible_stmt(user.id)
            total = await albums_repo.count_accessible(user.id)

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

        album_list = (await self._db.execute(stmt.order_by(*order_exprs).limit(page_size + 1))).scalars().all()
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
        if album.owner_id != user.id and not user.is_admin:
            raise AppError(status_code=403, code=forbidden, detail="Forbidden")
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
        if not user.is_admin:
            stmt = stmt.where(
                or_(
                    Media.uploader_id == user.id,
                    Media.owner_id == user.id,
                    media_repo.external_visibility_ready_clause(),
                )
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
                    | ((AlbumMedia.position == cursor_pos) & (Media.id > cursor_id))
                )

        total = (await self._db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()

        rows_with_pos = (
            await self._db.execute(stmt.order_by(AlbumMedia.position.asc(), Media.id.asc()).limit(page_size + 1))
        ).all()
        has_more = len(rows_with_pos) > page_size
        rows_with_pos = rows_with_pos[:page_size]

        rows = [row[0] for row in rows_with_pos]
        favorites = await UserFavoriteRepository(self._db).get_favorited_ids(user.id, [row.id for row in rows])

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

    async def transfer_album_ownership(self, album_id: uuid.UUID, body: AlbumOwnershipTransferRequest, user) -> AlbumRead:
        albums_repo = AlbumRepository(self._db)
        album = await self.get_album(album_id)
        if album.owner_id != user.id and not user.is_admin:
            raise AppError(
                status_code=403,
                code=ownership_transfer_forbidden,
                detail="Only the owner can transfer ownership",
            )

        if body.new_owner_user_id == album.owner_id:
            raise AppError(
                status_code=422,
                code=ownership_transfer_invalid_target,
                detail="New owner must be different from current owner",
            )

        incoming_share = await albums_repo.get_share(album_id, body.new_owner_user_id)
        if incoming_share is None or incoming_share.role != AlbumShareRole.editor:
            raise AppError(
                status_code=422,
                code=ownership_transfer_invalid_target,
                detail="New owner must already have editor access",
            )

        previous_owner_id = album.owner_id
        album.owner_id = body.new_owner_user_id

        # Target owner no longer needs an explicit share row after transfer.
        await self._db.delete(incoming_share)

        previous_share = await albums_repo.get_share(album_id, previous_owner_id)
        if body.keep_editor_access:
            if previous_share is None:
                self._db.add(
                    AlbumShare(
                        album_id=album_id,
                        user_id=previous_owner_id,
                        role=AlbumShareRole.editor,
                        shared_by_user_id=body.new_owner_user_id,
                    )
                )
            else:
                previous_share.role = AlbumShareRole.editor
                previous_share.shared_by_user_id = body.new_owner_user_id
        elif previous_share is not None:
            await self._db.delete(previous_share)

        await self._db.commit()
        await self._db.refresh(album)
        logger.info(
            "Transferred album ownership album_id=%s previous_owner_id=%s new_owner_id=%s keep_editor_access=%s",
            album_id,
            previous_owner_id,
            body.new_owner_user_id,
            body.keep_editor_access,
        )
        return await self.album_read(album, user)

    async def list_album_access(self, album_id: uuid.UUID, user) -> AlbumAccessListResponse:
        albums_repo = AlbumRepository(self._db)
        album = await self.get_album_for_user(album_id, user)
        if album.owner_id != user.id and not user.is_admin:
            raise AppError(status_code=403, code=album_share_forbidden, detail="Only the owner can manage shares")

        owner_map = await albums_repo.get_owner_summaries([album.owner_id])
        owner = owner_map.get(album.owner_id)
        owner_summary = {
            "id": album.owner_id,
            "username": owner.username if owner is not None else "Unknown",
        }

        shares = await albums_repo.get_shares_for_album(album_id)
        pending_invites = await albums_repo.get_pending_invites_for_album(album_id)

        access_user_ids = [share.user_id for share in shares] + [invite.user_id for invite in pending_invites]
        actor_user_ids = [
            share.shared_by_user_id for share in shares if share.shared_by_user_id is not None
        ] + [
            invite.invited_by_user_id for invite in pending_invites if invite.invited_by_user_id is not None
        ]
        user_map = await albums_repo.get_owner_summaries(access_user_ids + actor_user_ids)

        accepted_entries = [
            self._album_access_entry_response(
                user_id=share.user_id,
                username=user_map.get(share.user_id).username if user_map.get(share.user_id) is not None else "Unknown",
                role=share.role.value,
                status="accepted",
                shared_at=share.shared_at,
                shared_by_user_id=share.shared_by_user_id,
                shared_by_username=(
                    user_map.get(share.shared_by_user_id).username
                    if share.shared_by_user_id is not None and user_map.get(share.shared_by_user_id) is not None
                    else None
                ),
            )
            for share in shares
        ]
        pending_entries = [
            self._album_access_entry_response(
                user_id=invite.user_id,
                username=user_map.get(invite.user_id).username if user_map.get(invite.user_id) is not None else "Unknown",
                role=invite.role.value,
                status="pending",
                shared_at=invite.invited_at,
                shared_by_user_id=invite.invited_by_user_id,
                shared_by_username=(
                    user_map.get(invite.invited_by_user_id).username
                    if invite.invited_by_user_id is not None and user_map.get(invite.invited_by_user_id) is not None
                    else None
                ),
            )
            for invite in pending_invites
        ]

        entries = sorted(
            [*accepted_entries, *pending_entries],
            key=lambda entry: (
                0 if entry["status"] == "accepted" else 1,
                entry["username"].lower(),
            ),
        )

        return AlbumAccessListResponse(owner=owner_summary, entries=entries)

    async def share_album(self, album_id: uuid.UUID, body: AlbumShareCreate, user) -> tuple[dict, bool]:
        albums_repo = AlbumRepository(self._db)
        album = await self.get_album_for_user(album_id, user)
        if album.owner_id != user.id and not user.is_admin:
            raise AppError(status_code=403, code=album_share_forbidden, detail="Only the owner can manage shares")
        target_user = await UserRepository(self._db).get_by_username(body.username)
        if target_user is None:
            raise AppError(status_code=404, code=album_not_found, detail="User not found")
        if target_user.id == user.id:
            raise AppError(status_code=422, code=share_self, detail="Cannot share with yourself")
        share = await albums_repo.get_share(album_id, target_user.id)
        if share:
            share.role = body.role
            share.shared_by_user_id = user.id
            await self._db.commit()
            await self._db.refresh(share)
            logger.info("Updated album share album_id=%s target_user_id=%s role=%s", album_id, target_user.id, share.role.value)
            return self._share_response(
                user_id=target_user.id,
                role=share.role.value,
                status="accepted",
                shared_at=share.shared_at,
                shared_by_user_id=share.shared_by_user_id,
            ), False

        invite = await albums_repo.get_invite(album_id, target_user.id)
        created = invite is None
        if invite is None:
            invite = AlbumShareInvite(
                album_id=album_id,
                user_id=target_user.id,
                role=body.role,
                invited_by_user_id=user.id,
            )
            self._db.add(invite)
        else:
            invite.role = body.role
            invite.invited_by_user_id = user.id
            invite.status = AlbumShareInviteStatus.pending
            invite.responded_at = None

        await self._db.flush()
        invite.notification_id = await self._upsert_share_invite_notification(
            invite=invite,
            album=album,
            invited_user=target_user,
            invited_by=user,
        )
        await self._db.commit()
        await self._db.refresh(invite)
        logger.info(
            "Created or refreshed album invite album_id=%s target_user_id=%s role=%s created=%s",
            album_id,
            target_user.id,
            invite.role.value,
            created,
        )
        return self._share_response(
            user_id=target_user.id,
            role=invite.role.value,
            status="pending",
            shared_at=invite.invited_at,
            shared_by_user_id=invite.invited_by_user_id,
        ), created

    async def revoke_share(self, album_id: uuid.UUID, shared_user_id: uuid.UUID, user) -> None:
        albums_repo = AlbumRepository(self._db)
        album = await self.get_album_for_user(album_id, user)
        if album.owner_id != user.id and not user.is_admin:
            raise AppError(status_code=403, code=album_share_forbidden, detail="Only the owner can manage shares")
        share = await albums_repo.get_share(album_id, shared_user_id)
        if share is not None:
            await self._db.delete(share)
            await self._db.commit()
            logger.info("Revoked accepted album share album_id=%s target_user_id=%s", album_id, shared_user_id)
            return

        invite = await albums_repo.get_invite(album_id, shared_user_id)
        if invite is None:
            raise AppError(status_code=404, code=share_not_found, detail="Share not found")
        notification = None
        if invite.notification_id is not None:
            notification = await self._db.get(Notification, invite.notification_id)
        if notification is not None:
            await self._db.delete(notification)
        await self._db.delete(invite)
        await self._db.commit()
        logger.info("Revoked pending album invite album_id=%s target_user_id=%s", album_id, shared_user_id)

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

    async def _build_album_reads(self, albums: list[Album], user) -> list[AlbumRead]:
        if not albums:
            return []

        repo = AlbumRepository(self._db)
        album_ids = [album.id for album in albums]
        owner_ids = list({album.owner_id for album in albums})
        counts = await self._count_media_for_albums(album_ids)
        owners = await repo.get_owner_summaries(owner_ids)
        previews = await repo.get_album_preview_media_ids(album_ids)
        shares = await repo.get_shares_for_user(user.id, album_ids)
        share_roles = {share.album_id: share.role for share in shares}

        reads: list[AlbumRead] = []
        for album in albums:
            access_role = AlbumAccessRole.owner if album.owner_id == user.id else AlbumAccessRole(
                share_roles.get(album.id, AlbumShareRole.viewer).value,
            )
            owner = owners.get(album.owner_id)
            reads.append(AlbumRead(
                id=album.id,
                owner_id=album.owner_id,
                owner=AlbumOwnerSummary(
                    id=album.owner_id,
                    username=owner.username if owner is not None else "Unknown",
                ),
                access_role=access_role,
                name=album.name,
                description=album.description,
                cover_media_id=album.cover_media_id,
                preview_media=[
                    AlbumPreviewMedia(id=media_id)
                    for media_id in previews.get(album.id, [])
                ],
                media_count=counts.get(album.id, 0),
                version=album.version,
                created_at=album.created_at,
                updated_at=album.updated_at,
            ))

        return reads

    async def _upsert_share_invite_notification(self, invite: AlbumShareInvite, album: Album, invited_user, invited_by) -> uuid.UUID:
        notification = None
        if invite.notification_id is not None:
            notification = await self._db.get(Notification, invite.notification_id)

        if notification is None:
            notification = Notification(
                user_id=invited_user.id,
                type=NotificationType.share_invite,
                title="Album invite",
                body="",
                is_read=False,
            )
            self._db.add(notification)
            await self._db.flush()

        notification.title = f"{invited_by.username} invited you to {album.name}"
        notification.body = f"Accept to join as {invite.role.value}."
        notification.is_read = False
        notification.link_url = f"/album/{album.id}"
        notification.data = {
            "album_id": str(album.id),
            "album_name": album.name,
            "role": invite.role.value,
            "invited_by_user_id": str(invited_by.id),
            "invited_by_username": invited_by.username,
            "invite_status": AlbumShareInviteStatus.pending.value,
            "invite_id": str(invite.id),
        }
        return notification.id

    def _share_response(self, *, user_id: uuid.UUID, role: str, status: str, shared_at, shared_by_user_id: uuid.UUID | None) -> dict:
        return {
            "user_id": user_id,
            "role": role,
            "status": status,
            "shared_at": shared_at,
            "shared_by_user_id": shared_by_user_id,
        }

    def _album_access_entry_response(
        self,
        *,
        user_id: uuid.UUID,
        username: str,
        role: str,
        status: str,
        shared_at,
        shared_by_user_id: uuid.UUID | None,
        shared_by_username: str | None,
    ) -> dict:
        return {
            "user_id": user_id,
            "username": username,
            "role": role,
            "status": status,
            "shared_at": shared_at,
            "shared_by_user_id": shared_by_user_id,
            "shared_by_username": shared_by_username,
        }

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
