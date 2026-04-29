from __future__ import annotations

from types import SimpleNamespace
from datetime import datetime, timezone
import uuid
from unittest.mock import AsyncMock

import pytest

from backend.app.errors.error import AppError
from backend.app.models.collection import UserCollectionItem
from backend.app.models.gacha import GachaPullMode, RarityTier
from backend.app.schemas.collection import CollectionFilters
from backend.app.services.collection import CollectionService, duplicate_xp_for_tier
from backend.app.services.gacha import GachaService


def test_duplicate_xp_by_rarity_tier():
    assert duplicate_xp_for_tier(RarityTier.N) == 1
    assert duplicate_xp_for_tier(RarityTier.R) == 3
    assert duplicate_xp_for_tier(RarityTier.SR) == 10
    assert duplicate_xp_for_tier(RarityTier.SSR) == 25
    assert duplicate_xp_for_tier(RarityTier.UR) == 75


def test_stable_tier_requires_repeated_downgrade(fake_db):
    service = GachaService(fake_db)
    previous = SimpleNamespace(rarity_tier=RarityTier.SSR, below_threshold_count=0)

    tier, below_count = service._stable_tier(previous, RarityTier.R, 0.50)

    assert tier == RarityTier.SSR
    assert below_count == 1

    previous.below_threshold_count = below_count
    tier, below_count = service._stable_tier(previous, RarityTier.R, 0.50)

    assert tier == RarityTier.R
    assert below_count == 0


@pytest.mark.asyncio
async def test_upgrade_item_spends_xp(fake_db, user, monkeypatch):
    item = UserCollectionItem(
        id=uuid.uuid4(),
        user_id=user.id,
        media_id=uuid.uuid4(),
        rarity_tier_at_acquisition=RarityTier.R,
        level=1,
        upgrade_xp=5,
        copies_pulled=3,
        locked=False,
        tradeable=True,
    )
    service = CollectionService(fake_db)

    async def _get_item(_item_id, _user):
        return item

    monkeypatch.setattr(service, "get_item", _get_item)

    upgraded = await service.upgrade_item(item.id, user)

    assert upgraded.level == 2
    assert upgraded.upgrade_xp == 0
    fake_db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_upgrade_item_rejects_insufficient_xp(fake_db, user, monkeypatch):
    item = UserCollectionItem(
        id=uuid.uuid4(),
        user_id=user.id,
        media_id=uuid.uuid4(),
        rarity_tier_at_acquisition=RarityTier.R,
        level=2,
        upgrade_xp=14,
        copies_pulled=3,
        locked=False,
        tradeable=True,
    )
    service = CollectionService(fake_db)

    async def _get_item(_item_id, _user):
        return item

    monkeypatch.setattr(service, "get_item", _get_item)

    with pytest.raises(AppError) as exc:
        await service.upgrade_item(item.id, user)

    assert exc.value.status_code == 409
    assert exc.value.detail["code"] == "insufficient_upgrade_xp"


@pytest.mark.asyncio
async def test_list_own_collection_honors_viewer_content_settings(fake_db, user, monkeypatch):
    service = CollectionService(fake_db)
    list_items = AsyncMock(return_value=[])
    monkeypatch.setattr(service._repo, "list_items", list_items)

    await service.list_own_collection(user, CollectionFilters())

    list_items.assert_awaited_once()
    assert list_items.await_args.args == (user.id,)
    assert list_items.await_args.kwargs["include_nsfw"] is False
    assert list_items.await_args.kwargs["include_sensitive"] is False


@pytest.mark.asyncio
async def test_list_user_collection_applies_viewer_content_settings_to_owner(fake_db, user, monkeypatch):
    service = CollectionService(fake_db)
    list_items = AsyncMock(return_value=[])
    privacy = SimpleNamespace(show_nsfw=True, visibility=None)
    monkeypatch.setattr(service._repo, "list_items", list_items)
    monkeypatch.setattr(service._repo, "get_or_create_privacy", AsyncMock(return_value=privacy))

    await service.list_user_collection(user.id, user, CollectionFilters())

    list_items.assert_awaited_once()
    assert list_items.await_args.kwargs["include_nsfw"] is False
    assert list_items.await_args.kwargs["include_sensitive"] is False


@pytest.mark.asyncio
async def test_daily_currency_claim_grants_once_per_utc_day(fake_db, user, monkeypatch):
    balance = SimpleNamespace(user_id=user.id, balance=0, total_claimed=0, total_spent=0, last_daily_claimed_on=None)
    service = GachaService(fake_db)

    async def _get_or_create_balance(_user_id, *, lock=False):
        return balance

    monkeypatch.setattr(service._repo, "get_or_create_balance", _get_or_create_balance)

    claimed = await service.claim_daily_currency(user)

    assert claimed.claimed == 10
    assert claimed.balance == 10
    assert balance.total_claimed == 10
    assert balance.last_daily_claimed_on == datetime.now(timezone.utc).date()
    fake_db.commit.assert_awaited_once()

    with pytest.raises(AppError) as exc:
        await service.claim_daily_currency(user)

    assert exc.value.status_code == 409
    assert exc.value.detail["code"] == "daily_gacha_currency_already_claimed"


@pytest.mark.asyncio
async def test_pull_rejects_insufficient_gacha_currency(fake_db, user, monkeypatch):
    service = GachaService(fake_db)

    async def _select_candidate(_user, _tier, _used_media_ids):
        return SimpleNamespace(media_id=uuid.uuid4(), rarity_tier=RarityTier.R, rarity_score=0.6)

    async def _get_or_create_balance(_user_id, *, lock=False):
        return SimpleNamespace(user_id=user.id, balance=0, total_claimed=0, total_spent=0, last_daily_claimed_on=None)

    monkeypatch.setattr(service, "_select_candidate", _select_candidate)
    monkeypatch.setattr(service._repo, "get_or_create_balance", _get_or_create_balance)

    with pytest.raises(AppError) as exc:
        await service.pull(user, mode=GachaPullMode.ten_pull)

    assert exc.value.status_code == 409
    assert exc.value.detail["code"] == "insufficient_gacha_currency"
    assert exc.value.detail["details"] == {"balance": 0, "required": 9}


@pytest.mark.asyncio
async def test_gacha_stats_honors_viewer_content_settings(fake_db, user, monkeypatch):
    service = GachaService(fake_db)
    monkeypatch.setattr(service._repo, "snapshot_count", AsyncMock(return_value=4))
    monkeypatch.setattr(service._repo, "tier_counts", AsyncMock(return_value={tier: 0 for tier in RarityTier}))
    user_collection_totals = AsyncMock(return_value=(2, 1))
    monkeypatch.setattr(service._repo, "user_collection_totals", user_collection_totals)
    monkeypatch.setattr(
        service._repo,
        "get_balance",
        AsyncMock(return_value=SimpleNamespace(balance=3, last_daily_claimed_on=None)),
    )

    await service.stats(user)

    user_collection_totals.assert_awaited_once_with(
        user.id,
        include_nsfw=False,
        include_sensitive=False,
    )
