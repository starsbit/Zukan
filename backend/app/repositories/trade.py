import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.app.models.collection import UserCollectionItem
from backend.app.models.media import Media, MediaTag
from backend.app.models.trade import TradeOffer, TradeOfferItem, TradeStatus


class TradeRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get(self, trade_id: uuid.UUID, *, lock: bool = False) -> TradeOffer | None:
        stmt = (
            select(TradeOffer)
            .options(*self._trade_load_options())
            .where(TradeOffer.id == trade_id)
        )
        if lock:
            stmt = stmt.with_for_update()
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def list_incoming(self, user_id: uuid.UUID) -> list[TradeOffer]:
        return await self._list(TradeOffer.receiver_user_id == user_id)

    async def list_outgoing(self, user_id: uuid.UUID) -> list[TradeOffer]:
        return await self._list(TradeOffer.sender_user_id == user_id)

    async def _list(self, predicate) -> list[TradeOffer]:
        return (
            await self.db.execute(
                select(TradeOffer)
                .options(*self._trade_load_options())
                .where(predicate)
                .order_by(TradeOffer.created_at.desc(), TradeOffer.id.desc())
            )
        ).scalars().unique().all()

    async def active_item_ids(self, item_ids: list[uuid.UUID]) -> set[uuid.UUID]:
        if not item_ids:
            return set()
        rows = (
            await self.db.execute(
                select(TradeOfferItem.collection_item_id)
                .join(TradeOffer, TradeOffer.id == TradeOfferItem.trade_offer_id)
                .where(
                    TradeOffer.status == TradeStatus.pending,
                    TradeOfferItem.collection_item_id.in_(item_ids),
                )
            )
        ).scalars().all()
        return set(rows)

    async def pending_trades_for_item_ids(self, item_ids: list[uuid.UUID]) -> list[TradeOffer]:
        if not item_ids:
            return []
        return (
            await self.db.execute(
                select(TradeOffer)
                .join(TradeOfferItem, TradeOfferItem.trade_offer_id == TradeOffer.id)
                .options(*self._trade_load_options())
                .where(
                    TradeOffer.status == TradeStatus.pending,
                    TradeOfferItem.collection_item_id.in_(item_ids),
                )
            )
        ).scalars().unique().all()

    async def count_for_user(self, user_id: uuid.UUID, *, incoming: bool) -> int:
        column = TradeOffer.receiver_user_id if incoming else TradeOffer.sender_user_id
        return (await self.db.execute(select(func.count(TradeOffer.id)).where(column == user_id))).scalar_one()

    def _trade_load_options(self):
        collection_item = selectinload(TradeOffer.items).selectinload(TradeOfferItem.collection_item)
        return (
            collection_item.selectinload(UserCollectionItem.media).selectinload(Media.media_tags).selectinload(MediaTag.tag),
            collection_item.selectinload(UserCollectionItem.media).selectinload(Media.entities),
        )
