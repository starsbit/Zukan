import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.app.models.collection import UserCollectionItem
from backend.app.models.trade import TradeOffer, TradeOfferItem, TradeStatus


class TradeRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get(self, trade_id: uuid.UUID, *, lock: bool = False) -> TradeOffer | None:
        stmt = (
            select(TradeOffer)
            .options(
                selectinload(TradeOffer.items)
                .selectinload(TradeOfferItem.collection_item)
                .selectinload(UserCollectionItem.media)
            )
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
                .options(
                    selectinload(TradeOffer.items)
                    .selectinload(TradeOfferItem.collection_item)
                    .selectinload(UserCollectionItem.media)
                )
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

    async def count_for_user(self, user_id: uuid.UUID, *, incoming: bool) -> int:
        column = TradeOffer.receiver_user_id if incoming else TradeOffer.sender_user_id
        return (await self.db.execute(select(func.count(TradeOffer.id)).where(column == user_id))).scalar_one()
