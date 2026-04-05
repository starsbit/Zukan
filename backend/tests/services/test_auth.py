from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from backend.app.errors.error import AppError
from backend.app.models.auth import APIKey, RefreshToken
from backend.app.schemas import UserRegister, UserUpdate
from backend.app.services.auth import AuthService, _refresh_token_expiry_days


def test_refresh_token_expiry_days_uses_remember_flag():
    assert _refresh_token_expiry_days(True) > _refresh_token_expiry_days(False)


@pytest.mark.asyncio
async def test_register_user_rejects_duplicate_username(fake_db):
    service = AuthService(fake_db)
    body = UserRegister(username="sakura", email="sakura@starsbit.space", password="password123")

    with patch("backend.app.services.auth.UserRepository") as repo_cls:
        repo = repo_cls.return_value
        repo.get_by_username = AsyncMock(return_value=object())

        with pytest.raises(AppError) as exc:
            await service.register_user(body)

    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_login_user_invalid_credentials(fake_db):
    service = AuthService(fake_db)

    with patch("backend.app.services.auth.UserRepository") as repo_cls:
        repo_cls.return_value.get_by_username = AsyncMock(return_value=None)
        with pytest.raises(AppError) as exc:
            await service.login_user("missing", "bad")

    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_login_and_basic_auth_accept_case_insensitive_username(fake_db):
    service = AuthService(fake_db)
    user = SimpleNamespace(id="u1", username="sakura", hashed_password="hashed")

    with patch("backend.app.services.auth.UserRepository") as repo_cls, patch(
        "backend.app.services.auth.verify_password", return_value=True
    ), patch("backend.app.services.auth.create_access_token", return_value="access"), patch.object(
        service, "create_refresh_token", AsyncMock(return_value="refresh")
    ):
        repo_cls.return_value.get_by_username = AsyncMock(return_value=user)

        token = await service.login_user("SaKuRa", "password123")
        authenticated = await service.authenticate_basic_user("SAKURA", "password123")

    assert token.access_token == "access"
    assert authenticated is user


@pytest.mark.asyncio
async def test_register_login_and_refresh_success_paths(fake_db):
    service = AuthService(fake_db)
    body = UserRegister(username="sakura", email="sakura@starsbit.space", password="password123")
    user = SimpleNamespace(id="u1", username="sakura", hashed_password="hashed")

    with patch("backend.app.services.auth.UserRepository") as repo_cls, patch(
        "backend.app.services.auth.hash_password", return_value="hashed"
    ), patch("backend.app.services.auth.verify_password", return_value=True), patch(
        "backend.app.services.auth.create_access_token", return_value="access"
    ), patch.object(service, "create_refresh_token", AsyncMock(return_value="refresh")), patch.object(
        service, "rotate_refresh_token", AsyncMock(return_value=("new-refresh", "u1"))
    ):
        repo = repo_cls.return_value
        repo.get_by_username = AsyncMock(side_effect=[None, user])
        repo.get_by_email = AsyncMock(return_value=None)

        created = await service.register_user(body)
        token = await service.login_user("sakura", "password123")
        refreshed = await service.refresh_access_token("old-refresh")

    assert created.username == "sakura"
    assert token.access_token == "access"
    assert token.refresh_token == "refresh"
    assert refreshed.refresh_token == "new-refresh"


@pytest.mark.asyncio
async def test_create_refresh_token_persists_record(fake_db, user):
    service = AuthService(fake_db)

    with patch("backend.app.services.auth.secrets.token_hex", return_value="raw-token"):
        raw = await service.create_refresh_token(user.id, remember_me=True)

    assert raw == "raw-token"
    assert isinstance(fake_db.added[-1], RefreshToken)
    fake_db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_rotate_refresh_token_returns_none_for_expired(fake_db, user):
    service = AuthService(fake_db)
    expired = SimpleNamespace(revoked=False, expires_at=datetime.now(UTC) - timedelta(days=1), user_id=user.id)

    with patch("backend.app.services.auth.RefreshTokenRepository") as repo_cls:
        repo_cls.return_value.get_by_hash = AsyncMock(return_value=expired)
        result = await service.rotate_refresh_token("raw")

    assert result is None


