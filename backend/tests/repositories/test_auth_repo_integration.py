from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from backend.app.models.auth import APIKey, RefreshToken, User
from backend.app.repositories.auth import APIKeyRepository, RefreshTokenRepository, UserRepository


@pytest.mark.asyncio
async def test_user_repository_queries(db_session, make_user):
    u1 = await make_user(username="sakura", email="sakura@starsbit.space")
    u2 = await make_user(username="saber", email="saber@starsbit.space")

    repo = UserRepository(db_session)
    assert await repo.get_by_id(u1.id) is not None
    assert (await repo.get_by_username("sakura")).id == u1.id
    assert (await repo.get_by_email("saber@starsbit.space")).id == u2.id

    rows = await repo.list(offset=0, limit=10, order_expr=User.username.asc())
    assert [u.username for u in rows] == ["saber", "sakura"]
    assert await repo.count() == 2


@pytest.mark.asyncio
async def test_refresh_token_repository_get_by_hash(db_session, make_user):
    user = await make_user()
    token = RefreshToken(
        user_id=user.id,
        token_hash="hash123",
        remember_me=False,
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
        revoked=False,
    )
    db_session.add(token)
    await db_session.flush()

    repo = RefreshTokenRepository(db_session)
    assert (await repo.get_by_hash("hash123")).user_id == user.id
    assert await repo.get_by_hash("missing") is None


@pytest.mark.asyncio
async def test_api_key_repository_queries(db_session, make_user):
    user = await make_user()
    api_key = APIKey(user_id=user.id, key_hash="keyhash123")
    db_session.add(api_key)
    await db_session.flush()

    repo = APIKeyRepository(db_session)
    assert (await repo.get_by_hash("keyhash123")).user_id == user.id
    assert (await repo.get_by_user_id(user.id)).key_hash == "keyhash123"
    assert await repo.get_by_hash("missing") is None
