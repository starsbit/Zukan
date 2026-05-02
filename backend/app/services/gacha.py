from __future__ import annotations

import math
import random
import uuid
from collections import Counter
from datetime import datetime, time, timedelta, timezone

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.errors.error import AppError
from backend.app.models.auth import User
from backend.app.models.collection import UserCollectionItem
from backend.app.models.gacha import (
    GachaCurrencyLedger,
    GachaCurrencyLedgerReason,
    GachaPull,
    GachaPullItem,
    GachaPullMode,
    MediaGachaRarity,
    RarityTier,
)
from backend.app.models.media import Media
from backend.app.models.media_interactions import UserFavorite
from backend.app.repositories.collection import CollectionRepository
from backend.app.repositories.gacha import GachaRepository
from backend.app.schemas.gacha import (
    GachaCurrencyBalanceRead,
    GachaDailyClaimResponse,
    GachaPullItemRead,
    GachaPullRead,
    GachaStatsResponse,
    RarityRecalculationResponse,
)
from backend.app.services.collection import duplicate_xp_for_tier


RARITY_SCORE_VERSION = "v1"
TIER_ORDER = [RarityTier.N, RarityTier.R, RarityTier.SR, RarityTier.SSR, RarityTier.UR]
TIER_RANK = {tier: idx for idx, tier in enumerate(TIER_ORDER)}
PULL_RATES = [
    (RarityTier.N, 0.68),
    (RarityTier.R, 0.22),
    (RarityTier.SR, 0.07),
    (RarityTier.SSR, 0.025),
    (RarityTier.UR, 0.005),
]
TIER_MIN_PERCENTILE = {
    RarityTier.N: 0.0,
    RarityTier.R: 0.55,
    RarityTier.SR: 0.80,
    RarityTier.SSR: 0.93,
    RarityTier.UR: 0.985,
}
DOWNGRADE_MARGIN = 0.03
SINGLE_PULL_CURRENCY_COST = 120
TEN_PULL_CURRENCY_COST = 1200
DAILY_CURRENCY_AMOUNT = SINGLE_PULL_CURRENCY_COST * 50
PULL_CURRENCY_COSTS = {
    GachaPullMode.single: SINGLE_PULL_CURRENCY_COST,
    GachaPullMode.daily: SINGLE_PULL_CURRENCY_COST,
    GachaPullMode.ten_pull: TEN_PULL_CURRENCY_COST,
}