@pytest.mark.asyncio
async def test_rotate_refresh_token_success(fake_db, user):
    service = AuthService(fake_db)
    record = SimpleNamespace(revoked=False, expires_at=datetime.now(UTC) + timedelta(days=1), user_id=user.id, remember_me=False)

    with patch("backend.app.services.auth.RefreshTokenRepository") as repo_cls, patch(
        "backend.app.services.auth.secrets.token_hex", return_value="new-raw"
    ):
        repo_cls.return_value.get_by_hash = AsyncMock(return_value=record)
        rotated = await service.rotate_refresh_token("raw")

    assert rotated == ("new-raw", user.id)
    assert record.revoked is True
    assert isinstance(fake_db.added[-1], RefreshToken)
    fake_db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_revoke_refresh_token_paths(fake_db):
    service = AuthService(fake_db)

    with patch("backend.app.services.auth.RefreshTokenRepository") as repo_cls:
        repo = repo_cls.return_value
        repo.get_by_hash = AsyncMock(return_value=None)
        assert await service.revoke_refresh_token("missing") is False

        token = SimpleNamespace(revoked=False)
        repo.get_by_hash = AsyncMock(return_value=token)
        assert await service.revoke_refresh_token("present") is True
        assert token.revoked is True


@pytest.mark.asyncio
async def test_get_api_key_status_returns_absent_when_missing(fake_db, user):
    service = AuthService(fake_db)

    with patch("backend.app.services.auth.APIKeyRepository") as repo_cls:
        repo_cls.return_value.get_by_user_id = AsyncMock(return_value=None)
        status = await service.get_api_key_status(user.id)

    assert status.has_key is False
    assert status.created_at is None


@pytest.mark.asyncio
async def test_create_api_key_persists_hashed_record(fake_db, user):
    service = AuthService(fake_db)

    with patch("backend.app.services.auth.APIKeyRepository") as repo_cls, patch(
        "backend.app.services.auth.secrets.token_hex", return_value="raw-api-key"
    ):
        repo_cls.return_value.get_by_user_id = AsyncMock(return_value=None)
        created = await service.create_api_key(user.id)

    assert created.api_key == "zk_raw-api-key"
    assert isinstance(fake_db.added[-1], APIKey)
    assert fake_db.added[-1].key_hash != created.api_key
    fake_db.commit.assert_awaited_once()
    fake_db.refresh.assert_awaited_once()


@pytest.mark.asyncio
async def test_create_api_key_replaces_existing_key(fake_db, user):
    service = AuthService(fake_db)
    existing = SimpleNamespace(key_hash="old", created_at=datetime.now(UTC), last_used_at=datetime.now(UTC))

    with patch("backend.app.services.auth.APIKeyRepository") as repo_cls, patch(
        "backend.app.services.auth.secrets.token_hex", return_value="new-api-key"
    ):
        repo_cls.return_value.get_by_user_id = AsyncMock(return_value=existing)
        created = await service.create_api_key(user.id)

    assert created.api_key == "zk_new-api-key"
    assert existing.key_hash != "old"
    assert existing.last_used_at is None
    assert fake_db.deleted == []


@pytest.mark.asyncio
async def test_get_user_by_api_key_updates_last_used(fake_db, user):
    service = AuthService(fake_db)
    record = SimpleNamespace(user_id=user.id, last_used_at=None)

    with patch("backend.app.services.auth.APIKeyRepository") as api_repo_cls, patch(
        "backend.app.services.auth.UserRepository"
    ) as user_repo_cls:
        api_repo_cls.return_value.get_by_hash = AsyncMock(return_value=record)
        user_repo_cls.return_value.get_by_id = AsyncMock(return_value=user)
        authenticated = await service.get_user_by_api_key("zk_lookup")

    assert authenticated is user
    assert record.last_used_at is not None
    fake_db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_update_current_user_checks_version_and_updates(fake_db, user):
    service = AuthService(fake_db)

    with pytest.raises(AppError):
        await service.update_current_user(user, UserUpdate(version=user.version + 1))

    with patch("backend.app.services.auth.hash_password", return_value="hashed"):
        updated = await service.update_current_user(
            user,
            UserUpdate(
                show_nsfw=True,
                tag_confidence_threshold=0.6,
                password="newpassword",
                version=user.version,
            ),
        )

    assert updated.show_nsfw is True
    assert updated.tag_confidence_threshold == 0.6
    assert updated.hashed_password == "hashed"
