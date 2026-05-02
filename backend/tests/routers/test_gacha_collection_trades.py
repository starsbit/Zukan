from __future__ import annotations

from datetime import datetime, timezone
import uuid
from unittest.mock import AsyncMock

from backend.app.models.collection import CollectionVisibility
from backend.app.models.gacha import GachaPullMode, RarityTier
from backend.app.models.trade import TradeStatus
from backend.app.services.collection import CollectionService
from backend.app.services.gacha import GachaService
from backend.app.services.trade import TradeService


def _pull_payload():
    pull_id = uuid.uuid4()
    user_id = uuid.uuid4()
    media_id = uuid.uuid4()
    item_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    return {
        "id": pull_id,
        "user_id": user_id,
        "mode": GachaPullMode.single,
        "pool": None,
        "created_at": now,
        "items": [
            {
                "id": item_id,
                "media_id": media_id,
                "rarity_tier": RarityTier.R,
                "rarity_score": 0.62,
                "was_duplicate": False,
                "upgrade_material_granted": 0,
                "position": 0,
                "collection_item_id": uuid.uuid4(),
            }
        ],
    }


def _trade_payload(status: TradeStatus = TradeStatus.pending):
    now = datetime.now(timezone.utc)
    return {
        "id": uuid.uuid4(),
        "sender_user_id": uuid.uuid4(),
        "receiver_user_id": uuid.uuid4(),
        "status": status,
        "message": "Want to trade?",
        "created_at": now,
        "updated_at": now,
        "expires_at": None,
        "items": [],
    }


def test_gacha_pull_contract(api_client, monkeypatch):
    fake_pull = AsyncMock(return_value=_pull_payload())
    monkeypatch.setattr(GachaService, "pull", fake_pull)

    response = api_client.post("/api/v1/gacha/pull", json={"mode": "single"})

    assert response.status_code == 201
    payload = response.json()
    assert payload["mode"] == "single"
    assert payload["items"][0]["rarity_tier"] == "R"
    fake_pull.assert_awaited_once()


def test_gacha_daily_claim_contract(api_client, monkeypatch):
    fake_claim = AsyncMock(
        return_value={
            "claimed": 6000,
            "balance": 6000,
            "daily_claim_available": False,
            "next_daily_claim_at": datetime.now(timezone.utc),
        }
    )
    monkeypatch.setattr(GachaService, "claim_daily_currency", fake_claim)

    response = api_client.post("/api/v1/gacha/daily-claim")

    assert response.status_code == 200
    assert response.json()["claimed"] == 6000
    assert response.json()["balance"] == 6000
    fake_claim.assert_awaited_once()


def test_gacha_balance_contract(api_client, monkeypatch):
    fake_balance = AsyncMock(
        return_value={
            "user_id": uuid.uuid4(),
            "balance": 8,
            "total_claimed": 6000,
            "total_spent": 2,
            "last_daily_claimed_on": datetime.now(timezone.utc).date(),
            "daily_claim_amount": 6000,
            "daily_claim_available": False,
            "next_daily_claim_at": datetime.now(timezone.utc),
        }
    )
    monkeypatch.setattr(GachaService, "get_balance", fake_balance)

    response = api_client.get("/api/v1/gacha/balance")

    assert response.status_code == 200
    assert response.json()["balance"] == 8
    fake_balance.assert_awaited_once()


def test_gacha_recalculate_rarity_admin_contract(api_client, monkeypatch):
    fake_recalculate = AsyncMock(
        return_value={"recalculated": 3, "score_version": "v1", "tier_counts": {RarityTier.N: 2, RarityTier.R: 1}}
    )
    monkeypatch.setattr(GachaService, "recalculate_rarity", fake_recalculate)

    response = api_client.post("/api/v1/gacha/recalculate-rarity")

    assert response.status_code == 200
    assert response.json()["recalculated"] == 3
    fake_recalculate.assert_awaited_once()


def test_collection_privacy_contract(api_client, monkeypatch):
    fake_privacy = AsyncMock(
        return_value={
            "user_id": uuid.uuid4(),
            "visibility": CollectionVisibility.public,
            "allow_trade_requests": True,
            "show_stats": True,
            "show_nsfw": False,
        }
    )
    monkeypatch.setattr(CollectionService, "update_privacy", fake_privacy)

    response = api_client.patch("/api/v1/users/me/collection-privacy", json={"visibility": "public"})

    assert response.status_code == 200
    assert response.json()["visibility"] == "public"
    fake_privacy.assert_awaited_once()


def test_public_collection_owners_contract(api_client, monkeypatch):
    owner_id = uuid.uuid4()
    fake_owners = AsyncMock(
        return_value=[
            {
                "user_id": owner_id,
                "username": "sakura",
                "allow_trade_requests": True,
                "show_stats": False,
            }
        ]
    )
    monkeypatch.setattr(CollectionService, "list_public_collection_owners", fake_owners)

    response = api_client.get("/api/v1/users/collections", params={"q": "sak", "tradeable_only": True})

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert payload["items"][0] == {
        "user_id": str(owner_id),
        "username": "sakura",
        "allow_trade_requests": True,
        "show_stats": False,
    }
    fake_owners.assert_awaited_once()


def test_collection_discard_contract(api_client, monkeypatch):
    item_id = uuid.uuid4()
    media_id = uuid.uuid4()
    fake_discard = AsyncMock(
        return_value={
            "item_id": item_id,
            "media_id": media_id,
            "copies_discarded": 1,
            "pulls_awarded": 8,
            "currency_balance": 18,
            "remaining_copies": 2,
            "item": None,
        }
    )
    monkeypatch.setattr(CollectionService, "discard_item", fake_discard)

    response = api_client.post(f"/api/v1/collection/items/{item_id}/discard")

    assert response.status_code == 200
    assert response.json()["pulls_awarded"] == 8
    assert response.json()["currency_balance"] == 18
    assert response.json()["item"] is None
    fake_discard.assert_awaited_once()


def test_trade_create_requires_requested_items(api_client):
    response = api_client.post(
        "/api/v1/trades",
        json={
            "receiver_user_id": str(uuid.uuid4()),
            "offered_item_ids": [str(uuid.uuid4())],
            "requested_item_ids": [],
        },
    )

    assert response.status_code == 422


def test_trade_accept_contract(api_client, monkeypatch):
    fake_accept = AsyncMock(return_value=_trade_payload(TradeStatus.accepted))
    monkeypatch.setattr(TradeService, "accept_trade", fake_accept)

    response = api_client.post(f"/api/v1/trades/{uuid.uuid4()}/accept")

    assert response.status_code == 200
    assert response.json()["status"] == "accepted"
    fake_accept.assert_awaited_once()


def test_gacha_requires_auth(unauthenticated_client):
    response = unauthenticated_client.get("/api/v1/gacha/stats")

    assert response.status_code == 401
