from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from backend.app.errors.error import AppError
from backend.app.utils.idempotency import IdempotencyStore, idempotency_body_hash, idempotency_scope


@pytest.mark.asyncio
async def test_idempotency_store_remember_and_replay():
    store = IdempotencyStore(ttl_seconds=3600)
    await store.remember(scope="u:POST:/x", idempotency_key="k", body_hash="h", status_code=201, payload={"ok": True})
    replay = await store.get_replay(scope="u:POST:/x", idempotency_key="k", body_hash="h")
    assert replay == (201, {"ok": True})


@pytest.mark.asyncio
async def test_idempotency_store_conflict_on_body_hash_mismatch():
    store = IdempotencyStore(ttl_seconds=3600)
    await store.remember(scope="s", idempotency_key="k", body_hash="h1", status_code=200, payload={})
    with pytest.raises(AppError) as exc:
        await store.get_replay(scope="s", idempotency_key="k", body_hash="h2")
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_idempotency_store_cleanup_expired_entries():
    store = IdempotencyStore(ttl_seconds=1)
    await store.remember(scope="s", idempotency_key="k", body_hash="h", status_code=200, payload={})
    key = "s:k"
    store._entries[key].created_at = datetime.now(timezone.utc) - timedelta(seconds=5)
    replay = await store.get_replay(scope="s", idempotency_key="k", body_hash="h")
    assert replay is None


def test_idempotency_helpers():
    assert idempotency_scope(user_id=1, method="post", path="/x") == "1:POST:/x"
    assert idempotency_body_hash({"a": 1, "b": 2}) == idempotency_body_hash({"b": 2, "a": 1})
