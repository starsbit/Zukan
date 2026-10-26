from __future__ import annotations
from datetime import datetime, timedelta, timezone
import pytest
from backend.app.models.auth import APIKey, RefreshToken, User, AuthSession
from backend.app.repositories.auth import APIKeyRepository, RefreshTokenRepository, UserRepository

@pytest.mark.asyncio
async def test_refresh_token_repository_get_by_hash(db_session, make_user):
    user = await make_user()
    session=AuthSession(auth_config='test',revoked=False,expires_at=datetime.now(timezone.utc)+timedelta(days=1))
    db_session.add(session)
    await db_session.flush()
    token = RefreshToken(session_id=session.id,user_id=user.id, token_hash='hash123', remember_me=False, expires_at=datetime.now(timezone.utc) + timedelta(days=1), revoked=False)
    db_session.add(token)
    await db_session.flush()
    repo = RefreshTokenRepository(db_session)
    assert await repo.get_by_hash('missing') is None

@pytest.mark.asyncio
async def test_api_key_repository_queries(db_session, make_user):
    user = await make_user()
    api_key = APIKey(user_id=user.id, key_hash='keyhash123')
    db_session.add(api_key)
    await db_session.flush()
    repo = APIKeyRepository(db_session)
    assert (await repo.get_by_user_id(user.id)).key_hash == 'keyhash123'
    assert await repo.get_by_hash('missing') is None
