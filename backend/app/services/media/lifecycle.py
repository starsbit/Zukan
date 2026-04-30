from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models.auth import User
from backend.app.models.collection import UserCollectionItem
from backend.app.models.gacha import GachaCurrencyLedger, GachaCurrencyLedgerReason
from backend.app.models.media import Media
from backend.app.models.notifications import Notification, NotificationType
from backend.app.models.trade import TradeStatus
from backend.app.repositories.collection import CollectionRepository
from backend.app.repositories.gacha import GachaRepository
from backend.app.repositories.media import MediaRepository
from backend.app.repositories.trade import TradeRepository
from backend.app.schemas import BulkResult, MediaIdsRequest
from backend.app.services.collection import collection_item_pull_value
from backend.app.services.media.query import MediaQueryService

TRASH_RETENTION_DAYS = 30
logger = logging.getLogger(__name__)


class MediaLifecycleService:
    def __init__(self, db: AsyncSession, query: MediaQueryService) -> None:
        self._db = db
        self._query = query

    async def purge_expired_trash(self, now: datetime | None = None) -> int:
        cutoff = (now or datetime.now(timezone.utc)) - timedelta(days=TRASH_RETENTION_DAYS)
        expired = await self._query.get_expired_trash(cutoff)
        logger.info("Purging expired trash candidates count=%s cutoff=%s", len(expired), cutoff.isoformat())
        for media in expired:
            await self.purge_media_record(media)
        if expired:
            await self._db.commit()
        return len(expired)

    async def purge_media_record(self, media: Media) -> None:
        from backend.app.utils.storage import delete_media_files

        await self._reimburse_collection_items_for_media(media)
        await MediaRepository(self._db).delete(media)
        delete_media_files(media.filepath, media.poster_path, media.thumbnail_path)
        logger.info("Purged media record media_id=%s", media.id)

    async def soft_delete_media(self, media_id: uuid.UUID, user: User) -> None:
        media = await self._query.get_owned_or_admin_media(media_id, user, trashed=False)
        media.deleted_at = datetime.now(timezone.utc)
        await self._db.commit()
        logger.info("Soft deleted media user_id=%s media_id=%s", user.id, media_id)

    async def restore_media(self, media_id: uuid.UUID, user: User) -> None:
        media = await self._query.get_owned_or_admin_media(media_id, user, trashed=True)
        media.deleted_at = None
        await self._db.commit()
        logger.info("Restored media user_id=%s media_id=%s", user.id, media_id)

    async def purge_media(self, media_id: uuid.UUID, user: User) -> None:
        media = await self._query.get_owned_or_admin_media(media_id, user, trashed=None)
        await self.purge_media_record(media)
        await self._db.commit()
        logger.info("Permanently deleted media user_id=%s media_id=%s", user.id, media_id)

    async def empty_trash(self, user: User) -> None:
        trashed_media = await self._query.list_trashed_media_for_user(user)
        for media in trashed_media:
            await self.purge_media_record(media)
        await self._db.commit()
        logger.info("Emptied trash user_id=%s purged=%s", user.id, len(trashed_media))

    async def batch_delete_media(self, payload: MediaIdsRequest, user: User) -> BulkResult:
        processed, skipped = await self._batch_update_deleted_state(payload.media_ids, True, user)
        return BulkResult(processed=processed, skipped=skipped)

    async def bulk_delete_media(self, media_ids: list[uuid.UUID], user: User) -> BulkResult:
        processed, skipped = await self._batch_update_deleted_state(media_ids, True, user)
        return BulkResult(processed=processed, skipped=skipped)

    async def bulk_restore_media(self, media_ids: list[uuid.UUID], user: User) -> BulkResult:
        processed, skipped = await self._batch_update_deleted_state(media_ids, False, user)
        return BulkResult(processed=processed, skipped=skipped)

    async def bulk_purge_media(self, media_ids: list[uuid.UUID], user: User) -> BulkResult:
        rows = await self._query.get_media_by_ids(media_ids)
        found_ids = {row.id for row in rows}
        skipped = len(media_ids) - len(found_ids)
        processed = 0
        for media in rows:
            if media.uploader_id == user.id or user.is_admin:
                await self.purge_media_record(media)
                processed += 1
            else:
                skipped += 1
        await self._db.commit()
        logger.info("Bulk purged media user_id=%s processed=%s skipped=%s", user.id, processed, skipped)
        return BulkResult(processed=processed, skipped=skipped)

    async def batch_purge_media(self, payload: MediaIdsRequest, user: User) -> BulkResult:
        rows = await self._query.get_media_by_ids(payload.media_ids)
        found_ids = {row.id for row in rows}
        skipped = len(payload.media_ids) - len(found_ids)
        processed = 0
        for media in rows:
            if media.uploader_id == user.id or user.is_admin:
                await self.purge_media_record(media)
                processed += 1
            else:
                skipped += 1
        await self._db.commit()
        logger.info("Batch purged media user_id=%s processed=%s skipped=%s", user.id, processed, skipped)
        return BulkResult(processed=processed, skipped=skipped)

    async def _batch_update_deleted_state(self, media_ids: list[uuid.UUID], deleted: bool, user: User) -> tuple[int, int]:
        rows = await self._query.get_media_by_ids(media_ids)
        found_ids = {row.id for row in rows}
        skipped = len(media_ids) - len(found_ids)
        processed = 0
        now = datetime.now(timezone.utc)
        for media in rows:
            if media.uploader_id != user.id and not user.is_admin:
                skipped += 1
                continue
            if deleted and media.deleted_at is None:
                media.deleted_at = now
                processed += 1
            elif not deleted and media.deleted_at is not None:
                media.deleted_at = None
                processed += 1
            else:
                skipped += 1
        await self._db.commit()
        logger.info(
            "Bulk deleted-state update user_id=%s deleted=%s processed=%s skipped=%s",
            user.id,
            deleted,
            processed,
            skipped,
        )
        return processed, skipped

    async def _reimburse_collection_items_for_media(self, media: Media) -> None:
        collection_items = await CollectionRepository(self._db).list_items_by_media_id(media.id)
        if not collection_items:
            return

        await self._cancel_pending_trades_for_collection_items(collection_items)
        for item in collection_items:
            pulls_awarded = collection_item_pull_value(item) * item.copies_pulled
            balance = await GachaRepository(self._db).get_or_create_balance(item.user_id, lock=True)
            balance.balance += pulls_awarded
            balance.total_claimed += pulls_awarded
            self._db.add(
                GachaCurrencyLedger(
                    user_id=item.user_id,
                    amount=pulls_awarded,
                    balance_after=balance.balance,
                    reason=GachaCurrencyLedgerReason.media_removed_reimbursement,
                    ledger_metadata={
                        "collection_item_id": str(item.id),
                        "media_id": str(item.media_id),
                        "rarity_tier": item.rarity_tier_at_acquisition.value,
                        "level": item.level,
                        "copies_removed": item.copies_pulled,
                    },
                )
            )
            self._db.add(
                Notification(
                    user_id=item.user_id,
                    type=NotificationType.app_update,
                    title="A gacha card left your collection",
                    body=f"Media was permanently deleted, so its gacha card was removed. You received {pulls_awarded} Pulls.",
                    is_read=False,
                    data={
                        "kind": "gacha_media_removed",
                        "media_id": str(item.media_id),
                        "collection_item_id": str(item.id),
                        "pulls_awarded": pulls_awarded,
                        "copies_removed": item.copies_pulled,
                    },
                )
            )
            await self._db.delete(item)

    async def _cancel_pending_trades_for_collection_items(self, collection_items: list[UserCollectionItem]) -> None:
        item_ids = [item.id for item in collection_items]
        trades = await TradeRepository(self._db).pending_trades_for_item_ids(item_ids)
        affected_ids = {str(item_id) for item_id in item_ids}
        for trade in trades:
            trade.status = TradeStatus.cancelled
            payload = {
                "trade_id": str(trade.id),
                "kind": NotificationType.trade_cancelled.value,
                "reason": "media_removed",
                "collection_item_ids": sorted(affected_ids),
            }
            self._db.add(
                Notification(
                    user_id=trade.sender_user_id,
                    type=NotificationType.trade_cancelled,
                    title="A trade offer was cancelled",
                    body="A card in the offer was removed because its media was permanently deleted.",
                    is_read=False,
                    link_url=f"/trades/{trade.id}",
                    data=payload,
                )
            )
            self._db.add(
                Notification(
                    user_id=trade.receiver_user_id,
                    type=NotificationType.trade_cancelled,
                    title="A trade offer was cancelled",
                    body="A card in the offer was removed because its media was permanently deleted.",
                    is_read=False,
                    link_url=f"/trades/{trade.id}",
                    data=payload,
                )
            )
