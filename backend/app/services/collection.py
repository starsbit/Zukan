import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.errors.error import AppError
from backend.app.models.auth import User
from backend.app.models.collection import CollectionVisibility, UserCollectionItem, UserCollectionPrivacy
from backend.app.models.gacha import RarityTier
from backend.app.repositories.collection import CollectionRepository
from backend.app.schemas.collection import CollectionFilters, CollectionPrivacyUpdate, CollectionStatsResponse, CollectionItemUpdate


UPGRADE_COSTS = {
    1: 5,
    2: 15,
    3: 30,
    4: 60,
}
MAX_COLLECTION_LEVEL = 5


class CollectionService:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db
        self._repo = CollectionRepository(db)

    async def list_own_collection(self, user: User, filters: CollectionFilters) -> list[UserCollectionItem]:
        return await self._repo.list_items(
            user.id,
            include_nsfw=user.show_nsfw,
            include_sensitive=user.show_sensitive,
            **filters.model_dump(),
        )

    async def list_user_collection(
        self,
        owner_id: uuid.UUID,
        viewer: User,
        filters: CollectionFilters,
    ) -> list[UserCollectionItem]:
        privacy = await self._repo.get_or_create_privacy(owner_id)
        self._ensure_can_view_collection(owner_id, viewer, privacy)
        owner_allows_mature_media = owner_id == viewer.id or privacy.show_nsfw
        return await self._repo.list_items(
            owner_id,
            include_nsfw=owner_allows_mature_media and viewer.show_nsfw,
            include_sensitive=owner_allows_mature_media and viewer.show_sensitive,
            **filters.model_dump(),
        )

    async def get_item(self, item_id: uuid.UUID, user: User) -> UserCollectionItem:
        item = await self._repo.get_item_for_user(item_id, user.id)
        if item is None:
            raise AppError(status_code=404, code="collection_item_not_found", detail="Collection item not found")
        return item

    async def update_item(self, item_id: uuid.UUID, user: User, body: CollectionItemUpdate) -> UserCollectionItem:
        item = await self.get_item(item_id, user)
        if body.locked is not None:
            item.locked = body.locked
        if body.tradeable is not None:
            item.tradeable = body.tradeable
        await self._db.commit()
        await self._db.refresh(item)
        return item

    async def upgrade_item(self, item_id: uuid.UUID, user: User) -> UserCollectionItem:
        item = await self.get_item(item_id, user)
        if item.level >= MAX_COLLECTION_LEVEL:
            raise AppError(status_code=409, code="collection_item_max_level", detail="Collection item is already max level")
        cost = UPGRADE_COSTS[item.level]
        if item.upgrade_xp < cost:
            raise AppError(status_code=409, code="insufficient_upgrade_xp", detail="Not enough upgrade XP")
        item.upgrade_xp -= cost
        item.level += 1
        await self._db.commit()
        await self._db.refresh(item)
        return item

    async def get_privacy(self, user: User) -> UserCollectionPrivacy:
        privacy = await self._repo.get_or_create_privacy(user.id)
        await self._db.commit()
        await self._db.refresh(privacy)
        return privacy

    async def update_privacy(self, user: User, body: CollectionPrivacyUpdate) -> UserCollectionPrivacy:
        privacy = await self._repo.get_or_create_privacy(user.id)
        if body.visibility is not None:
            privacy.visibility = body.visibility
        if body.allow_trade_requests is not None:
            privacy.allow_trade_requests = body.allow_trade_requests
        if body.show_stats is not None:
            privacy.show_stats = body.show_stats
        if body.show_nsfw is not None:
            privacy.show_nsfw = body.show_nsfw
        await self._db.commit()
        await self._db.refresh(privacy)
        return privacy

    async def stats(self, owner_id: uuid.UUID, viewer: User) -> CollectionStatsResponse:
        privacy = await self._repo.get_or_create_privacy(owner_id)
        self._ensure_can_view_collection(owner_id, viewer, privacy)
        if owner_id != viewer.id and not privacy.show_stats:
            raise AppError(status_code=403, code="collection_stats_private", detail="Collection stats are private")
        owner_allows_mature_media = owner_id == viewer.id or privacy.show_nsfw
        total, total_copies, duplicate_copies, max_level, tier_counts = await self._repo.stats(
            owner_id,
            include_nsfw=owner_allows_mature_media and viewer.show_nsfw,
            include_sensitive=owner_allows_mature_media and viewer.show_sensitive,
        )
        return CollectionStatsResponse(
            total_items=total,
            total_copies_pulled=total_copies,
            duplicate_copies=duplicate_copies,
            max_level_items=max_level,
            tier_counts=tier_counts,
        )

    def _ensure_can_view_collection(self, owner_id: uuid.UUID, viewer: User, privacy: UserCollectionPrivacy) -> None:
        if owner_id == viewer.id:
            return
        if privacy.visibility != CollectionVisibility.public:
            raise AppError(status_code=403, code="collection_private", detail="Collection is private")


def duplicate_xp_for_tier(tier: RarityTier) -> int:
    return {
        RarityTier.N: 1,
        RarityTier.R: 3,
        RarityTier.SR: 10,
        RarityTier.SSR: 25,
        RarityTier.UR: 75,
    }[tier]
