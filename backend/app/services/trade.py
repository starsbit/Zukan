import uuid
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.errors.error import AppError
from backend.app.models.auth import User
from backend.app.models.collection import UserCollectionItem
from backend.app.models.notifications import Notification, NotificationType
from backend.app.models.trade import TradeOffer, TradeOfferItem, TradeSide, TradeStatus
from backend.app.repositories.collection import CollectionRepository
from backend.app.repositories.trade import TradeRepository
from backend.app.schemas.trade import TradeCreateRequest


class TradeService:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db
        self._repo = TradeRepository(db)
        self._collection_repo = CollectionRepository(db)

    async def create_trade(self, sender: User, body: TradeCreateRequest) -> TradeOffer:
        if sender.id == body.receiver_user_id:
            raise AppError(status_code=422, code="cannot_trade_with_self", detail="Users cannot trade with themselves")
        receiver = await self._db.get(User, body.receiver_user_id)
        if receiver is None:
            raise AppError(status_code=404, code="trade_receiver_not_found", detail="Trade receiver not found")
        receiver_privacy = await self._collection_repo.get_or_create_privacy(receiver.id)
        if not receiver_privacy.allow_trade_requests:
            raise AppError(status_code=403, code="trade_requests_disabled", detail="Receiver does not allow trade requests")

        offered_ids = self._dedupe_ids(body.offered_item_ids)
        requested_ids = self._dedupe_ids(body.requested_item_ids)
        if len(offered_ids) != len(body.offered_item_ids) or len(requested_ids) != len(body.requested_item_ids):
            raise AppError(status_code=422, code="duplicate_trade_item", detail="Trade item ids must be unique")

        offered = await self._collection_repo.get_items_by_ids(offered_ids)
        requested = await self._collection_repo.get_items_by_ids(requested_ids)
        self._validate_trade_items(offered, offered_ids, owner_id=sender.id, label="offered")
        self._validate_trade_items(requested, requested_ids, owner_id=receiver.id, label="requested")

        active = await self._repo.active_item_ids(offered_ids + requested_ids)
        if active:
            raise AppError(status_code=409, code="trade_item_already_active", detail="An item is already in an active trade")

        trade = TradeOffer(
            sender_user_id=sender.id,
            receiver_user_id=receiver.id,
            status=TradeStatus.pending,
            message=body.message,
        )
        self._db.add(trade)
        await self._db.flush()
        for item in offered:
            self._db.add(TradeOfferItem(trade_offer_id=trade.id, side=TradeSide.sender, collection_item_id=item.id))
        for item in requested:
            self._db.add(TradeOfferItem(trade_offer_id=trade.id, side=TradeSide.receiver, collection_item_id=item.id))
        self._add_trade_notification(
            user_id=receiver.id,
            notification_type=NotificationType.trade_received,
            title=f"{sender.username} sent you a trade offer",
            body="Review the trade offer to accept or reject it.",
            trade_id=trade.id,
        )
        await self._db.commit()
        return await self._require_trade(trade.id)

    async def list_incoming(self, user: User) -> list[TradeOffer]:
        return await self._repo.list_incoming(user.id)

    async def list_outgoing(self, user: User) -> list[TradeOffer]:
        return await self._repo.list_outgoing(user.id)

    async def accept_trade(self, trade_id: uuid.UUID, user: User) -> TradeOffer:
        trade = await self._require_trade(trade_id, lock=True)
        if trade.receiver_user_id != user.id:
            raise AppError(status_code=403, code="trade_not_receiver", detail="Only the receiver can accept this trade")
        await self._ensure_pending(trade)
        sender_items, receiver_items = self._split_items(trade)
        self._validate_accept_items(sender_items, expected_owner=trade.sender_user_id)
        self._validate_accept_items(receiver_items, expected_owner=trade.receiver_user_id)

        for item in sender_items:
            item.user_id = trade.receiver_user_id
        for item in receiver_items:
            item.user_id = trade.sender_user_id
        trade.status = TradeStatus.accepted
        self._add_trade_notification(
            user_id=trade.sender_user_id,
            notification_type=NotificationType.trade_accepted,
            title="Your trade offer was accepted",
            body="Collection item ownership has been swapped.",
            trade_id=trade.id,
        )
        await self._db.commit()
        return await self._require_trade(trade.id)

    async def reject_trade(self, trade_id: uuid.UUID, user: User) -> TradeOffer:
        trade = await self._require_trade(trade_id)
        if trade.receiver_user_id != user.id:
            raise AppError(status_code=403, code="trade_not_receiver", detail="Only the receiver can reject this trade")
        await self._ensure_pending(trade)
        trade.status = TradeStatus.rejected
        self._add_trade_notification(
            user_id=trade.sender_user_id,
            notification_type=NotificationType.trade_rejected,
            title="Your trade offer was rejected",
            body="The receiver rejected your trade offer.",
            trade_id=trade.id,
        )
        await self._db.commit()
        return await self._require_trade(trade.id)

    async def cancel_trade(self, trade_id: uuid.UUID, user: User) -> TradeOffer:
        trade = await self._require_trade(trade_id)
        if trade.sender_user_id != user.id:
            raise AppError(status_code=403, code="trade_not_sender", detail="Only the sender can cancel this trade")
        await self._ensure_pending(trade)
        trade.status = TradeStatus.cancelled
        self._add_trade_notification(
            user_id=trade.receiver_user_id,
            notification_type=NotificationType.trade_cancelled,
            title="A trade offer was cancelled",
            body="The sender cancelled the trade offer.",
            trade_id=trade.id,
        )
        await self._db.commit()
        return await self._require_trade(trade.id)

    async def _require_trade(self, trade_id: uuid.UUID, *, lock: bool = False) -> TradeOffer:
        trade = await self._repo.get(trade_id, lock=lock)
        if trade is None:
            raise AppError(status_code=404, code="trade_not_found", detail="Trade offer not found")
        return trade

    async def _ensure_pending(self, trade: TradeOffer) -> None:
        if trade.status != TradeStatus.pending:
            raise AppError(status_code=409, code="trade_not_pending", detail="Trade offer is not pending")
        if trade.expires_at is not None:
            expires_at = trade.expires_at
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            if expires_at <= datetime.now(timezone.utc):
                trade.status = TradeStatus.expired
                self._add_trade_notification(
                    user_id=trade.sender_user_id,
                    notification_type=NotificationType.trade_expired,
                    title="Your trade offer expired",
                    body="The trade offer can no longer be accepted.",
                    trade_id=trade.id,
                )
                await self._db.commit()
                raise AppError(status_code=409, code="trade_expired", detail="Trade offer has expired")

    def _validate_trade_items(
        self,
        items: list[UserCollectionItem],
        expected_ids: list[uuid.UUID],
        *,
        owner_id: uuid.UUID,
        label: str,
    ) -> None:
        by_id = {item.id: item for item in items}
        if set(by_id) != set(expected_ids):
            raise AppError(status_code=404, code=f"{label}_trade_item_not_found", detail="Trade item not found")
        for item in items:
            if item.user_id != owner_id:
                raise AppError(status_code=403, code=f"{label}_trade_item_owner_mismatch", detail="Trade item owner mismatch")
            self._ensure_item_tradeable(item)

    def _validate_accept_items(self, items: list[UserCollectionItem], *, expected_owner: uuid.UUID) -> None:
        for item in items:
            if item.user_id != expected_owner:
                raise AppError(status_code=409, code="trade_item_ownership_changed", detail="Trade item ownership changed")
            self._ensure_item_tradeable(item)

    def _ensure_item_tradeable(self, item: UserCollectionItem) -> None:
        if item.locked:
            raise AppError(status_code=409, code="trade_item_locked", detail="Locked items cannot be traded")
        if not item.tradeable:
            raise AppError(status_code=409, code="trade_item_not_tradeable", detail="Item is not tradeable")

    def _split_items(self, trade: TradeOffer) -> tuple[list[UserCollectionItem], list[UserCollectionItem]]:
        sender = [entry.collection_item for entry in trade.items if entry.side == TradeSide.sender]
        receiver = [entry.collection_item for entry in trade.items if entry.side == TradeSide.receiver]
        return sender, receiver

    def _add_trade_notification(
        self,
        *,
        user_id: uuid.UUID,
        notification_type: NotificationType,
        title: str,
        body: str,
        trade_id: uuid.UUID,
    ) -> None:
        self._db.add(
            Notification(
                user_id=user_id,
                type=notification_type,
                title=title,
                body=body,
                is_read=False,
                link_url=f"/trades/{trade_id}",
                data={"trade_id": str(trade_id), "kind": notification_type.value},
            )
        )

    def _dedupe_ids(self, item_ids: list[uuid.UUID]) -> list[uuid.UUID]:
        seen = set()
        deduped = []
        for item_id in item_ids:
            if item_id not in seen:
                deduped.append(item_id)
                seen.add(item_id)
        return deduped