class GachaService:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db
        self._repo = GachaRepository(db)
        self._collection_repo = CollectionRepository(db)

    async def recalculate_rarity(self) -> RarityRecalculationResponse:
        media_items = await self._repo.list_media_for_rarity()
        media_ids = [item.id for item in media_items]
        existing = await self._repo.existing_rarity_map(media_ids)
        favorite_counts = await self._eligible_favorite_counts(media_ids)

        scored = self._score_media(media_items, favorite_counts)
        scored.sort(key=lambda row: row[1])
        total = len(scored)
        tier_counts = {tier: 0 for tier in RarityTier}

        for index, (media, score, components) in enumerate(scored):
            percentile = (index + 1) / total if total else 0
            proposed_tier = self._tier_for_percentile(percentile)
            previous = existing.get(media.id)
            final_tier, below_count = self._stable_tier(previous, proposed_tier, percentile)
            tier_counts[final_tier] += 1
            if previous is None:
                self._db.add(
                    MediaGachaRarity(
                        media_id=media.id,
                        rarity_score=score,
                        rarity_tier=final_tier,
                        component_scores=components,
                        score_version=RARITY_SCORE_VERSION,
                        previous_tier=None,
                        below_threshold_count=below_count,
                        calculated_at=datetime.now(timezone.utc),
                    )
                )
            else:
                previous.previous_tier = previous.rarity_tier
                previous.rarity_score = score
                previous.rarity_tier = final_tier
                previous.component_scores = components
                previous.score_version = RARITY_SCORE_VERSION
                previous.below_threshold_count = below_count
                previous.calculated_at = datetime.now(timezone.utc)

        await self._db.commit()
        return RarityRecalculationResponse(
            recalculated=total,
            score_version=RARITY_SCORE_VERSION,
            tier_counts=tier_counts,
        )

    async def stats(self, user: User) -> GachaStatsResponse:
        snapshot_count = await self._repo.snapshot_count()
        tier_counts = await self._repo.tier_counts()
        collection_count, duplicate_copies = await self._repo.user_collection_totals(
            user.id,
            include_nsfw=user.show_nsfw,
            include_sensitive=user.show_sensitive,
        )
        balance = await self._repo.get_balance(user.id)
        daily_available = self._daily_claim_available(balance.last_daily_claimed_on if balance else None)
        return GachaStatsResponse(
            total_rarity_snapshots=snapshot_count,
            tier_counts=tier_counts,
            collection_count=collection_count,
            duplicate_copies=duplicate_copies,
            currency_balance=balance.balance if balance else 0,
            daily_claim_available=daily_available,
            next_daily_claim_at=None if daily_available else self._next_daily_claim_at(),
        )

    async def get_balance(self, user: User) -> GachaCurrencyBalanceRead:
        balance = await self._repo.get_or_create_balance(user.id)
        await self._db.commit()
        daily_available = self._daily_claim_available(balance.last_daily_claimed_on)
        return GachaCurrencyBalanceRead(
            user_id=balance.user_id,
            balance=balance.balance,
            total_claimed=balance.total_claimed,
            total_spent=balance.total_spent,
            last_daily_claimed_on=balance.last_daily_claimed_on,
            daily_claim_amount=DAILY_CURRENCY_AMOUNT,
            daily_claim_available=daily_available,
            next_daily_claim_at=None if daily_available else self._next_daily_claim_at(),
        )

    async def claim_daily_currency(self, user: User) -> GachaDailyClaimResponse:
        balance = await self._repo.get_or_create_balance(user.id, lock=True)
        today = datetime.now(timezone.utc).date()
        if balance.last_daily_claimed_on == today:
            raise AppError(status_code=409, code="daily_gacha_currency_already_claimed", detail="Daily gacha currency already claimed")
        balance.balance += DAILY_CURRENCY_AMOUNT
        balance.total_claimed += DAILY_CURRENCY_AMOUNT
        balance.last_daily_claimed_on = today
        self._db.add(
            GachaCurrencyLedger(
                user_id=user.id,
                amount=DAILY_CURRENCY_AMOUNT,
                balance_after=balance.balance,
                reason=GachaCurrencyLedgerReason.daily_claim,
                ledger_metadata={"claimed_on": today.isoformat()},
            )
        )
        await self._db.commit()
        return GachaDailyClaimResponse(
            claimed=DAILY_CURRENCY_AMOUNT,
            balance=balance.balance,
            daily_claim_available=False,
            next_daily_claim_at=self._next_daily_claim_at(),
        )

    async def pull(self, user: User, *, mode: GachaPullMode, pool: str | None = None) -> GachaPullRead:
        count = {GachaPullMode.single: 1, GachaPullMode.daily: 1, GachaPullMode.ten_pull: 10}[mode]
        cost = PULL_CURRENCY_COSTS[mode]
        selected: list[MediaGachaRarity] = []
        used_media_ids: set[uuid.UUID] = set()
        for position in range(count):
            target_tier = self._roll_tier()
            if mode == GachaPullMode.ten_pull and position == count - 1:
                if all(TIER_RANK[item.rarity_tier] < TIER_RANK[RarityTier.SR] for item in selected):
                    target_tier = RarityTier.SR
            selected.append(await self._select_candidate(user, target_tier, used_media_ids))
            used_media_ids.add(selected[-1].media_id)

        balance = await self._repo.get_or_create_balance(user.id, lock=True)
        if balance.balance < cost:
            raise AppError(
                status_code=409,
                code="insufficient_gacha_currency",
                detail="Not enough gacha currency",
                details={"balance": balance.balance, "required": cost},
            )
        balance.balance -= cost
        balance.total_spent += cost

        pull = GachaPull(user_id=user.id, mode=mode, pool=pool, currency_spent=cost)
        self._db.add(pull)
        await self._db.flush()
        self._db.add(
            GachaCurrencyLedger(
                user_id=user.id,
                amount=-cost,
                balance_after=balance.balance,
                reason=GachaCurrencyLedgerReason.pull_spend,
                reference_pull_id=pull.id,
                ledger_metadata={"mode": mode.value, "pool": pool},
            )
        )

        response_items: list[GachaPullItemRead] = []
        for position, rarity in enumerate(selected):
            collection_item = await self._collection_repo.get_by_user_and_media(user.id, rarity.media_id)
            was_duplicate = collection_item is not None
            xp = 0
            if collection_item is None:
                collection_item = UserCollectionItem(
                    user_id=user.id,
                    media_id=rarity.media_id,
                    rarity_tier_at_acquisition=rarity.rarity_tier,
                    level=1,
                    upgrade_xp=0,
                    copies_pulled=1,
                    locked=False,
                    tradeable=True,
                )
                self._db.add(collection_item)
            else:
                xp = duplicate_xp_for_tier(rarity.rarity_tier)
                collection_item.copies_pulled += 1
                collection_item.upgrade_xp += xp

            pull_item = GachaPullItem(
                pull_id=pull.id,
                media_id=rarity.media_id,
                rarity_tier=rarity.rarity_tier,
                rarity_score=rarity.rarity_score,
                was_duplicate=was_duplicate,
                upgrade_material_granted=xp,
                position=position,
            )
            self._db.add(pull_item)
            await self._db.flush()
            response_items.append(
                GachaPullItemRead(
                    id=pull_item.id,
                    media_id=rarity.media_id,
                    rarity_tier=rarity.rarity_tier,
                    rarity_score=rarity.rarity_score,
                    was_duplicate=was_duplicate,
                    upgrade_material_granted=xp,
                    position=position,
                    collection_item_id=collection_item.id,
                )
            )

        await self._db.commit()
        await self._db.refresh(pull)
        return GachaPullRead(
            id=pull.id,
            user_id=pull.user_id,
            mode=pull.mode,
            pool=pull.pool,
            currency_spent=pull.currency_spent,
            currency_balance=balance.balance,
            created_at=pull.created_at,
            items=response_items,
        )

    def _daily_claim_available(self, last_claimed_on) -> bool:
        return last_claimed_on != datetime.now(timezone.utc).date()

    def _next_daily_claim_at(self) -> datetime:
        tomorrow = datetime.now(timezone.utc).date() + timedelta(days=1)
        return datetime.combine(tomorrow, time.min, tzinfo=timezone.utc)

    async def _select_candidate(
        self,
        user: User,
        target_tier: RarityTier,
        used_media_ids: set[uuid.UUID],
    ) -> MediaGachaRarity:
        search_order = [target_tier] + [tier for tier in reversed(TIER_ORDER) if tier != target_tier]
        for tier in search_order:
            candidates = await self._repo.pull_candidates(user, tier, exclude_media_ids=used_media_ids)
            if candidates:
                return random.choice(candidates)
        for tier in search_order:
            candidates = await self._repo.pull_candidates(user, tier)
            if candidates:
                return random.choice(candidates)
        raise AppError(status_code=409, code="gacha_pool_empty", detail="No eligible gacha media is available")

    def _roll_tier(self) -> RarityTier:
        roll = random.random()
        cumulative = 0.0
        for tier, chance in PULL_RATES:
            cumulative += chance
            if roll <= cumulative:
                return tier
        return RarityTier.UR

    async def _eligible_favorite_counts(self, media_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
        if not media_ids:
            return {}
        cutoff = datetime.now(timezone.utc) - timedelta(days=7)
        rows = (
            await self._db.execute(
                select(UserFavorite.media_id, func.count(UserFavorite.user_id))
                .join(Media, Media.id == UserFavorite.media_id)
                .where(
                    UserFavorite.media_id.in_(media_ids),
                    UserFavorite.created_at <= cutoff,
                    or_(Media.uploader_id.is_(None), UserFavorite.user_id != Media.uploader_id),
                    or_(Media.owner_id.is_(None), UserFavorite.user_id != Media.owner_id),
                )
                .group_by(UserFavorite.media_id)
            )
        ).all()
        return {media_id: count for media_id, count in rows}

    def _score_media(self, media_items: list[Media], favorite_counts: dict[uuid.UUID, int]) -> list[tuple[Media, float, dict]]:
        character_counts = Counter()
        series_counts = Counter()
        tag_counts = Counter()
        phash_counts = Counter(item.phash for item in media_items if item.phash)
        max_age_days = max((self._age_days(item) for item in media_items), default=0.0)
        max_like_log = max((math.log1p(favorite_counts.get(item.id, 0)) for item in media_items), default=0.0)

        for item in media_items:
            for entity in item.entities:
                if entity.entity_type == "character":
                    character_counts[entity.name.lower()] += 1
                elif entity.entity_type == "series":
                    series_counts[entity.name.lower()] += 1
            for media_tag in item.media_tags:
                tag_counts[getattr(media_tag.tag, "name", str(media_tag.tag_id)).lower()] += 1

        rows = []
        for item in media_items:
            character_score = self._entity_rarity_score(
                [entity.name.lower() for entity in item.entities if entity.entity_type == "character"],
                character_counts,
            )
            series_score = self._entity_rarity_score(
                [entity.name.lower() for entity in item.entities if entity.entity_type == "series"],
                series_counts,
            )
            tag_score = self._entity_rarity_score(
                [getattr(media_tag.tag, "name", str(media_tag.tag_id)).lower() for media_tag in item.media_tags],
                tag_counts,
            )
            visual_score = 0.5 if not item.phash else 1.0 / phash_counts[item.phash]
            metadata_score = self._metadata_richness_score(item)
            age_score = 0.0 if max_age_days <= 0 else math.log1p(self._age_days(item)) / math.log1p(max_age_days)
            like_log = math.log1p(favorite_counts.get(item.id, 0))
            like_score = 0.0 if max_like_log <= 0 else like_log / max_like_log
            components = {
                "character_rarity": character_score,
                "series_rarity": series_score,
                "tag_rarity": tag_score,
                "visual_uniqueness": visual_score,
                "metadata_richness": metadata_score,
                "age_or_forgotten_score": age_score,
                "like_score": like_score,
            }
            score = (
                0.25 * character_score
                + 0.20 * series_score
                + 0.20 * tag_score
                + 0.15 * visual_score
                + 0.10 * metadata_score
                + 0.05 * age_score
                + 0.05 * like_score
            )
            rows.append((item, score, components))
        return rows

    def _entity_rarity_score(self, names: list[str], counts: Counter) -> float:
        if not names:
            return 0.5
        return sum(1.0 / math.sqrt(max(counts[name], 1)) for name in names) / len(names)

    def _metadata_richness_score(self, media: Media) -> float:
        values = [
            media.width,
            media.height,
            media.file_size,
            media.mime_type,
            media.captured_at,
            media.phash,
            media.ocr_text or media.ocr_text_override,
            media.media_tags,
            media.entities,
            media.external_refs,
        ]
        return sum(1 for value in values if value) / len(values)

    def _age_days(self, media: Media) -> float:
        base = media.captured_at or media.uploaded_at
        if base is None:
            return 0.0
        if base.tzinfo is None:
            base = base.replace(tzinfo=timezone.utc)
        return max((datetime.now(timezone.utc) - base).total_seconds() / 86400, 0.0)

    def _tier_for_percentile(self, percentile: float) -> RarityTier:
        if percentile >= 0.985:
            return RarityTier.UR
        if percentile >= 0.93:
            return RarityTier.SSR
        if percentile >= 0.80:
            return RarityTier.SR
        if percentile >= 0.55:
            return RarityTier.R
        return RarityTier.N

    def _stable_tier(
        self,
        previous: MediaGachaRarity | None,
        proposed: RarityTier,
        percentile: float,
    ) -> tuple[RarityTier, int]:
        if previous is None:
            return proposed, 0
        current = previous.rarity_tier
        if TIER_RANK[proposed] >= TIER_RANK[current]:
            return proposed, 0
        current_floor = TIER_MIN_PERCENTILE[current]
        if percentile >= max(current_floor - DOWNGRADE_MARGIN, 0.0):
            return current, 0
        below = previous.below_threshold_count + 1
        if below < 2:
            return current, below
        return proposed, 0
