from __future__ import annotations

from types import SimpleNamespace
from datetime import datetime, timezone
import uuid
from unittest.mock import AsyncMock

import pytest

from backend.app.errors.error import AppError
from backend.app.models.collection import UserCollectionItem
from backend.app.models.gacha import GachaCurrencyLedger, GachaCurrencyLedgerReason, GachaPullMode, RarityTier
from backend.app.models.notifications import Notification
from backend.app.models.trade import TradeStatus
from backend.app.schemas.collection import CollectionFilters
from backend.app.services.collection import CollectionService, collection_item_pull_value, duplicate_xp_for_tier
from backend.app.services.gacha import GachaService
from backend.app.services.media.lifecycle import MediaLifecycleService


def test_duplicate_xp_by_rarity_tier():
    assert duplicate_xp_for_tier(RarityTier.N) == 1
    assert duplicate_xp_for_tier(RarityTier.R) == 3
    assert duplicate_xp_for_tier(RarityTier.SR) == 10
    assert duplicate_xp_for_tier(RarityTier.SSR) == 25
    assert duplicate_xp_for_tier(RarityTier.UR) == 75


def test_collection_item_pull_value_uses_rarity_and_level():
    item = SimpleNamespace(rarity_tier_at_acquisition=RarityTier.SSR, level=3)

    assert collection_item_pull_value(item) == 21


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
async def test_discard_item_decrements_one_copy_and_awards_pulls(fake_db, user, monkeypatch):
    item = UserCollectionItem(
        id=uuid.uuid4(),
        user_id=user.id,
        media_id=uuid.uuid4(),
        rarity_tier_at_acquisition=RarityTier.SR,
        level=2,
        upgrade_xp=0,
        copies_pulled=2,
        locked=False,
        tradeable=True,
        acquired_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    balance = SimpleNamespace(user_id=user.id, balance=5, total_claimed=0, total_spent=0, last_daily_claimed_on=None)
    service = CollectionService(fake_db)
    monkeypatch.setattr(service, "get_item", AsyncMock(return_value=item))
    monkeypatch.setattr("backend.app.services.collection.TradeRepository.active_item_ids", AsyncMock(return_value=set()))
    monkeypatch.setattr(
        "backend.app.services.collection.GachaRepository.get_or_create_balance",
        AsyncMock(return_value=balance),
    )

    response = await service.discard_item(item.id, user)

    assert item.copies_pulled == 1
    assert response.pulls_awarded == 8
    assert response.currency_balance == 13
    assert response.remaining_copies == 1
    assert response.item is not None
    assert response.item.id == item.id
    assert response.item.copies_pulled == 1
    assert balance.total_claimed == 8
    ledger = next(added for added in fake_db.added if isinstance(added, GachaCurrencyLedger))
    assert ledger.reason == GachaCurrencyLedgerReason.collection_discard
    fake_db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_discard_item_deletes_final_copy(fake_db, user, monkeypatch):
    item = UserCollectionItem(
        id=uuid.uuid4(),
        user_id=user.id,
        media_id=uuid.uuid4(),
        rarity_tier_at_acquisition=RarityTier.N,
        level=3,
        upgrade_xp=0,
        copies_pulled=1,
        locked=False,
        tradeable=True,
    )
    balance = SimpleNamespace(user_id=user.id, balance=0, total_claimed=0, total_spent=0, last_daily_claimed_on=None)
    service = CollectionService(fake_db)
    monkeypatch.setattr(service, "get_item", AsyncMock(return_value=item))
    monkeypatch.setattr("backend.app.services.collection.TradeRepository.active_item_ids", AsyncMock(return_value=set()))
    monkeypatch.setattr(
        "backend.app.services.collection.GachaRepository.get_or_create_balance",
        AsyncMock(return_value=balance),
    )

    response = await service.discard_item(item.id, user)

    assert response.pulls_awarded == 3
    assert response.remaining_copies == 0
    assert response.item is None
    assert item in fake_db.deleted


@pytest.mark.asyncio
async def test_discard_item_rejects_locked_or_active_trade_items(fake_db, user, monkeypatch):
    item = UserCollectionItem(
        id=uuid.uuid4(),
        user_id=user.id,
        media_id=uuid.uuid4(),
        rarity_tier_at_acquisition=RarityTier.R,
        level=1,
        upgrade_xp=0,
        copies_pulled=1,
        locked=True,
        tradeable=True,
    )
    service = CollectionService(fake_db)
    monkeypatch.setattr(service, "get_item", AsyncMock(return_value=item))

    with pytest.raises(AppError) as locked_exc:
        await service.discard_item(item.id, user)

    assert locked_exc.value.detail["code"] == "collection_item_locked"

    item.locked = False
    monkeypatch.setattr("backend.app.services.collection.TradeRepository.active_item_ids", AsyncMock(return_value={item.id}))

    with pytest.raises(AppError) as trade_exc:
        await service.discard_item(item.id, user)

    assert trade_exc.value.detail["code"] == "collection_item_in_active_trade"
    fake_db.commit.assert_not_awaited()


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
async def test_list_public_collection_owners_delegates_search_and_trade_filter(fake_db, user, monkeypatch):
    service = CollectionService(fake_db)
    other_id = uuid.uuid4()
    list_public_collection_owners = AsyncMock(
        return_value=[
            {
                "user_id": other_id,
                "username": "sakura",
                "allow_trade_requests": True,
                "show_stats": False,
            }
        ]
    )
    monkeypatch.setattr(service._repo, "list_public_collection_owners", list_public_collection_owners)

    owners = await service.list_public_collection_owners(user, q="sak", tradeable_only=True)

    list_public_collection_owners.assert_awaited_once_with(
        viewer_id=user.id,
        q="sak",
        tradeable_only=True,
    )
    assert owners[0].user_id == other_id
    assert owners[0].username == "sakura"
    assert owners[0].allow_trade_requests is True
    assert owners[0].show_stats is False


@pytest.mark.asyncio
async def test_daily_currency_claim_grants_once_per_utc_day(fake_db, user, monkeypatch):
    balance = SimpleNamespace(user_id=user.id, balance=0, total_claimed=0, total_spent=0, last_daily_claimed_on=None)
    service = GachaService(fake_db)

    async def _get_or_create_balance(_user_id, *, lock=False):
        return balance

    monkeypatch.setattr(service._repo, "get_or_create_balance", _get_or_create_balance)

    claimed = await service.claim_daily_currency(user)

    assert claimed.claimed == 6000
    assert claimed.balance == 6000
    assert balance.total_claimed == 6000
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
    assert exc.value.detail["details"] == {"balance": 0, "required": 1200}


@pytest.mark.asyncio
async def test_ten_pull_guarantees_at_least_sr(fake_db, user, monkeypatch):
    service = GachaService(fake_db)
    target_tiers: list[RarityTier] = []
    balance = SimpleNamespace(user_id=user.id, balance=1200, total_claimed=0, total_spent=0, last_daily_claimed_on=None)

    async def _select_candidate(_user, target_tier, _used_media_ids):
        target_tiers.append(target_tier)
        return SimpleNamespace(media_id=uuid.uuid4(), rarity_tier=target_tier, rarity_score=0.5)

    async def _get_or_create_balance(_user_id, *, lock=False):
        return balance

    async def _refresh(obj):
        if getattr(obj, "created_at", None) is None:
            obj.created_at = datetime.now(timezone.utc)

    monkeypatch.setattr(service, "_roll_tier", lambda: RarityTier.N)
    monkeypatch.setattr(service, "_select_candidate", _select_candidate)
    monkeypatch.setattr(service._repo, "get_or_create_balance", _get_or_create_balance)
    monkeypatch.setattr(service._collection_repo, "get_by_user_and_media", AsyncMock(return_value=None))
    fake_db.refresh = AsyncMock(side_effect=_refresh)

    pull = await service.pull(user, mode=GachaPullMode.ten_pull)

    assert target_tiers[-1] == RarityTier.SR
    assert pull.currency_spent == 1200
    assert pull.currency_balance == 0
    assert balance.total_spent == 1200


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


@pytest.mark.asyncio
async def test_media_purge_reimburses_collection_items_and_cancels_trades(fake_db, user, media, monkeypatch):
    owner_id = uuid.uuid4()
    item = UserCollectionItem(
        id=uuid.uuid4(),
        user_id=owner_id,
        media_id=media.id,
        rarity_tier_at_acquisition=RarityTier.UR,
        level=2,
        upgrade_xp=0,
        copies_pulled=3,
        locked=False,
        tradeable=True,
    )
    trade = SimpleNamespace(
        id=uuid.uuid4(),
        sender_user_id=owner_id,
        receiver_user_id=user.id,
        status=TradeStatus.pending,
    )
    balance = SimpleNamespace(user_id=owner_id, balance=1, total_claimed=0, total_spent=0, last_daily_claimed_on=None)
    monkeypatch.setattr(
        "backend.app.services.media.lifecycle.CollectionRepository.list_items_by_media_id",
        AsyncMock(return_value=[item]),
    )
    monkeypatch.setattr(
        "backend.app.services.media.lifecycle.TradeRepository.pending_trades_for_item_ids",
        AsyncMock(return_value=[trade]),
    )
    monkeypatch.setattr(
        "backend.app.services.media.lifecycle.GachaRepository.get_or_create_balance",
        AsyncMock(return_value=balance),
    )

    await MediaLifecycleService(fake_db, SimpleNamespace())._reimburse_collection_items_for_media(media)

    assert balance.balance == 61
    assert trade.status == TradeStatus.cancelled
    assert item in fake_db.deleted
    ledgers = [added for added in fake_db.added if isinstance(added, GachaCurrencyLedger)]
    assert ledgers[0].reason == GachaCurrencyLedgerReason.media_removed_reimbursement
    notifications = [added for added in fake_db.added if isinstance(added, Notification)]
    assert any((notification.data or {}).get("kind") == "gacha_media_removed" for notification in notifications)
    assert any(notification.type.value == "trade_cancelled" for notification in notifications)


@pytest.mark.asyncio
async def test_soft_delete_does_not_reimburse_collection_items(fake_db, media, user):
    stub_query = SimpleNamespace(get_owned_or_admin_media=AsyncMock(return_value=media))
    service = MediaLifecycleService(fake_db, stub_query)
    service._reimburse_collection_items_for_media = AsyncMock()

    await service.soft_delete_media(media.id, user)

    service._reimburse_collection_items_for_media.assert_not_awaited()
