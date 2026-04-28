import uuid

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.app.models.gacha import GachaCurrencyBalance, MediaGachaRarity, RarityTier
from backend.app.models.media import Media, ProcessingStatus, TaggingStatus
from backend.app.models.relations import MediaExternalRef
from backend.app.models.tags import MediaTag
from backend.app.models.auth import User
from backend.app.repositories.media import MediaRepository


class GachaRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    def processing_ready_clause(self):
        return and_(
            Media.deleted_at.is_(None),
            Media.tagging_status.notin_([TaggingStatus.PENDING, TaggingStatus.PROCESSING]),
            Media.thumbnail_status.notin_([ProcessingStatus.PENDING, ProcessingStatus.PROCESSING]),
            Media.poster_status.notin_([ProcessingStatus.PENDING, ProcessingStatus.PROCESSING]),
        )

    async def list_media_for_rarity(self) -> list[Media]:
        return (
            await self.db.execute(
                select(Media)
                .options(
                    selectinload(Media.media_tags).selectinload(MediaTag.tag),
                    selectinload(Media.entities),
                    selectinload(Media.external_refs),
                )
                .where(self.processing_ready_clause())
            )
        ).scalars().unique().all()

    async def existing_rarity_map(self, media_ids: list[uuid.UUID]) -> dict[uuid.UUID, MediaGachaRarity]:
        if not media_ids:
            return {}
        rows = (
            await self.db.execute(select(MediaGachaRarity).where(MediaGachaRarity.media_id.in_(media_ids)))
        ).scalars().all()
        return {row.media_id: row for row in rows}

    async def tier_counts(self) -> dict[RarityTier, int]:
        rows = (
            await self.db.execute(
                select(MediaGachaRarity.rarity_tier, func.count(MediaGachaRarity.media_id)).group_by(
                    MediaGachaRarity.rarity_tier
                )
            )
        ).all()
        counts = {tier: 0 for tier in RarityTier}
        for tier, count in rows:
            counts[tier] = count
        return counts

    async def snapshot_count(self) -> int:
        return (await self.db.execute(select(func.count(MediaGachaRarity.media_id)))).scalar_one()

    async def get_balance(self, user_id: uuid.UUID, *, lock: bool = False) -> GachaCurrencyBalance | None:
        stmt = select(GachaCurrencyBalance).where(GachaCurrencyBalance.user_id == user_id)
        if lock:
            stmt = stmt.with_for_update()
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def get_or_create_balance(self, user_id: uuid.UUID, *, lock: bool = False) -> GachaCurrencyBalance:
        balance = await self.get_balance(user_id, lock=lock)
        if balance is not None:
            return balance
        balance = GachaCurrencyBalance(user_id=user_id, balance=0, total_claimed=0, total_spent=0)
        self.db.add(balance)
        await self.db.flush()
        if lock:
            balance = await self.get_balance(user_id, lock=True)
            if balance is not None:
                return balance
        return balance

    async def pull_candidates(
        self,
        user: User,
        tier: RarityTier,
        *,
        exclude_media_ids: set[uuid.UUID] | None = None,
    ) -> list[MediaGachaRarity]:
        stmt = (
            select(MediaGachaRarity)
            .join(Media, Media.id == MediaGachaRarity.media_id)
            .options(selectinload(MediaGachaRarity.media))
            .where(
                MediaGachaRarity.rarity_tier == tier,
                self.processing_ready_clause(),
                MediaRepository(self.db).accessible_to_user_clause(user),
            )
        )
        if not user.show_nsfw:
            stmt = stmt.where(Media.is_nsfw.is_(False))
        if not user.show_sensitive:
            stmt = stmt.where(Media.is_sensitive.is_(False))
        if exclude_media_ids:
            stmt = stmt.where(MediaGachaRarity.media_id.notin_(exclude_media_ids))
        return (await self.db.execute(stmt)).scalars().all()

    async def user_collection_totals(self, user_id: uuid.UUID) -> tuple[int, int]:
        from backend.app.models.collection import UserCollectionItem

        rows = (
            await self.db.execute(select(UserCollectionItem).where(UserCollectionItem.user_id == user_id))
        ).scalars().all()
        return len(rows), sum(max(row.copies_pulled - 1, 0) for row in rows)
