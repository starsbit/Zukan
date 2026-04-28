import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload

from backend.app.models.collection import CollectionVisibility, UserCollectionItem, UserCollectionPrivacy
from backend.app.models.gacha import RarityTier
from backend.app.models.media import Media
from backend.app.models.relations import MediaEntity


class CollectionRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_item(self, item_id: uuid.UUID) -> UserCollectionItem | None:
        return (
            await self.db.execute(
                select(UserCollectionItem)
                .options(selectinload(UserCollectionItem.media))
                .where(UserCollectionItem.id == item_id)
            )
        ).scalar_one_or_none()

    async def get_item_for_user(self, item_id: uuid.UUID, user_id: uuid.UUID) -> UserCollectionItem | None:
        return (
            await self.db.execute(
                select(UserCollectionItem)
                .options(selectinload(UserCollectionItem.media))
                .where(UserCollectionItem.id == item_id, UserCollectionItem.user_id == user_id)
            )
        ).scalar_one_or_none()

    async def get_by_user_and_media(self, user_id: uuid.UUID, media_id: uuid.UUID) -> UserCollectionItem | None:
        return (
            await self.db.execute(
                select(UserCollectionItem).where(
                    UserCollectionItem.user_id == user_id,
                    UserCollectionItem.media_id == media_id,
                )
            )
        ).scalar_one_or_none()

    async def get_items_by_ids(self, item_ids: list[uuid.UUID]) -> list[UserCollectionItem]:
        if not item_ids:
            return []
        return (
            await self.db.execute(
                select(UserCollectionItem)
                .options(selectinload(UserCollectionItem.media))
                .where(UserCollectionItem.id.in_(item_ids))
            )
        ).scalars().all()

    async def list_items(
        self,
        user_id: uuid.UUID,
        *,
        rarity_tier: RarityTier | None = None,
        character_name: str | None = None,
        series_name: str | None = None,
        level: int | None = None,
        tradeable: bool | None = None,
        duplicates_only: bool = False,
        include_nsfw: bool = True,
    ) -> list[UserCollectionItem]:
        stmt = (
            select(UserCollectionItem)
            .join(Media, Media.id == UserCollectionItem.media_id)
            .options(selectinload(UserCollectionItem.media))
            .where(UserCollectionItem.user_id == user_id)
            .order_by(UserCollectionItem.acquired_at.desc(), UserCollectionItem.id.desc())
        )
        if rarity_tier is not None:
            stmt = stmt.where(UserCollectionItem.rarity_tier_at_acquisition == rarity_tier)
        if level is not None:
            stmt = stmt.where(UserCollectionItem.level == level)
        if tradeable is not None:
            stmt = stmt.where(UserCollectionItem.tradeable == tradeable)
        if duplicates_only:
            stmt = stmt.where(UserCollectionItem.copies_pulled > 1)
        if not include_nsfw:
            stmt = stmt.where(Media.is_nsfw.is_(False), Media.is_sensitive.is_(False))
        if character_name:
            character = aliased(MediaEntity)
            stmt = stmt.join(character, character.media_id == UserCollectionItem.media_id).where(
                character.entity_type == "character",
                func.lower(character.name) == character_name.lower(),
            )
        if series_name:
            series = aliased(MediaEntity)
            stmt = stmt.join(series, series.media_id == UserCollectionItem.media_id).where(
                series.entity_type == "series",
                func.lower(series.name) == series_name.lower(),
            )
        return (await self.db.execute(stmt)).scalars().unique().all()

    async def get_privacy(self, user_id: uuid.UUID) -> UserCollectionPrivacy | None:
        return await self.db.get(UserCollectionPrivacy, user_id)

    async def get_or_create_privacy(self, user_id: uuid.UUID) -> UserCollectionPrivacy:
        privacy = await self.get_privacy(user_id)
        if privacy is not None:
            return privacy
        privacy = UserCollectionPrivacy(
            user_id=user_id,
            visibility=CollectionVisibility.private,
            allow_trade_requests=True,
            show_stats=True,
            show_nsfw=False,
        )
        self.db.add(privacy)
        await self.db.flush()
        return privacy

    async def stats(self, user_id: uuid.UUID, *, include_nsfw: bool = True) -> tuple[int, int, int, int, dict[RarityTier, int]]:
        stmt = select(UserCollectionItem).join(Media, Media.id == UserCollectionItem.media_id).where(
            UserCollectionItem.user_id == user_id
        )
        if not include_nsfw:
            stmt = stmt.where(Media.is_nsfw.is_(False), Media.is_sensitive.is_(False))
        rows = (await self.db.execute(stmt)).scalars().all()
        total = len(rows)
        total_copies = sum(item.copies_pulled for item in rows)
        duplicate_copies = sum(max(item.copies_pulled - 1, 0) for item in rows)
        max_level = sum(1 for item in rows if item.level >= 5)
        tier_counts = {tier: 0 for tier in RarityTier}
        for item in rows:
            tier_counts[item.rarity_tier_at_acquisition] += 1
        return total, total_copies, duplicate_copies, max_level, tier_counts
